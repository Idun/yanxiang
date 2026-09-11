/**
 * 虚词清理：「一键去了字」「一键去的地得」背后的规则引擎。
 *
 * 无差别 `text.replace(/了/g, "")` 会把「了解」削成「解」、把「他走了。」削成
 * 「他走。」、把代码块里的字符也一并吃掉。这里做的是**逐个出现位置单独判**：
 * 每一个「了 / 的 / 地 / 得」都先问一句「删掉它句子还成立吗」，成立才删。
 *
 * 判断完全靠规则，不联网、不调模型，因此它的定位是「稳妥的减法」——
 * 拿不准的一律保留。宁可少删几个，也不肯赌一次把句子改坏。
 *
 * 四个字的性质差得很远，规则也各自独立：
 *
 *  - **了**：句末（后面是标点）的「了」表状态变化，删掉句子就断了，一律留；
 *    「V了V」（看了看）、「了 + 数量」（等了三年）、「了 + 语气词」（吃了吗）
 *    同样留。真正该删的是网文里最常见的那种句中堆砌——「他推开了门，
 *    走进了房间，看到了桌上的信」，这些「了」后面还接着实词，删掉毫发无伤。
 *
 *  - **的**：单个「的」通常是句子结构的一部分，删了会伤；真正的毛病是
 *    「的的不休」——一个小句里套三四个「的」。所以规则是**同一小句里多个
 *    「的」只留最后一个**（「他的手上的伤」→「他手上的伤」），外加
 *    「颜色/性/型/式 + 的 + 名词」这类公认可省的定语标记。
 *
 *  - **地**：只有作状语助词的「地」可删（慢慢地走 → 慢慢走）。作名词的
 *    「地」（土地、心地、当地、目的地）必须留，靠词表 + 前后字特征区分。
 *
 *  - **得**：补语标记（跑得快）、动词（获得、觉得）、助动词（我得走了）——
 *    这三种用法删掉必错，而「得」在中文里没有第四种用法。因此智能模式下
 *    「得」全部保留，这是规则本身的结论，不是没写完。
 *
 * 代码块、行内代码、链接地址、裸 URL、HTML 标签一律划成保护区，不参与清理。
 *
 * 单独成模块（而非塞在 DocumentViewer.vue 里）以便独立测试与复用。
 */

/** 可清理的四个虚词。 */
export type Particle = "了" | "的" | "地" | "得";

export const PARTICLES: readonly Particle[] = ["了", "的", "地", "得"];

/** 清理模式：smart = 保留必要用法，all = 无差别全删。 */
export type CleanupMode = "smart" | "all";

export interface ParticleStat {
  /** 实际删掉的个数。 */
  removed: number;
  /** 判定为「必要用法」而留下的个数（保护区内的不计入）。 */
  kept: number;
}

export interface CleanupResult {
  text: string;
  removed: number;
  kept: number;
  /** 逐字统计，用于在提示里说明「删了几个、留了几个」。 */
  perParticle: Record<Particle, ParticleStat>;
}

/* ------------------------------------------------------------------ *
 * 字符分类
 * ------------------------------------------------------------------ */

/** CJK 汉字（含扩展 A 区），用来判断前后是不是实词。 */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 标点与符号：中英文标点、引号书名号括号、破折号省略号。 */
const PUNCT_RE = /[\p{P}\p{S}~～·・\s]/u;

function isHan(ch: string): boolean {
  return ch.length > 0 && HAN_RE.test(ch);
}

/** 空串（越界）也算边界：文首文末与标点同等对待。 */
function isBoundary(ch: string): boolean {
  return ch.length === 0 || PUNCT_RE.test(ch);
}

/** 数词与量词起手字：「等了三年」「走了一步」里的「了」删不得。 */
const NUMERAL = "0123456789０１２３４５６７８９一二两三四五六七八九十百千万亿零半几数整多"; 

function isNumeral(ch: string): boolean {
  return ch.length > 0 && NUMERAL.includes(ch);
}

/* ------------------------------------------------------------------ *
 * 保护区：代码块 / 行内代码 / 链接地址 / 裸 URL / HTML 标签
 * ------------------------------------------------------------------ */

const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?(?:```|$)/g, // 围栏代码块（未闭合时保护到文末）
  /~~~[\s\S]*?(?:~~~|$)/g,
  /`[^`\n]*`/g, // 行内代码
  /\]\([^)\n]*\)/g, // markdown 链接 / 图片的地址部分
  /https?:\/\/[^\s)）】」』]+/g, // 裸 URL
  /<[^>\n]{1,200}>/g, // HTML 标签
];

/** 逐字符标记「此处不许动」。返回长度与原文一致的布尔数组。 */
function buildProtectedMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const re of PROTECTED_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      for (let i = m.index; i < m.index + m[0].length; i += 1) mask[i] = true;
      if (m[0].length === 0) re.lastIndex += 1; // 防空匹配死循环
    }
  }
  return mask;
}

