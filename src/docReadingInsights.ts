/**
 * 文档界面 WYSIWYG 阅读辅助侧栏的解析逻辑（纯函数，无 Vue 依赖，便于单测）：
 * - 章节号识别 / 章节切分；
 * - 「细纲文档 → 对应章节细纲」解析：本节构成（情境·欲望·冲突·转变·结果）
 *   与【伏笔】呈现点、收回点。
 *
 * 组件层（DocReadingRails.vue）只负责渲染与交互，解析规则集中在这里维护。
 */

/* ================= 中文数字 ================= */

/** 把「12」「十二」「二十」「一百零三」等章号字符串转成数字；无法识别返回 null。 */
export function parseChineseOrArabicNum(str: string): number | null {
  if (!str) return null;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const cnMap: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    十: 10, 百: 100
  };
  if (str.length === 1 && cnMap[str] !== undefined) return cnMap[str];
  let val = 0;
  let temp = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const n = cnMap[char];
    if (n === undefined) continue;
    if (n === 10) {
      val += (temp || 1) * 10;
      temp = 0;
    } else if (n === 100) {
      val += (temp || 1) * 100;
      temp = 0;
    } else {
      temp = n;
    }
  }
  val += temp;
  return val >= 0 ? val : null;
}

/* ================= 章节识别 ================= */

export interface ChapterInfo {
  num: number;
  label: string;
  title: string;
}

