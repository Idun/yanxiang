import { aiSettings } from "./settings";
import type { ToolDefinition } from "./knowledgeTools";

/**
 * 真·联网搜索工具。
 *
 * 排查记录（本次修复的四个根因）：
 *  1. 只有一条主链路（r.jina.ai 读 Bing）+ DuckDuckGo Instant Answer 兜底。
 *     后者是「即时答案」接口，绝大多数长尾中文查询返回的 RelatedTopics 为空，
 *     等于没有兜底 —— 主链路一抖，整轮就报「联网搜索失败」。
 *  2. 解析是「按行做长度与前缀过滤」。阅读代理输出的是 Markdown，正文里
 *     导航栏、面包屑、跳转链接全都能过关，于是常出现「拿到 10 条结果、
 *     每条都是导航噪音」，模型看了等于没搜到。
 *  3. 单次超时 15s 且不重试。实测阅读代理冷缓存要 6~16s，正常波动就被
 *     AbortError 掐掉，异常信息又只落成一句「联网搜索失败」。
 *  4. 界面上的「Bing 优先 / Google 备选」开关（aiSettings.webSearchEngine）
 *     代码里从来没读过，选哪个都跑同一条链路。
 *
 * 现在的做法：
 *  - 多引擎顺序回退，每个引擎独立超时 + 一次重试；
 *  - 把阅读代理的 Markdown 解析成 { 标题, 链接, 摘要 } 结构，跳转链接还原成真实
 *    目标地址（Bing 的 base64 与 DDG 的 uddg 参数）；
 *  - 用查询词做相关性打分，整页都对不上就换下一个引擎，避免把缓存串味的结果
 *    喂给模型；
 *  - 全部失败时把每个引擎的真实失败原因一并交回去，便于用户与后续排查定位。
 *
 * 仍然不需要任何 API Key。
 */

export const WEB_SEARCH_TOOL_NAME = "web_search" as const;

/** 单个引擎的超时。阅读代理冷缓存偏慢，给足时间比反复重试更有效。 */
const ENGINE_TIMEOUT_MS = 28000;
/** 交回模型的结果条数上限（控制 token）。 */
const MAX_RESULTS = 6;
/** 单条摘要的字数上限。 */
const MAX_SNIPPET = 220;
/** 同一轮会话里重复查询直接命中缓存，既省时间也避开阅读代理的分钟级限流。 */
const CACHE_TTL_MS = 5 * 60 * 1000;

export function isWebSearchTool(name: string): boolean {
  return name === WEB_SEARCH_TOOL_NAME;
}

export function webSearchToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: WEB_SEARCH_TOOL_NAME,
      description:
        "实时联网搜索网页知识。当用户的问题涉及最新资讯、时效性数据、实时动态、不确定的专业概念或你知识截止日期之后的事情时，必须先调用本工具检索网页获取真实资料，再基于检索结果作答。返回若干条网页结果的标题、链接与摘要。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "精简准确的搜索关键词（可含引号、时间限定词）",
          },
        },
        required: ["query"],
      },
    },
  ];
}

/* ---------------- 引擎表 ---------------- */

interface SearchEngine {
  id: string;
  label: string;
  /** 目标搜索页 URL（会再套一层阅读代理）。 */
  build: (query: string) => string;
}

/**
 * 引擎按「解析稳定性 × 中文结果质量」排序，实测结论：
 *  - DuckDuckGo lite 版页面结构最干净，中英文都稳；
 *  - Bing 在英文查询上补位好，但中文长尾偶尔串到无关缓存页，所以不放第一；
 *  - Startpage 走的是 Google 的结果，因此界面上的「Google 备选」映射到它
 *    （直连 google.com 会吃到同意页 / 反爬，拿不到结果）。
 */
const DDG_LITE: SearchEngine = {
  id: "ddg-lite",
  label: "DuckDuckGo",
  build: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
};
const BING: SearchEngine = {
  id: "bing",
  label: "Bing",
  build: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
};
const BRAVE: SearchEngine = {
  id: "brave",
  label: "Brave",
  build: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
};
const STARTPAGE: SearchEngine = {
  id: "startpage",
  label: "Startpage(Google 结果)",
  build: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
};
const DDG_HTML: SearchEngine = {
  id: "ddg-html",
  label: "DuckDuckGo(HTML)",
  build: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
};