/* ------------------------------------------------------------------ *
 * 词表：命中即整体保护，词表优先级高于所有单字规则
 * ------------------------------------------------------------------ */

/** 含「了」且读 liǎo / 属固定搭配的词，「了」是词的一部分，删不得。 */
const LE_WORDS = [
  "了解", "了却", "了结", "了断", "了得", "了不得", "了不起", "了如指掌",
  "了然", "了无", "了当", "了账", "了债", "了了", "了却",
  "明了", "终了", "末了", "一目了然", "不了了之", "没完没了", "一了百了",
  "直截了当", "了无生趣", "了无生机", "了无音讯", "了无睡意",
  "除了", "为了", "罢了", "算了", "得了", "好了", "对了", "完了", "少了",
  "受不了", "吃不了", "免不了", "少不了", "大不了", "不得了", "忘不了",
  "跑不了", "错不了", "断不了", "停不了", "用不了", "等不了", "顾不了",
  "管不了", "忍不了", "来不了", "去不了", "走不了", "受得了", "吃得了",
  "顾得了", "管得了", "忍得了", "免得了", "解决不了", "解决得了",
];

/** 含「的」的固定词/结构，「的」删不得。 */
const DE1_WORDS = [
  "的确", "的话", "的士", "目的", "目的地", "标的", "端的", "的卢",
  "似的", "是的", "真的", "假的", "好的", "有的", "有的是", "别的",
  "什么的", "之类的", "的的确确", "无的放矢", "有的放矢",
];

/** 含「地」且读 dì（名词性）的词，「地」删不得。 */
const DI_WORDS = [
  "土地", "大地", "天地", "当地", "本地", "外地", "内地", "异地", "各地",
  "空地", "平地", "原地", "落地", "遍地", "满地", "就地", "实地", "基地",
  "阵地", "产地", "场地", "领地", "圣地", "境地", "余地", "心地", "见地",
  "质地", "驻地", "绝地", "胜地", "要地", "腹地", "凹地", "洼地", "盆地",
  "墓地", "营地", "禁地", "租地", "占地", "种地", "山地", "林地", "田地",
  "矿地", "雪地", "冰地", "沙地", "湿地", "高地", "低地", "陆地", "草地",
  "荒地", "耕地", "园地", "工地", "所在地", "根据地", "旧地", "故地",
  "两地", "一地", "遍地", "地方", "地上", "地下", "地面", "地球", "地区",
  "地位", "地图", "地板", "地铁", "地毯", "地道", "地址", "地狱", "地步",
  "地主", "地带", "地形", "地势", "地理", "地震", "地貌", "地皮", "地窖",
  "地牢", "地雷", "地摊", "地基", "地壳", "地块", "地段", "地界", "地名",
  "地库", "地堡", "地头", "地盘", "地产", "地点",
  /* 「猛地 / 忽地 / 蓦地」这类词里的「地」也不能删 */
  "猛地", "忽地", "霍地", "蓦地", "骤地", "倏地", "陡地", "特地", "驀地",
];

