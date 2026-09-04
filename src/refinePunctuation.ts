/**
 * 精修的「标点保护」合并。
 *
 * 模型很喜欢顺手把「，」换成「,」、给句子补个破折号、或者删掉一个引号。
 * 这类改动对正文毫无价值，却会让「全部修订」之后的原文标点面目全非。
 * 精修的职责是修订正文内容，标点的**写法**一律以原文为准。
 *
 * 保护分两档，核心原则是「宁可让标点将就，也不放过一次真实的内容修订」：
 *
 * 甲档 · 原位合并（首选）。适用于模型没动断句结构的绝大多数改写：
 *  1. 把两边各自拆成「实义字符流」+「标点及其所在的内容间隙」；
 *  2. 正文内容整段采用精修稿（这才是精修该做的事）；
 *  3. 把原文的标点逐个放回新内容流：
 *     - 优先按「标点类别序列」与精修稿的标点配对，配上了就用精修稿给出的
 *       位置（模型知道改写后的逗号该落在哪），但字符形态取原文；
 *     - 配不上的（精修稿把标点删了）退回用内容流 LCS 映射出的间隙；
 *     - 精修稿自己新增的标点一律丢弃。
 *   最后强制标点顺序单调，保证原文的标点次序不被打乱。
 *
 * 乙档 · 降级采纳（兜底）。模型确实调整了断句（拆句、合句、改分句），
 * 甲档的位置映射会失真——早先的做法是整句退回原文，代价是把模型真正做出的
 * 内容修订一并丢掉，实测约四分之一的有效改写死在这里。现在改为降级：
 *  1. 断句位置交给精修稿（既然它重排了句式，它自己的断句才是自洽的）；
 *  2. 标点的**写法**仍按原文归一（原文用全角就全角，原文用「」就不给你换成“”）；
 *  3. 句末标点强制对齐原文（原文以「。」收尾，结果也以「。」收尾）；
 *  4. 原文里没出现过的符号类字符（markdown 的 * # ` 之类噪声）一律剔除。
 *
 * 两档都不适用的只剩三种真正无价值的情况：模型原样照抄、只改了标点写法、
 * 或者答坏了（没有实义内容 / 过度扩写）。这三种退回原文。
 *
 * 空白不算标点：它跟着内容流走精修稿（中文正文内部本没有空格，
 * 英文的词间空格必须跟新词一起进来）。句首 / 句尾的空白（段落换行）
 * 由 mergeRefined 单独原样保留。
 *
 * 单独成模块（而非留在 RefineView.vue 里）以便独立测试与复用。
 */

/** 标点与符号：中英文标点、引号书名号括号、破折号省略号、数学与货币符号。 */
const PUNCT_RE = /[\p{P}\p{S}~～·・]/u;

function isPunct(ch: string): boolean {
  return PUNCT_RE.test(ch);
}

/**
 * 标点类别：把「同一种用途、不同写法」的标点归一到一类，
 * 这样「，↔,」「。↔.」「“↔「」这类纯形态替换能被认出来并配对。
 */
function punctClass(ch: string): string {
  if ("，,、".includes(ch)) return "comma";
  if ("。.".includes(ch)) return "period";
  if ("！!".includes(ch)) return "excl";
  if ("？?".includes(ch)) return "question";
  if ("；;".includes(ch)) return "semi";
  if ("：:".includes(ch)) return "colon";
  if ("“”\"『』「」‘’'".includes(ch)) return "quote";
  if ("（）()【】〔〕[]{}《》〈〉<>".includes(ch)) return "bracket";
  if ("—–－-─~～".includes(ch)) return "dash";
  if ("…‥·・".includes(ch)) return "ellipsis";
  return ch;
}

/**
 * 只留实义字符的比较键：标点与空白全部剔除。
 * 两句的这个键相同 → 差异纯在标点 / 空白，整句应当退回原文。
 */
export function contentKey(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!isPunct(ch) && !/\s/.test(ch)) out += ch;
  }
  return out;
}

/** 拆出首尾空白：断句时段落换行会挂在句首，必须原样带回，否则段落结构会丢。 */
function splitEdges(text: string): { lead: string; core: string; tail: string } {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const rest = text.slice(lead.length);
  const tail = rest.match(/\s*$/)?.[0] ?? "";
  return { lead, core: rest.slice(0, rest.length - tail.length), tail };
}