/** 用户在输入框「联网搜索设置」里选的偏好决定首发引擎，其余作为回退。 */
function engineChain(): SearchEngine[] {
  return aiSettings.webSearchEngine === "google"
    ? [STARTPAGE, DDG_LITE, BRAVE, BING, DDG_HTML]
    : [DDG_LITE, BING, BRAVE, DDG_HTML, STARTPAGE];
}

/* ---------------- 抓取 ---------------- */

/** CORS 友好的纯文本阅读代理，把搜索结果页转成 Markdown。 */
function readerUrl(target: string): string {
  return `https://r.jina.ai/${target}`;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  /* 外部（用户点「停止生成」）中止时，连带掐掉这条请求。 */
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort);
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/plain" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/* ---------------- Markdown 结果页解析 ---------------- */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索引擎自身的导航 / 页脚文案，命中即丢。 */
const NAV_TEXT =
  /^(skip to content|skip to main content|accessibility feedback|rewards|all|search|images|videos|maps|news|more|shopping|flights|tools|privacy|privacy policy|terms|pagination|next|previous|settings|feedback|help|sign in|web|about|about us|see more|show more|related searches|some results have been removed|open links in new tab|any time|past \d+ \w+|past week|past month|past year|verifying you.re not a bot|why am i seeing this\?|startpage search|goggles|下一页|上一页|更多|设置|反馈|隐私|条款)$/i;

const IMAGE_MD = /!\[[^\]]*\]\([^)]*\)/g;
const FIRST_LINK = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/;
const ALL_LINKS = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;