/** 命中词表：判断下标 i 上的字是否落在任一词的覆盖范围内。 */
function inWordList(text: string, i: number, words: string[]): boolean {
  const ch = text[i];
  for (const w of words) {
    /* 词里可能出现同一个字多次（了了 / 的的确确），每个对齐位置都试一遍。 */
    for (let k = w.indexOf(ch); k >= 0; k = w.indexOf(ch, k + 1)) {
      const start = i - k;
      if (start < 0 || start + w.length > text.length) continue;
      if (text.startsWith(w, start)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 小句切分：用于「的」的「一句只留一个的」规则
 * ------------------------------------------------------------------ */

/** 小句分隔符：句号叹号问号分号逗号顿号冒号、换行、引号书名号括号。 */
const CLAUSE_BREAK = "。！？；，、：\n\r…—“”‘’\"'（）()《》〈〉【】〔〕[]{}「」『』";

/**
 * 并列连词也当分段点：「我的书和他的笔」是两个并列短语，
 * 两个「的」各管各的，不算的的不休；切开后各成一段就不会被误删。
 */
const COORDINATORS = "和与跟及或并且但却而";

/** 返回 i 所在「小句 + 并列成分」段落的 [start, end) 区间。 */
function segmentRange(text: string, i: number): [number, number] {
  const isBreak = (ch: string) => CLAUSE_BREAK.includes(ch) || COORDINATORS.includes(ch);
  let start = i;
  while (start > 0 && !isBreak(text[start - 1])) start -= 1;
  let end = i;
  while (end < text.length && !isBreak(text[end])) end += 1;
  return [start, end];
}

/* ------------------------------------------------------------------ *
 * 「了」
 * ------------------------------------------------------------------ */

/** 「了」后面跟这些字时表示前一动作已完成并另起一层，删掉会断气。 */
const LE_KEEP_NEXT = "吗呢吧啊呀么嘛没不就才便又还也再之以后很太挺非十极更最好没算";

/**
 * 「V了」里 V 落在这里时，「了」是句子成立的必要成分：
 * 「他成了英雄」删掉就成了「他成英雄」，「他像了他父亲」同理。
 */
const LE_KEEP_PREV = "成像";

function shouldRemoveLe(text: string, i: number): boolean {
  const prev = text[i - 1] ?? "";
  const next = text[i + 1] ?? "";

  /* 词表里的「了」是词的一部分（了解 / 除了 / 受不了）。 */
  if (inWordList(text, i, LE_WORDS)) return false;
  /* 前面不是汉字（句首、标点后、英文后）：位置可疑，不碰。 */
  if (!isHan(prev)) return false;
  /* 「V不了 / V得了」：能愿补语，删了就成了另一个意思。 */
  if (prev === "不" || prev === "得") return false;
  /* 「成了 / 像了」：删掉句子立刻不通。 */
  if (LE_KEEP_PREV.includes(prev)) return false;
  /* 句末 / 小句末的「了」表状态变化：「他走了。」删掉句子就废了。 */
  if (isBoundary(next)) return false;
  /* 「看了看 / 想了想 / 试了试」。 */
  if (prev === next) return false;
  /* 「等了三年 / 走了一步」：后接数量，删掉时间跨度就没了。 */
  if (isNumeral(next)) return false;
  /* 「吃了吗 / 走了就 / 病了很久 / 吃了之后」。 */
  if (LE_KEEP_NEXT.includes(next)) return false;
  /* 剩下的是句中堆砌的完成体标记：「推开了门」「走进了房间」，可删。 */
  return isHan(next);
}

/* ------------------------------------------------------------------ *
 * 「的」
 * ------------------------------------------------------------------ */

/** 「的」后面跟这些字时属于固定结构（的是 / 的时候 / 的话 / 的了）。 */
const DE1_KEEP_NEXT = "是时话确士了吗呢吧啊呀么嘛";

/** 前面是这些字时「的」构成指示/疑问结构：这样的、那种的、什么的。 */
const DE1_KEEP_PREV = "样种类似般么谁哪某此是有别所";

/** 「颜色/属性 + 的 + 名词」里的「的」公认可省：红色的头发 → 红色头发。 */
const DE1_DROPPABLE_PREV = "色性型式";

/**
 * 「的」的三档：
 *  - structural：结构必需，任何情况都不删（句末的「的」、「的确」、「的时候」…）；
 *  - always：公认可省的定语标记（红色的头发 → 红色头发），单独出现也能删；
 *  - crowded：本身能成立、但挤在一起就啰嗦（他的手上的伤），
 *    只在同一段里还有别的「的」时才删，且永远保住最靠近中心语的那个。
 */
type DeKind = "structural" | "always" | "crowded";

function deIsStructural(text: string, i: number): boolean {
  const prev = text[i - 1] ?? "";
  const next = text[i + 1] ?? "";
  if (inWordList(text, i, DE1_WORDS)) return true;
  if (!isHan(prev)) return true;
  if (isBoundary(next)) return true; // 「这是我的。」「红色的，很好看」
  if (DE1_KEEP_PREV.includes(prev)) return true; // 「这样的人」
  if (DE1_KEEP_NEXT.includes(next)) return true; // 「说的是」「来的时候」
  if (!isHan(next)) return true;
  return false;
}

function classifyDe(text: string, i: number): DeKind {
  if (deIsStructural(text, i)) return "structural";
  if (DE1_DROPPABLE_PREV.includes(text[i - 1] ?? "")) return "always";
  return "crowded";
}

/**
 * 「的」的清理位置：先滤掉结构必需的，再按「小句 + 并列成分」切段——
 * 「我的书和他的笔」里的两个「的」分属两个并列短语，各自都得留；
 * 「他的手上的伤」是层层套叠，才是真正的的的不休，只留最后一个。
 */
function planDeRemovals(text: string, mask: boolean[]): Set<number> {
  const bySegment = new Map<string, { index: number; kind: DeKind }[]>();

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "的" || mask[i]) continue;
    const kind = classifyDe(text, i);
    if (kind === "structural") continue;
    const [start, end] = segmentRange(text, i);
    const key = `${start}-${end}`;
    const list = bySegment.get(key);
    if (list) list.push({ index: i, kind });
    else bySegment.set(key, [{ index: i, kind }]);
  }

  const remove = new Set<number>();
  for (const list of bySegment.values()) {
    /* 最靠后的那个「的」贴着中心语，除非它本身就是可省定语，否则一律留。 */
    for (let k = 0; k < list.length - 1; k += 1) remove.add(list[k].index);
    const last = list[list.length - 1];
    if (last.kind === "always") remove.add(last.index);
  }
  return remove;
}

/* ------------------------------------------------------------------ *
 * 「地」
 * ------------------------------------------------------------------ */

/** 「地」作名词时常见的后接字：地方、地上、地图……（词表兜不住的兜底）。 */
const DI_NOUN_NEXT = "方上下面球区位图板铁毯道址狱步主带形势理震貌皮窖牢雷摊心产基壳块段界名库堡头盘点";

/** 「地」作名词时常见的前接字：土地、当地、心地……。 */
const DI_NOUN_PREV = "土大天当本各内外工园基陆耕草荒圣领境余心见质产场所落驻阵绝胜要腹凹盆墓营禁租占种山林田矿雪冰沙湿高低洼旧故两遍满原空平实就特";

/** 状语末字：用力地、大声地、认真地、迅速地……前一个字落在这里即可判为助词。 */
const DI_ADVERB_PREV = "然力劲速声快慢重轻细真肃难苦烈狠猛急缓柔和静默暗偷冷热淡深浅远近高低大小好坏满全狂疯傻呆愣直硬软准稳狠温柔恭敬礼貌客气亲切热情冷漠自然";

function shouldRemoveDi(text: string, i: number): boolean {
  const prev = text[i - 1] ?? "";
  const prev2 = text[i - 2] ?? "";
  const next = text[i + 1] ?? "";

  /* 名词性的「地」：土地 / 心地 / 目的地 / 猛地，一律留。 */
  if (inWordList(text, i, DI_WORDS)) return false;
  if (!isHan(prev)) return false;
  /* 助词「地」永远接动词，不可能收尾。收尾的一定是名词。 */
  if (isBoundary(next)) return false;
  if (!isHan(next)) return false;
  if (DI_NOUN_NEXT.includes(next)) return false;
  if (DI_NOUN_PREV.includes(prev)) return false;

  /* 到这里才敢认作状语助词，且要求有正面证据： */
  if (prev === prev2 && isHan(prev2)) return true; // 慢慢地 / 渐渐地 / 深深地
  if (DI_ADVERB_PREV.includes(prev)) return true; // 忽然地 / 用力地 / 大声地
  return false;
}

/* ------------------------------------------------------------------ *
 * 「得」
 * ------------------------------------------------------------------ */

/**
 * 「得」在中文里只有三种用法，每一种删掉都必错：
 *  - 补语标记：跑得快、好得很 → 删成「跑快」「好很」；
 *  - 动词 dé：获得、觉得、值得、懂得 → 删成半个词；
 *  - 助动词 děi：我得走了 → 删掉「必须」的意思就没了。
 * 所以智能模式下一个都不删。真想全删请切到「全部删除」模式。
 */
function shouldRemoveDe2(): boolean {
  return false;
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

function emptyStat(): Record<Particle, ParticleStat> {
  return {
    了: { removed: 0, kept: 0 },
    的: { removed: 0, kept: 0 },
    地: { removed: 0, kept: 0 },
    得: { removed: 0, kept: 0 },
  };
}

/**
 * 按 tokens 指定的字清理正文。
 *
 * @param text   原文（markdown 源码）
 * @param tokens 要清理的字，可任选其一或多个
 * @param mode   smart = 保留必要用法；all = 无差别全删（保护区仍然跳过）
 */
export function cleanParticles(
  text: string,
  tokens: readonly Particle[],
  mode: CleanupMode = "smart",
): CleanupResult {
  const perParticle = emptyStat();
  if (!text || tokens.length === 0) {
    return { text, removed: 0, kept: 0, perParticle };
  }

  const targets = new Set<Particle>(tokens);
  const mask = buildProtectedMask(text);
  /* 「的」要看整句才知道哪个该留，先整体规划一次。 */
  const dePlan = targets.has("的") && mode === "smart" ? planDeRemovals(text, mask) : null;

  let out = "";
  let removed = 0;
  let kept = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as Particle;
    if (!targets.has(ch) || mask[i]) {
      out += text[i];
      continue;
    }

    let drop: boolean;
    if (mode === "all") {
      drop = true;
    } else if (ch === "了") {
      drop = shouldRemoveLe(text, i);
    } else if (ch === "的") {
      drop = dePlan!.has(i);
    } else if (ch === "地") {
      drop = shouldRemoveDi(text, i);
    } else {
      drop = shouldRemoveDe2();
    }

    if (drop) {
      removed += 1;
      perParticle[ch].removed += 1;
    } else {
      kept += 1;
      perParticle[ch].kept += 1;
      out += text[i];
    }
  }

  return { text: out, removed, kept, perParticle };
}