interface PunctMark {
  /** 它前面有多少个实义字符（即所在的内容间隙）。 */
  gap: number;
  ch: string;
}

interface Split {
  /** 实义字符流（含空白，不含标点）。 */
  content: string[];
  puncts: PunctMark[];
}

function splitPunct(text: string): Split {
  const content: string[] = [];
  const puncts: PunctMark[] = [];
  for (const ch of text) {
    if (isPunct(ch)) puncts.push({ gap: content.length, ch });
    else content.push(ch);
  }
  return { content, puncts };
}

/** 通用的字符/字符串序列 LCS 回溯，返回配对下标。 */
function lcsPairs(a: string[], b: string[]): { ai: number; bi: number }[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: { ai: number; bi: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push({ ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * 把原文内容流的每个间隙映射到精修内容流的间隙。
 *
 * 返回长度为 o.length + 1 的单调不降数组。插入（精修稿新增的内容）也会把
 * 当前间隙的映射值往后推，否则「换掉句首几个词」时逗号会被顶到新内容之前。
 * 间隙 0 例外：句首标点（比如开引号）永远留在句首。
 */
function mapGaps(o: string[], r: string[]): number[] {
  const n = o.length;
  const m = r.length;
  const map = new Array<number>(n + 1).fill(0);

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = o[i] === r[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  const note = () => {
    if (i > 0) map[i] = j;
  };
  while (i < n && j < m) {
    if (o[i] === r[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
    note();
  }
  while (i < n) {
    i++;
    note();
  }
  while (j < m) {
    j++;
    note();
  }
  /* 单调化兜底：任何情况下映射都不该回退。 */
  for (let k = 1; k <= n; k++) {
    if (map[k] < map[k - 1]) map[k] = map[k - 1];
  }
  return map;
}

/**
 * 甲档 · 原位合并：以原文标点为基准，吸收精修稿的内容改动。
 *
 * - 精修稿删掉的标点 → 按原文位置补回；
 * - 精修稿新增的标点 → 丢弃；
 * - 精修稿只是换了标点写法 → 位置沿用精修稿，字符用原文的；
 * - 实义文字的增删改 → 按精修稿采纳。
 *
 * 返回 null 表示位置映射失真（模型重排了断句），交由乙档降级处理，
 * 不再像早先那样整句退回原文——那会把模型真正做出的内容修订一并丢掉。
 */
function mergeInPlace(originalCore: string, refinedCore: string): string | null {
  const o = splitPunct(originalCore);
  const r = splitPunct(refinedCore);

  if (o.content.length === 0) return null;
  if (r.content.length === 0) return null;

  /* 超长串（正常断句不会出现）放弃逐字对齐，交给乙档。 */
  if (o.content.length * r.content.length > 2_000_000) return null;

  const contentMap = mapGaps(o.content, r.content);

  /* 标点按类别序列配对：配上的直接采用精修稿给出的间隙。 */
  const paired = new Map<number, number>();
  if (o.puncts.length && r.puncts.length) {
    for (const { ai, bi } of lcsPairs(
      o.puncts.map((p) => punctClass(p.ch)),
      r.puncts.map((p) => punctClass(p.ch)),
    )) {
      paired.set(ai, r.puncts[bi].gap);
    }
  }

  /* 逐个落位，并强制间隙单调不降，保住原文的标点先后次序。 */
  const buckets: string[][] = Array.from({ length: r.content.length + 1 }, () => []);
  const placed: { gap: number; oGap: number; ch: string; paired: boolean }[] = [];
  let minGap = 0;
  o.puncts.forEach((p, index) => {
    const fallback = contentMap[Math.min(p.gap, contentMap.length - 1)];
    const wanted = paired.get(index) ?? fallback;
    const gap = Math.min(r.content.length, Math.max(minGap, wanted));
    placed.push({ gap, oGap: p.gap, ch: p.ch, paired: paired.has(index) });
    buckets[gap].push(p.ch);
    minGap = gap;
  });

  /* 落位失真检查：模型的句式重排有时会让位置映射失效——原句里本不相邻的标点
     被挤进同一个内容间隙（表现为「，」/「。」插进词的中间、句末标点丢失），
     或把句中标点顶到整句最前面。这类合并交给乙档，不产出坏句子。 */
  const slotGroups = new Map<number, { oGap: number }[]>();
  for (const pl of placed) {
    const list = slotGroups.get(pl.gap) ?? [];
    list.push(pl);
    slotGroups.set(pl.gap, list);
  }
  for (const [, list] of slotGroups) {
    if (list.length < 2) continue;
    /* 只有原文里也处于同一间隙（本就是连写的「？！」「……」之类）才算合法。 */
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        if (list[a].oGap !== list[b].oGap) return null;
      }
    }
  }
  /* 句中（原文里前面有正文）的标点不该合并到句首位置。 */
  if (placed.length > 0 && placed[0].gap === 0 && placed[0].oGap > 0) return null;

  /* 未配对的标点靠内容映射落位：若它右侧紧跟的原文实义字符恰好被模型删掉
     （contentMap 在两个相邻切口之间没有前进），落点会悬在被重排的词中间
     （如把「变了」拆成「变，了」）。这类落位不可靠，交给乙档。 */
  const n = o.content.length;
  for (const pl of placed) {
    if (pl.paired) continue;
    const g = pl.oGap;
    if (g < 0 || g >= n) continue;
    if (contentMap[g] === contentMap[g + 1]) return null;
  }

  let out = "";
  for (let k = 0; k <= r.content.length; k++) {
    out += buckets[k].join("");
    if (k < r.content.length) out += r.content[k];
  }

  /* 句末标点必须还落在句末。模型在句中加了个句号时，类别配对会把原文的句末
     句号配到那个中间的句号上，结果就是句号插进句子中间、整句没有收尾标点。
     全文最终稿是把各句直接拼回去的，句子边界丢了会让整篇结构漂移 ——
     这类结果交给乙档（按模型自己的断句走，再把句末对齐原文）。 */
  const origTail = trailingPunct(originalCore);
  if (origTail && trailingPunct(out) !== origTail) return null;

  return out;
}

/* ---------------- 乙档 · 降级采纳 ---------------- */

/** markdown / 排版噪声：原文里没出现过就一律剔除，别让它混进正文。 */
const NOISE_RE = /[*_`#|>~^\\]/;

/** 半角 → 全角的安全对照（角色单一、不涉及成对引号书名号）。 */
const HALF_TO_FULL: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
  "(": "（",
  ")": "）",
};

const FULL_TO_HALF: Record<string, string> = Object.fromEntries(
  Object.entries(HALF_TO_FULL).map(([half, full]) => [full, half]),
);

/**
 * 标点写法归一：把精修稿的标点写法拉回原文的风格（全角 / 半角）。
 *
 * 只处理角色单一的那几个（，。！？；：（）），成对的引号书名号不碰——
 * 「“」和「”」同属一类却角色相反，按类归一会把右引号错换成左引号。
 * 数字 / 拉丁词内部的标点（3.14、1,000、e.g.）一律照原样留着。
 */
function normalizePunctWidth(originalCore: string, text: string): string {
  let full = 0;
  let half = 0;
  for (const ch of originalCore) {
    if (FULL_TO_HALF[ch]) full++;
    else if (HALF_TO_FULL[ch]) half++;
  }
  /* 原文没有可判风格的标点 → 不动；两种都有时以多数为准。 */
  if (full === 0 && half === 0) return text;
  const toFull = full >= half;

  const chars = Array.from(text);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const prev = chars[i - 1] ?? "";
    const next = chars[i + 1] ?? "";
    if (/[0-9A-Za-z]/.test(prev) && /[0-9A-Za-z]/.test(next)) {
      out += ch;
      continue;
    }
    out += (toFull ? HALF_TO_FULL[ch] : FULL_TO_HALF[ch]) ?? ch;
  }
  return out;
}

/** 句末那一串标点（含「。」」这类句号 + 右引号的组合）。 */
function trailingPunct(text: string): string {
  let i = text.length;
  while (i > 0 && isPunct(text[i - 1])) i--;
  return text.slice(i);
}

/**
 * 乙档 · 降级采纳：模型确实重排了断句时，采纳它的内容与断句，
 * 但把标点写法拉回原文风格，并强制句末标点与原文一致。
 *
 * 句末对齐这一条不只是审美：全文最终稿是把各句直接拼回去的，句末标点决定了
 * 后续重新断句时的句子边界。保持它与原文一致，整篇的句子结构就不会漂移。
 */
function mergeRelaxed(originalCore: string, refinedCore: string): string | null {
  /* 剔噪：原文没用过的 markdown / 排版符号不许带进正文。 */
  let text = "";
  for (const ch of refinedCore) {
    if (NOISE_RE.test(ch) && !originalCore.includes(ch)) continue;
    text += ch;
  }
  text = normalizePunctWidth(originalCore, text).trim();
  if (!contentKey(text)) return null;

  const origTail = trailingPunct(originalCore);
  if (origTail) {
    const refTail = trailingPunct(text);
    const body = text.slice(0, text.length - refTail.length).replace(/\s+$/, "");
    if (!contentKey(body)) return null;
    text = body + origTail;
  }
  return text.trim() || null;
}

/* ---------------- 对外入口 ---------------- */

/**
 * 单句合并的结果分类。UI 据此如实告知用户这一句「为什么没改 / 怎么改的」，
 * 而不是把三四种完全不同的情况都说成「已按标点保护还原为原文」。
 */
export type RefineOutcome =
  /** 甲档：采纳了内容改动，标点完全按原文。 */
  | "merged"
  /** 乙档：模型重排了断句，已降级采纳（标点写法归一、句末对齐原文）。 */
  | "relaxed"
  /** 模型原样照抄了这一句 —— 它判定本句无需修改。 */
  | "verbatim"
  /** 模型只动了标点 / 空白，没有内容改动。 */
  | "punct-only"
  /** 模型没给出这一句（缺行、空行、只回了标点）。 */
  | "empty"
  /** 模型答坏了：过度扩写、或把说明文字当成正文回了过来。 */
  | "runaway";

export interface MergeResult {
  text: string;
  outcome: RefineOutcome;
}

/**
 * 过度扩写的门槛。
 *
 * 精修要求「保持原句长度」，但这一关只拦真正跑飞的情况（模型把分析过程、
 * 多个候选方案或整段扩写塞进了这一行）。门槛给得很松：既然目的是让修订
 * 真正落地，正常的改写一律放过。
 */
function isRunaway(originalCore: string, refinedCore: string): boolean {
  const o = contentKey(originalCore).length;
  const r = contentKey(refinedCore).length;
  if (o === 0) return false;
  return r > o * 2.5 && r > o + 40;
}

/**
 * 把模型返回的一行合并成本句的最终精修稿。
 *
 * 处理顺序：
 *  1. 空行 / 缺行 / 只回了标点 → 原句（empty）；
 *  2. 逐字照抄 → 原句（verbatim，模型判定本句无需修改）；
 *  3. 只差标点或空白 → 原句（punct-only，一个符号都不动）；
 *  4. 过度扩写 → 原句（runaway）；
 *  5. 甲档原位合并成功 → 采纳（merged）；
 *  6. 甲档失真 → 乙档降级采纳（relaxed）；
 *  7. 两档都产不出有效结果 → 原句（runaway）。
 *
 * 首尾空白（段落换行）始终沿用原句，避免精修后段落被压成一整块。
 */
export function mergeRefined(original: string, rawRefined: string): MergeResult {
  const refinedTrimmed = rawRefined.trim();
  const { lead, core, tail } = splitEdges(original);
  const wrap = (text: string): string => lead + text + tail;

  if (!refinedTrimmed) return { text: original, outcome: "empty" };
  if (!core) return { text: original, outcome: "empty" };
  if (!contentKey(refinedTrimmed)) return { text: original, outcome: "empty" };

  if (refinedTrimmed === core) return { text: original, outcome: "verbatim" };
  /* 内容键一致 → 差异纯在标点 / 空白，整句退回原文。 */
  if (contentKey(refinedTrimmed) === contentKey(core)) {
    return { text: original, outcome: "punct-only" };
  }
  if (isRunaway(core, refinedTrimmed)) return { text: original, outcome: "runaway" };

  const inPlace = mergeInPlace(core, refinedTrimmed);
  if (inPlace && inPlace.trim() && inPlace !== core) {
    return { text: wrap(inPlace), outcome: "merged" };
  }

  const relaxed = mergeRelaxed(core, refinedTrimmed);
  if (relaxed && relaxed !== core) {
    /* 降级结果的内容若与原文无异（只剩标点差别），仍按「只改了标点」处理。 */
    if (contentKey(relaxed) === contentKey(core)) {
      return { text: original, outcome: "punct-only" };
    }
    return { text: wrap(relaxed), outcome: "relaxed" };
  }

  return { text: original, outcome: "runaway" };
}