function base64UrlDecode(value: string): string {
  let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 把搜索引擎的跳转链接还原成真实目标地址。
 * Bing 用 `?u=a1<base64url>`，DuckDuckGo 用 `?uddg=<urlencoded>`。
 * 还原不出来就原样返回，不影响后续判断。
 */
function unwrapRedirect(raw: string): string {
  const url = raw.trim();

  const bing = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(url);
  if (bing) {
    try {
      const decoded = base64UrlDecode(bing[1]);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      /* 解码失败就保留原链接 */
    }
  }

  const ddg = /[?&]uddg=([^&]+)/.exec(url);
  if (ddg) {
    try {
      const decoded = decodeURIComponent(ddg[1]);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      /* 同上 */
    }
  }

  return url;
}

function stripMarkdown(text: string): string {
  return text
    .replace(IMAGE_MD, "")
    .replace(ALL_LINKS, "$1")
    .replace(/[*`_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 图标、缩略图代理、搜索引擎自家页面：都不是搜索结果。 */
function isJunkUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  if (/\.(ico|png|jpe?g|svg|gif|webp)(\?|$)/i.test(url)) return true;
  if (/(external-content\.duckduckgo|imgs\.search\.brave|cdn\.search\.brave|proxy-image|\/serp\/|\/av\/proxy)/i.test(url)) {
    return true;
  }
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*(bing|google|duckduckgo|brave|startpage|mojeek)\.[a-z.]+(?:\/(?:$|\?|#|search|help|about|settings|goggles|ck\/a|images|videos|maps|news|shop|travel|copilotsearch))/i.test(url)) {
    return true;
  }
  return false;
}

function isJunkTitle(title: string): boolean {
  const text = title.trim();
  if (text.length < 5) return true;
  if (NAV_TEXT.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  return false;
}

/**
 * 清掉标题前的面包屑噪音。
 * Brave / Startpage 会把「站点名 domain › a › b 真标题」压进同一个链接文本里。
 */
function cleanTitle(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  const arrow = text.lastIndexOf("›");
  if (arrow !== -1) text = text.slice(arrow + 1).trim();
  text = text.replace(/^[a-z0-9.-]+\.(com|cn|org|net|io|edu|gov|ai|co|me|dev)(\/\S*)?\s+/i, "");
  text = text.replace(/^https?:\/\/\S+\s*/i, "");
  return text.trim();
}

/**
 * 摘要尾巴上的固定噪音：各引擎都会在结果块末尾贴一段自家 UI 文案或
 * 「域名 + ISO 时间戳」的来源行。留着只是白占 token，还会让模型把
 * 「Visit in Anonymous View」当成资料内容。
 */
function cleanSnippet(raw: string): string {
  let text = raw;
  text = text.replace(/\bVisit in Anonymous View\b.*$/i, "");
  text = text.replace(/\bHow would you rate your experience with Startpage\?.*$/i, "");
  text = text.replace(/\bWhat is the reason for your rating\?.*$/i, "");
  text = text.replace(/\bYour feedback helps improve the Startpage\b.*$/i, "");
  /* 「www.example.com/path 2026-04-21T00:00:00.0000000」这种来源行。 */
  text = text.replace(/\s*(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S*\s*\d{4}-\d{2}-\d{2}T[\d:.]+\s*$/i, "");
  text = text.replace(/\s*\d{4}-\d{2}-\d{2}T[\d:.]+\s*$/i, "");
  text = text.replace(/\s*(?:https?:\/\/)?[a-z0-9.-]+\.(?:com|cn|org|net|io|edu|gov|ai|co|me|dev)\/\S*\s*$/i, "");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 把阅读代理返回的 Markdown 解析成结果条目。
 *
 * 规则：以链接开头的行视为一条新结果的标题行，其后的普通文字并入该条摘要，
 * 直到遇到下一个标题行。这样导航区（链接密集但都被 isJunkUrl/isJunkTitle 拦掉）
 * 不会产出条目，真正的结果块才会。
 */
export function parseSearchResults(markdown: string, limit = MAX_RESULTS * 3): SearchHit[] {
  const rows: SearchHit[] = [];
  let current: SearchHit | null = null;

  const flush = () => {
    if (current && current.title) rows.push(current);
    current = null;
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    /* 阅读代理自己的头部字段。 */
    if (/^(Title:|URL Source:|Markdown Content:|Warning:|Published Time:|Image \d+)/i.test(line)) continue;

    const noImage = line.replace(IMAGE_MD, "").trim();
    if (!noImage) continue;

    const link = FIRST_LINK.exec(noImage);
    const startsWithLink = /^(?:#{1,4}\s+|\d+[.)]\s*|[*-]\s*)?\[/.test(noImage);

    if (link && startsWithLink) {
      const url = unwrapRedirect(link[2]);
      const title = cleanTitle(stripMarkdown(link[1]));
      if (!isJunkUrl(url) && !isJunkTitle(title)) {
        flush();
        current = { title, url, snippet: "" };
        /* 标题与摘要同行的情况（DDG lite / Bing 都有）。 */
        const tail = stripMarkdown(noImage.slice(link.index + link[0].length));
        if (tail.length > 25) current.snippet = tail;
        if (rows.length >= limit) break;
        continue;
      }
    }

    if (!current) continue;
    const body = stripMarkdown(noImage);
    if (body.length < 15 || NAV_TEXT.test(body)) continue;
    if (current.snippet.length < MAX_SNIPPET * 2) {
      current.snippet = current.snippet ? `${current.snippet} ${body}` : body;
    }
  }
  flush();

  /* 同一目标页可能既出现在标题行又出现在面包屑行，按「域名 + 标题前缀」去重。 */
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of rows) {
    hit.snippet = cleanSnippet(hit.snippet);
    const key = `${hit.url.replace(/[?#].*$/, "")}|${hit.title.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------- 相关性打分 ---------------- */

/**
 * 把查询切成可匹配的词元：中文按 2-gram 滑窗（无分词器时最稳），
 * 英文 / 数字按单词。
 */
function queryTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const run of query.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) tokens.push(run);
    else for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2));
  }
  for (const word of query.toLowerCase().match(/[a-z0-9][a-z0-9.-]+/g) ?? []) {
    tokens.push(word);
  }
  return [...new Set(tokens)];
}

/** 命中的词元个数。标题权重更高，URL 也算（很多站把关键词放在路径里）。 */
function relevance(hit: SearchHit, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  let haystack = `${hit.title} ${hit.snippet} `.toLowerCase();
  try {
    haystack += decodeURIComponent(hit.url).toLowerCase();
  } catch {
    haystack += hit.url.toLowerCase();
  }
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
    if (hit.title.toLowerCase().includes(token)) score += 1;
  }
  return score;
}

/* ---------------- 单引擎执行 ---------------- */

interface EngineOutcome {
  engine: SearchEngine;
  hits: SearchHit[];
  /** 失败原因（成功为空串）。 */
  error: string;
  /** 抓到了页面但没能解析出与查询相关的条目。 */
  irrelevant: boolean;
}

async function runEngine(
  engine: SearchEngine,
  query: string,
  tokens: string[],
  signal?: AbortSignal,
): Promise<EngineOutcome> {
  const url = readerUrl(engine.build(query));

  /* 阅读代理偶发 429 / 5xx / 连接抖动，重试一次即可覆盖绝大多数情况。 */
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) return { engine, hits: [], error: "已取消", irrelevant: false };
    try {
      const markdown = await fetchText(url, signal);
      const parsed = parseSearchResults(markdown);
      const scored = parsed
        .map((hit) => ({ hit, score: relevance(hit, tokens) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((row) => row.hit);

      if (scored.length > 0) return { engine, hits: scored, error: "", irrelevant: false };
      return {
        engine,
        hits: [],
        error: parsed.length === 0 ? "页面无可解析结果" : "结果与查询不相关",
        irrelevant: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      /* 用户主动中止：立刻停手，不要继续换引擎。 */
      if (error instanceof Error && error.name === "AbortError" && signal?.aborted) {
        return { engine, hits: [], error: "已取消", irrelevant: false };
      }
      lastError = error instanceof Error && error.name === "AbortError" ? `超时（${ENGINE_TIMEOUT_MS / 1000}s）` : message;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  return { engine, hits: [], error: lastError || "未知错误", irrelevant: false };
}

/* ---------------- 结果缓存 ---------------- */

interface CacheEntry {
  at: number;
  text: string;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(query: string): string {
  return `${aiSettings.webSearchEngine}::${query.toLowerCase()}`;
}

/* ---------------- 对外入口 ---------------- */

function formatHits(query: string, engine: SearchEngine, hits: SearchHit[]): string {
  const body = hits
    .slice(0, MAX_RESULTS)
    .map((hit, i) => {
      const snippet = hit.snippet.slice(0, MAX_SNIPPET).trim();
      return `${i + 1}. ${hit.title}\n   链接: ${hit.url}${snippet ? `\n   摘要: ${snippet}` : ""}`;
    })
    .join("\n");

  return [
    `「${query}」的联网搜索结果（来源: ${engine.label}，共 ${Math.min(hits.length, MAX_RESULTS)} 条）：`,
    body,
    "",
    "请基于以上真实检索结果回答用户问题；引用具体事实时可标注来源站点，不要臆造检索结果里没有的信息。",
  ].join("\n");
}

/**
 * 执行一次联网搜索。永不抛错 —— 失败以可读文本返回，并附上每个引擎的真实
 * 失败原因，方便用户判断是网络、限流还是被目标站拦了。
 */
export async function runWebSearch(rawQuery: string, signal?: AbortSignal): Promise<string> {
  const query = String(rawQuery ?? "").trim();
  if (!query) {
    return "缺少搜索关键词，请提供 web_search 工具的 query 参数。";
  }

  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.text;

  const tokens = queryTokens(query);
  const failures: string[] = [];
  /* 整页都对不上查询时先记着：所有引擎都失败的话，宁可交回最像结果的那一份，
     也比一句「搜索失败」有用。 */
  let fallback: EngineOutcome | null = null;

  for (const engine of engineChain()) {
    if (signal?.aborted) break;
    const outcome = await runEngine(engine, query, tokens, signal);

    if (outcome.hits.length > 0) {
      const text = formatHits(query, engine, outcome.hits);
      cache.set(key, { at: Date.now(), text });
      return text;
    }

    failures.push(`${engine.label}: ${outcome.error}`);
    if (outcome.irrelevant && !fallback) fallback = outcome;
  }

  if (signal?.aborted) return "联网搜索已被取消。";

  if (fallback) {
    return [
      `「${query}」在各引擎均未检索到明确相关的网页结果。`,
      `尝试情况：${failures.join("；")}`,
      "请如实告知用户此次没有拿到可用的联网资料，并明确说明接下来的回答不基于实时检索。",
    ].join("\n");
  }

  return [
    `联网搜索失败，未能获取任何网页资料。`,
    `尝试过的引擎与失败原因：${failures.join("；")}`,
    "请如实告知用户此次联网检索没有成功（可提示其检查网络或代理），不要凭记忆编造时效性信息。",
  ].join("\n");
}

/** 「AI 正在搜索…」那条状态徽标的一句话描述。 */
export function describeWebSearchToolCall(name: string, args: Record<string, unknown>): string {
  void name;
  const query = String(args.query ?? args.q ?? args.keyword ?? "").trim();
  return `联网搜索：${query || "…"}`;
}