/** 从一行标题里识别章号与标题（支持「第X章」「——第X章——」「序章」「Chapter 3」）。 */
export function detectChapterInfo(text: string): ChapterInfo | null {
  const cleaned = text.replace(/^[#\s—\-]+/, "").trim();
  const match = /^(?:(序章|前言|楔子|引子|序言|序|尾声|后记|结语|附录|番外篇|番外|外传)|第\s*([0-9一二三四五六七八九十百零]+)\s*章|Chapter\s*(\d+))(?:[：:\s·—\-]+(.*))?$/i.exec(cleaned);
  if (!match) return null;

  if (match[1]) {
    return { num: 0, label: match[1], title: match[4] || match[1] };
  }

  const numStr = match[2] || match[3];
  const num = parseChineseOrArabicNum(numStr);
  if (num === null) return null;

  const label = `第${num}章`;
  const title = match[4] || "";
  return { num, label, title };
}

/** 从整篇正文里识别首个章号。 */
export function detectChapterNumber(content: string): number | null {
  if (!content) return null;
  const match = /(?:^|\n)(?:#{1,6}\s+|——\s*)?(?:(序章|前言|楔子|引子|序言|序|尾声|后记|结语)|第\s*([0-9一二三四五六七八九十百零]+)\s*章|Chapter\s*(\d+))/i.exec(content);
  if (!match) return null;
  if (match[1]) return 0;
  return parseChineseOrArabicNum(match[2] || match[3]);
}

/** 把正文按章节标题切成 [start, end) 区段。 */
export function splitChapters(content: string): Array<{ num: number; start: number; end: number }> {
  if (!content) return [];
  const slices: Array<{ num: number; start: number; end: number }> = [];
  const regex = /(?:^|\n)(?:#{1,6}\s+|——\s*)?(?:序章|前言|楔子|引子|序言|序|尾声|后记|结语|第\s*[0-9一二三四五六七八九十百零]+\s*章|Chapter\s*\d+)(?:[：:\s·—\-]+[^\n]*)?/gi;

  let match: RegExpExecArray | null;
  const points: { num: number; index: number }[] = [];

  while ((match = regex.exec(content)) !== null) {
    const info = detectChapterInfo(match[0].trim());
    if (info !== null) {
      points.push({ num: info.num, index: match.index });
    }
  }

  for (let i = 0; i < points.length; i++) {
    const start = points[i].index;
    const end = i + 1 < points.length ? points[i + 1].index : content.length;
    slices.push({ num: points[i].num, start, end });
  }

  return slices;
}

/* ================= 细纲结构 ================= */

export interface OutlineSection {
  label: string;
  anchor: string;
  situation?: string; // 情境
  desire?: string;    // 欲望
  conflict?: string;  // 冲突
  turn?: string;      // 转变
  result?: string;    // 结果
}

export interface ForeshadowItem {
  text: string;
  targetChapter: number | null;
  targetText?: string;
}

export interface OutlineChapter {
  num: number;
  title: string;
  sections: OutlineSection[];
  foreshadows: ForeshadowItem[];
}

/** 识别「情境 / 欲望 / 冲突 / 转变 / 结果」五要素行。 */
export function matchDramaTag(
  line: string,
): { key: "situation" | "desire" | "conflict" | "turn" | "result"; val: string } | null {
  const h = /^(?:[-*+\s]*)(?:[*_~`]|【)?(情境|背景|环境|起因|欲望|动机|目标|冲突|阻碍|矛盾|转变|转折|契机|变化|结果|后果|结局|悬念)(?:[*_~`]|】)?[:：\s]+(.*)/i.exec(line);
  if (!h) return null;
  const d = h[1].trim();
  const val = h[2].replace(/^[*_~`]+|[*_~`]+$/g, "").trim();
  if (["情境", "背景", "环境", "起因"].includes(d)) return { key: "situation", val };
  if (["欲望", "动机", "目标"].includes(d)) return { key: "desire", val };
  if (["冲突", "阻碍", "矛盾"].includes(d)) return { key: "conflict", val };
  if (["转变", "转折", "契机", "变化"].includes(d)) return { key: "turn", val };
  if (["结果", "后果", "结局", "悬念"].includes(d)) return { key: "result", val };
  return null;
}

/* ================= 伏笔条目切分 ================= */

/* ①-⑳ / ⒈-⒛ / ㈠-㈩ 三段带圈序号。 */
const CIRCLED_CHAR = "\u2460-\u2473\u2488-\u249B\u3220-\u3229";
const CIRCLED_GLOBAL_RE = new RegExp(`[${CIRCLED_CHAR}]`, "g");

/** 一条伏笔的起始标记：带圈序号 / (1) / 1. / - 等。 */
const ENTRY_HEAD_RE = new RegExp(
  `^(?:[${CIRCLED_CHAR}]|[（(]\\s*\\d{1,2}\\s*[)）]|\\d{1,2}\\s*[.、．]|[-*+•]\\s+)`,
);

/** 明显属于「上一条的续行」：以破折号 / 箭头 / 括注 / 关联词开头。 */
const CONTINUATION_RE = /^(?:——|—|─|→|=>|、|，|,|（|\(|关联|收回|回收|对应|呼应|指向|后文|后续|下文)/;

/** 同一行里出现多个带圈序号时（「① a；② b；③ c」），按序号切成多段。 */
function splitInlineByCircled(line: string): string[] {
  const marks: number[] = [];
  let m: RegExpExecArray | null;
  CIRCLED_GLOBAL_RE.lastIndex = 0;
  while ((m = CIRCLED_GLOBAL_RE.exec(line)) !== null) marks.push(m.index);
  if (marks.length <= 1) return [line];

  const out: string[] = [];
  if (marks[0] > 0) {
    const head = line.slice(0, marks[0]).trim();
    if (head) out.push(head);
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1] : line.length;
    const seg = line.slice(marks[i], end).trim();
    if (seg) out.push(seg);
  }
  return out;
}

/**
 * 把【伏笔】区域的原始行切成「一条一条」的伏笔文本。
 *
 * 需要同时兼容三种真实写法：
 * 1. 一行一条（带或不带序号）；
 * 2. 一行挤多条（「① a；② b；③ c」）—— 旧实现在这里会把 5 条并成 1 条；
 * 3. 一条跨多行（正文一行、「—— 关联第X章」另起一行）。
 */
export function splitForeshadowEntries(lines: string[]): string[] {
  const parts: string[] = [];
  for (const raw of lines) {
    const line = (raw || "").trim();
    if (!line) continue;
    parts.push(...splitInlineByCircled(line));
  }

  const merged: string[] = [];
  let cur = "";
  for (const p of parts) {
    const isHead = ENTRY_HEAD_RE.test(p);
    const isCont = !isHead && CONTINUATION_RE.test(p);
    if (cur && isCont) {
      cur += p;
      continue;
    }
    if (cur.trim()) merged.push(cur.trim());
    cur = p;
  }
  if (cur.trim()) merged.push(cur.trim());

  /* 无序号但用「；」并列多条、且各段各自带「第X章」时再拆一次。 */
  const out: string[] = [];
  for (const entry of merged) {
    const hits = entry.match(/第\s*[0-9一二三四五六七八九十百零]+\s*章/g);
    if (hits && hits.length >= 2 && /[；;]/.test(entry)) {
      let split = false;
      const segs = entry
        .split(/[；;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segs.length >= 2 && segs.every((s) => /第\s*[0-9一二三四五六七八九十百零]+\s*章/.test(s))) {
        out.push(...segs);
        split = true;
      }
      if (split) continue;
    }
    out.push(entry);
  }
  return out;
}

/** 解析单条伏笔文本，拆出「伏笔正文」与「收回点章号」。 */
export function parseForeshadowLine(line: string): ForeshadowItem {
  const clean = line
    .replace(/^[-*+\d.、\s]+/, "")
    .replace(new RegExp(`^[${CIRCLED_CHAR}]\\s*`), "")
    .replace(/^[（(]\s*\d{1,2}\s*[)）]\s*/, "")
    .trim();

  const chapterRe = /第\s*([0-9一二三四五六七八九十百零]+)\s*章/;
  const toNum = (raw: string): number | null => {
    const n = parseChineseOrArabicNum(raw);
    return n !== null && !isNaN(n) && n > 0 ? n : null;
  };

  /* 章纲模板写法：「[伏笔内容] —— 关联[后文章节与事件]」，
     优先按破折号切出「伏笔正文」与「关联目标」两段。 */
  let text = clean;
  let targetText = "";
  let targetChapter: number | null = null;

  const sepMatch = /\s*(?:——|—|─{2,}|→|=>|\|)\s*/.exec(clean);
  if (sepMatch && sepMatch.index > 0) {
    text = clean.slice(0, sepMatch.index);
    targetText = clean.slice(sepMatch.index + sepMatch[0].length).trim();
  }

  const tailHit = targetText ? chapterRe.exec(targetText) : null;
  if (tailHit) {
    targetChapter = toNum(tailHit[1]);
  } else {
    /* 无破折号时，退回识别行内「收回点 / 关联 第X章」标注并裁掉该尾巴。 */
    const inlineHit =
      /[-—─→>|~～\s]*(?:(?:收回点|目标收回|收回|回收|关联|对应|埋设|呼应|指向|伏线)\s*(?:后文|后续|下文)?\s*)?[（(]?\s*第\s*([0-9一二三四五六七八九十百零]+)\s*章/.exec(
        clean,
      );
    if (inlineHit) {
      targetChapter = toNum(inlineHit[1]);
      if (!sepMatch && inlineHit.index > 0) {
        text = clean.slice(0, inlineHit.index);
        targetText = clean.slice(inlineHit.index).trim();
      }
    }
  }

  text = text
    .replace(/^(?:(?:\*\*|【)?(?:伏笔记录|伏笔呈现|伏笔|线索)(?:\*\*|】)?[:：\s]*)/, "")
    .replace(/[*_~`]/g, "")
    .replace(/[-—─→>|~～、，,；;：:\s]+$/, "")
    .trim();
  if (!text) text = clean.replace(/[*_~`]/g, "").trim();

  return { text, targetChapter, targetText: targetText || undefined };
}

/* ================= 细纲文档解析 ================= */

/** 【伏笔】块起始标记（含同行内联首条内容）。 */
const FB_BLOCK_RE = /【\s*(?:伏笔|伏笔呈现|伏笔记录|伏笔埋设|伏笔线索|线索埋设)\s*】\s*[:：]?\s*(.*)$/i;
/** 无书名号的裸标题写法：「### 伏笔」「**伏笔**：」。 */
const FB_BARE_HEAD_RE = /^[#>*_~\s-]*(?:伏笔呈现|伏笔记录|伏笔埋设|伏笔线索|线索埋设|伏笔)[*_~`\s]*[:：]?[*_~`\s]*$/;
/** 本节构成块标记。 */
const SECTION_BLOCK_RE = /【\s*(?:本节构成|细纲|场景|节构成|小节构成|场景规划)\s*】/i;
/** 任意【…】块标题（用于关闭伏笔区域）。 */
const ANY_BLOCK_RE = /^[*_~`\s]*【[^】]{1,20}】/;

export function parseVolumeOutline(content: string): OutlineChapter[] {
  if (!content || !content.trim()) return [];

  const chapters: OutlineChapter[] = [];
  const lines = content.split(/\r?\n/);

  let curChapter: OutlineChapter | null = null;
  let curSection: OutlineSection | null = null;
  let fbBuffer: string[] = [];
  let inForeshadowBlock = false;
  let sectionCounter = 1;

  /* 伏笔区域收尾：整段一起切条，避免「一行多条 / 一条多行」被漏计或错并。 */
  const flushForeshadows = () => {
    inForeshadowBlock = false;
    if (fbBuffer.length === 0) return;
    const entries = splitForeshadowEntries(fbBuffer);
    fbBuffer = [];
    if (!curChapter) return;
    for (const entry of entries) {
      const fb = parseForeshadowLine(entry);
      if (fb.text) curChapter.foreshadows.push(fb);
    }
  };

  const commitSection = () => {
    if (curChapter && curSection) {
      if (
        curSection.label ||
        curSection.situation ||
        curSection.desire ||
        curSection.conflict ||
        curSection.turn ||
        curSection.result
      ) {
        if (!curSection.label) {
          curSection.label = `场景 ${sectionCounter++}`;
        }
        curChapter.sections.push({ ...curSection });
      }
      curSection = null;
    }
  };

  const commitChapter = () => {
    flushForeshadows();
    commitSection();
    if (curChapter) {
      if (curChapter.sections.length > 0 || curChapter.foreshadows.length > 0 || curChapter.title.trim()) {
        const existing = chapters.find((c) => c.num === curChapter!.num);
        if (existing) {
          existing.sections.push(...curChapter.sections);
          existing.foreshadows.push(...curChapter.foreshadows);
          if (!existing.title && curChapter.title) existing.title = curChapter.title;
        } else {
          chapters.push(curChapter);
        }
      }
      curChapter = null;
    }
    sectionCounter = 1;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;

    // 1. 章节标题识别
    const chapInfo = detectChapterInfo(line);
    if (chapInfo !== null) {
      commitChapter();
      curChapter = {
        num: chapInfo.num,
        title: chapInfo.title,
        sections: [],
        foreshadows: [],
      };
      continue;
    }

    if (!curChapter) {
      curChapter = { num: 0, title: "", sections: [], foreshadows: [] };
    }

    // 2. 伏笔块标识（【伏笔】独立成行 / 同行带首条内容 / 「### 伏笔」裸标题）
    const fbBlockMatch = FB_BLOCK_RE.exec(line);
    const isBareForeshadowHeading = !fbBlockMatch && FB_BARE_HEAD_RE.test(line);
    if (fbBlockMatch || isBareForeshadowHeading) {
      flushForeshadows();
      commitSection();
      inForeshadowBlock = true;
      const inlineRest = ((fbBlockMatch && fbBlockMatch[1]) || "").replace(/^[*_~`]+|[*_~`]+$/g, "").trim();
      if (inlineRest) fbBuffer.push(inlineRest);
      continue;
    }
    // 本节构成块标识
    if (SECTION_BLOCK_RE.test(line)) {
      flushForeshadows();
      commitSection();
      continue;
    }
    // 其它【…】块标题（【五线落实对照】【场面设计】…）：关闭伏笔区域，避免吞掉后续内容
    if (inForeshadowBlock && ANY_BLOCK_RE.test(line)) {
      flushForeshadows();
    }

    // 3. 独立伏笔行识别（「伏笔：xxx」单行写法，不进入区域模式）
    if (/^(?:[-*+\d.、\s]+)?(?:\*\*|【)?(?:伏笔记录|伏笔呈现|伏笔|线索)(?:\*\*|】)?[:：]/.test(line)) {
      flushForeshadows();
      commitSection();
      const fb = parseForeshadowLine(line);
      if (fb.text) curChapter.foreshadows.push(fb);
      continue;
    }

    if (inForeshadowBlock) {
      /* 伏笔区域内出现五要素标签，说明已切回本节构成，交还后续流程处理。 */
      if (!matchDramaTag(line)) {
        fbBuffer.push(line);
        continue;
      }
      flushForeshadows();
    }

    // 3.5 区域外的带圈序号伏笔行（需带「关联 / 收回 / 第X章」等线索特征，
    //     避免误吞本节构成条目）
    if (
      new RegExp(`^[${CIRCLED_CHAR}]\\s*`).test(line) &&
      /(?:关联|收回|回收|呼应|对应|指向|伏笔|伏线|埋设|第\s*[0-9一二三四五六七八九十百零]+\s*章)/.test(line)
    ) {
      commitSection();
      for (const entry of splitForeshadowEntries([line])) {
        const fb = parseForeshadowLine(entry);
        if (fb.text) curChapter.foreshadows.push(fb);
      }
      continue;
    }

    // 4. 解析戏剧五要素（情境 / 欲望 / 冲突 / 转变 / 结果）
    const dt = matchDramaTag(line);
    if (dt) {
      if (!curSection) {
        curSection = { label: `场景 ${sectionCounter++}`, anchor: dt.val.slice(0, 16) };
      }
      curSection[dt.key] = dt.val;
      continue;
    }

    // 5. 识别新小节/场景标题
    const secHeadMatch = /^(?:[-*+\d.\s]+|#{1,6}\s*)?(?:场景|节|小节|分节|段落)[\s\d一二三四五六七八九十：:]*(.*)/i.exec(line);
    if (secHeadMatch) {
      commitSection();
      const rawTitle = secHeadMatch[1].trim() || line.replace(/^[-*+\d.\s#]+/, "").trim();
      const anchor = rawTitle.split(/[（(：:|]/)[0].trim() || rawTitle;
      curSection = { label: rawTitle, anchor };
      continue;
    }

    // 6. 普通列表项
    if (/^[-*+]\s+/.test(line) || /^\d+[.、]\s*/.test(line)) {
      commitSection();
      const text = line.replace(/^[-*+\d.、\s]+/, "").trim();
      curSection = {
        label: text.split(/[（(：:|]/)[0].trim() || text.slice(0, 16),
        anchor: text.slice(0, 15),
      };
    }
  }

  commitChapter();
  return chapters;
}

/* ================= 文档甄别 ================= */

/** 非正文规划文档（大纲 / 细纲 / 设定等），编辑它们本身时需屏蔽侧轨。 */
export function isNonMainDocument(file?: {
  title?: string;
  content?: string;
  folderId?: string | null;
}): boolean {
  if (!file) return false;
  const title = (file.title || "").trim().toLowerCase();
  const content = (file.content || "").slice(0, 1500).toLowerCase();

  const titleKeywords = [
    "大纲", "细纲", "卷纲", "章纲", "分章", "梗概", "设定", "人物", "世界观",
    "地图", "灵感", "素材", "草稿", "前言", "目录", "总结", "卡片", "卷一",
    "卷二", "卷三", "卷四", "卷五", "卷六", "卷七", "卷八", "卷九", "卷十",
    "outline", "setting", "world", "character", "draft", "notes"
  ];
  if (titleKeywords.some((k) => title.includes(k))) return true;

  if (
    /^(?:#{1,3}\s*)?(?:卷纲|细纲|章纲|大纲|分章大纲|人物设定|世界观|场景规划|故事线索|伏笔汇总|资料库)/i.test(content) ||
    /【(?:本节构成|细纲|场景规划|核心看点|伏笔|收回点|人物关系|角色列表)】/.test(content)
  ) {
    return true;
  }

  return false;
}

/** 严格判定「细纲」文档，避免把纯大纲当成细纲。 */
export function isDetailedOutlineDocument(file?: { title?: string; content?: string }): boolean {
  if (!file) return false;
  const title = (file.title || "").trim();
  const content = (file.content || "").slice(0, 2000);

  const isExplicitDetailedTitle = /细纲|章纲|分章细纲|场景规划/i.test(title);
  const isPureGeneralOutlineTitle = /(?:总大纲|主线大纲|剧情大纲|大纲|分卷大纲)(?!.*细纲)/i.test(title);

  if (isExplicitDetailedTitle) return true;
  if (isPureGeneralOutlineTitle) return false;

  if (/【\s*(?:本节构成|细纲|场景规划|分节细纲|节构成)\s*】/i.test(content)) {
    return true;
  }

  return false;
}

/** 在文档列表里检索当前正文对应的细纲文档：优先同文件夹。 */
export function findDetailedOutlineFile<T extends { id: string; folderId?: string | null; title?: string; content?: string }>(
  files: T[],
  currentFileId: string | null,
): T | undefined {
  if (!files || files.length === 0) return undefined;
  const current = files.find((f) => f.id === currentFileId);

  // 1. 优先同文件夹下的细纲文档
  if (current && current.folderId) {
    const sameFolderOutline = files.find(
      (f) => f.folderId === current.folderId && isDetailedOutlineDocument(f)
    );
    if (sameFolderOutline) return sameFolderOutline;
  }

  // 2. 检索所有文件中的细纲
  return files.find((f) => isDetailedOutlineDocument(f));
}

/** 汇总「以某章为收回点」的前置伏笔。 */
export function buildPayoffMap(
  outline: OutlineChapter[],
): Map<number, { count: number; items: { text: string; from: string }[] }> {
  const m = new Map<number, { count: number; items: { text: string; from: string }[] }>();
  for (const ch of outline) {
    for (const fb of ch.foreshadows) {
      if (fb.targetChapter === null) continue;
      const entry = m.get(fb.targetChapter) ?? { count: 0, items: [] as { text: string; from: string }[] };
      entry.count++;
      const fromLabel = ch.num === 0 ? (ch.title ? `序章 · ${ch.title}` : "序章") : `第${ch.num}章`;
      entry.items.push({ text: fb.text, from: fromLabel });
      m.set(fb.targetChapter, entry);
    }
  }
  return m;
}

/* ================= 正文定位（侧栏点击跳转） ================= */

/** 归一化：去 Markdown 记号与标点，只留可比对的字面内容。 */
export function normText(t: string): string {
  return (t || "")
    .replace(/[*_~>#`]/g, "")
    .replace(
      /[\s：:。，,．！？!?·…、"'“”‘’「」『』（）()〔〕\[\]【】《》〈〉—–\-~～;；]/g,
      "",
    );
}

/**
 * 把侧栏条目文本转成检索键。
 *
 * 细纲里的伏笔写法是「[伏笔内容] —— 关联第X章…（说明…）」，
 * 其中「—— 关联…」与括注说明都是规划用的元信息，正文里不会出现，
 * 必须先剥掉，否则拿去正文里检索必然落空。
 */
export function toSearchKey(raw: string): string {
  const stripped = (raw || "")
    .replace(/^[\s\-*+>#]+/, "")
    .replace(/^[①-⑳⒈-⒛㈠-㈩]\s*/, "")
    .replace(/^[（(]\s*\d{1,2}\s*[)）]\s*/, "")
    .replace(/^\d{1,2}\s*[.、．]\s*/, "")
    .replace(/(?:——|—|─{2,}|→|=>)[\s\S]*$/, "")
    .replace(
      /(?:关联|收回点|收回|回收|呼应|对应|指向|埋设)\s*(?:后文|后续|下文)?\s*第\s*[0-9一二三四五六七八九十百零]+\s*章[\s\S]*$/,
      "",
    )
    .replace(/^(?:\*\*|【)?(?:伏笔记录|伏笔呈现|伏笔|线索)(?:\*\*|】)?[:：]\s*/, "")
    .replace(/[（(][^）)]{0,40}[）)]/g, "");
  return normText(stripped).slice(0, 40);
}

/** 高频虚词 / 通用字：仅由它们构成的重合不算有效线索。 */
const COMMON_CHARS = new Set(
  "的了着是在有和与不之其为以而且也就都上下里外前后这那他她它我你们个一二三四五六七八九十只把被对于从向到还又再很更最没要会能可说道看见".split(
    "",
  ),
);

export interface BlockMatch {
  index: number;
  score: number;
  exact: boolean;
}

/** 计算单个正文块与检索键的匹配得分（0~1）。 */
export function scoreBlockMatch(key: string, text: string): number {
  const k = normText(key).slice(0, 40);
  const t = normText(text);
  if (!k || !t) return 0;

  if (t.includes(k)) return 1.0;

  let totalNonCommon = 0;
  for (let i = 0; i < k.length; i++) {
    if (!COMMON_CHARS.has(k[i])) totalNonCommon++;
  }
  if (totalNonCommon === 0) return 0;

  const coveredIndices = new Set<number>();
  let maxSegmentLen = 0;
  let numSegments = 0;

  /* 按「不重叠的最长片段」扫描：让「梁上」+「红绸」这类分散线索累计加分，
     从而胜过只在同一段落里凑出的单个长片段。 */
  let i = 0;
  while (i + 1 < k.length) {
    let len = 0;
    for (let j = i + 2; j <= k.length; j++) {
      const sub = k.slice(i, j);
      if (t.includes(sub)) {
        len = j - i;
      } else {
        break;
      }
    }
    if (len >= 2) {
      const subStr = k.slice(i, i + len);
      let hasNonStop = false;
      for (let x = 0; x < subStr.length; x++) {
        if (!COMMON_CHARS.has(subStr[x])) {
          hasNonStop = true;
          break;
        }
      }
      if (hasNonStop) {
        numSegments++;
        if (len > maxSegmentLen) maxSegmentLen = len;
        for (let x = i; x < i + len; x++) coveredIndices.add(x);
        i += len;
        continue;
      }
    }
    i++;
  }

  if (coveredIndices.size === 0) return 0;

  let coveredNonCommon = 0;
  for (const idx of coveredIndices) {
    if (!COMMON_CHARS.has(k[idx])) coveredNonCommon++;
  }

  if (coveredNonCommon === 0) return 0;

  const coverageRatio = coveredNonCommon / totalNonCommon;
  const lenBonus = Math.min(1.0, maxSegmentLen / 4);
  const segmentBonus = Math.min(0.3, (numSegments - 1) * 0.15);

  return coverageRatio * 0.5 + lenBonus * 0.25 + segmentBonus;
}

/**
 * 在正文块里找与检索键最相近的一块。
 *
 * 侧栏条目（尤其是伏笔）是细纲里的概括说法，与正文措辞往往不是逐字相同
 * （细纲「判官笔上的暗红指痕」↔ 正文「判官笔，笔杆上有一抹早已发暗的红」），
 * 因此按「整串命中 → 包含实词的片段覆盖率 + 最长片段 + 离散线索数」综合打分，
 * 并避开 Markdown 空行块；达不到阈值宁可不跳，也不要跳错地方。
 *
 * 返回 index = -1 表示未命中。
 */
export function pickBestBlock(key: string, blockTexts: string[]): BlockMatch {
  const k = normText(key).slice(0, 40);
  const miss: BlockMatch = { index: -1, score: 0, exact: false };
  if (!k) return miss;

  let best = miss;

  for (let i = 0; i < blockTexts.length; i++) {
    const raw = blockTexts[i];
    const text = normText(raw);
    /* 空块（Markdown 空行）必须跳过：旧实现里 anchor.includes("") 恒为 true，
       导致所有跳转都落在文档里第一个空行上。 */
    if (!text) continue;

    if (text.includes(k)) {
      return { index: i, score: 1.0, exact: true };
    }

    /* 短键（人名 / 地名 <= 3 字）只认精确命中，避免误跳。 */
    if (k.length <= 3) continue;

    const score = scoreBlockMatch(k, text.slice(0, 600));
    if (score > best.score) {
      best = { index: i, score, exact: false };
    }
  }

  if (best.index >= 0 && best.score >= 0.25) {
    return best;
  }
  return miss;
}

