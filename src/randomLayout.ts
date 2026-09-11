/**
 * 随机排版：把「一句一行」的工整换行打散成人类随性写的段落。
 *
 * AI 吐出来的正文往往一行一句，版面上像列清单。真人写稿不会这么齐——
 * 有时候两三句挤一段，有时候一句话孤零零占一行，没有规律。
 * 这个模块只做一件事：在**纯正文**里，把相邻的短行随机合并成一段。
 *
 * 保守是刻意的。一条换行要不要吃掉，先要过三道闸：
 *
 *  1. **不碰结构**。标题、列表、引用、表格、代码块、分隔线、图片、HTML 标签
 *     各自成行，永远不参与合并——它们是 markdown 的骨架，合并即毁文档。
 *  2. **长的段落不动**。一行正文超过 {@link SHORT_LINE_MAX} 就认定作者本来
 *     就把它当独立段落写，原样留着。
 *  3. **空行是硬边界**。只有「单换行」才可能被吃掉，`\n\n` 隔开的段落之间
 *     永远不连——作者用空行分出来的段落是有意的，不能被随机排版抹平。
 *
 * 合并粒度也随机：连续短行按 2 ~ {@link MAX_MERGED_LINES} 行一组吃掉换行，
 * 切分点由随机数决定，所以同一段文字多跑几次（多按几次）结果都不一样，
 * 这正是要的「随性」。想撤回按 Ctrl+Z，编辑器历史栈里是一条。
 *
 * 段落之间不加空行：原文是 `一行\n一行` 就合成 `一行一行`，
 * 段间距、缩进这些排版设置交给别的地方管。
 *
 * 单独成模块（而非塞在 DocumentViewer.vue 里）以便独立测试与复用。
 */

/** 超过这个字数的行认定为「作者本来就按段落写」，原样保留。 */
export const SHORT_LINE_MAX = 40;

/** 一次最多吃掉几行换行，避免把整段话糊成一大坨。 */
export const MAX_MERGED_LINES = 4;

/*
 * 两个旋钮的可调区间。面板上的滑块直接绑这四个常量，
 * 引擎入口也按同一组数值夹紧——UI 与规则只有这一份取值范围，不会各说各话。
 */

/** 短句上限的下界：再低就几乎没有行够得上「短」，点了等于没点。 */
export const SHORT_LINE_MIN_LIMIT = 10;
/** 短句上限的上界：再高连整段的长句都会被当短句并进去。 */
export const SHORT_LINE_MAX_LIMIT = 100;
/** 合并行数至少 2 行，否则不构成「合并」。 */
export const MERGE_MIN_LIMIT = 2;
/** 合并行数上界：一段并进 8 行以上就糊成一坨了。 */
export const MERGE_MAX_LIMIT = 8;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 常见的 markdown 结构行：这些行永远独立，不参与合并。 */
const STRUCTURAL_LINE_RE = new RegExp(
  [
    "^\\s*#{1,6}[ \\t]", // 标题
    "^\\s*>", // 引用
    "^\\s*([-*+]|[0-9]{1,9}[.)])[ \\t]", // 无序 / 有序列表
    "^\\s*```", // 围栏代码块
    "^\\s*~~~",
    "^\\s*\\|", // 表格
    "^\\s*([-*_][ \\t]*){3,}$", // 分隔线
    "^\\s*!?\\[", // 图片 / 链接引用
    "^\\s*<[a-zA-Z/!]", // HTML 标签
    "^\\s*\\[[^\\]]+\\]:", // 链接定义
    "^\\s{4,}\\S", // 缩进代码块
  ].join("|"),
);

/**
 * 引号开头的对白行。
 *
 * 这条不是排版洁癖，是正确性：连续两行对白多半出自两个人之口，
 * 并成一段就成了「一个人连说两句」，意思都变了。中文小说里对白
 * 本来也是各自成段的，所以对白行一律独立，既不吃上一行也不被下一行吃。
 */
const DIALOGUE_LINE_RE = /^\s*["'“”‘’「『《〈]/;

/** 行首的行内标记：统计长度时先剥掉，别让 `**` 把短句算成长句。 */
const INLINE_MARK_RE = /^[\s>#*+_~`|-]+|[\s*_~`]+$/g;

type LineKind = "blank" | "structural" | "prose";

interface Line {
  text: string;
  kind: LineKind;
  /** 正文计数长度（剥掉行内标记后的字符数）。 */
  weight: number;
}

function classify(line: string, inFence: boolean): { kind: LineKind; inFence: boolean } {
  if (line.trim() === "") return { kind: "blank", inFence };
  if (/^\s*(```|~~~)/.test(line)) return { kind: "structural", inFence: !inFence };
  if (inFence) return { kind: "structural", inFence };
  if (STRUCTURAL_LINE_RE.test(line)) return { kind: "structural", inFence };
  if (DIALOGUE_LINE_RE.test(line)) return { kind: "structural", inFence };
  return { kind: "prose", inFence };
}

function weightOf(text: string): number {
  return text.replace(INLINE_MARK_RE, "").length;
}

/** 可注入的随机源：生产用 Math.random，测试传种子以复现。 */
export type RandomSource = () => number;

/** 极简 LCG，只为让测试能复现同一串随机数，不用于任何安全场景。 */
export function createSeededRandom(seed: number): RandomSource {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface RandomLayoutOptions {
  /** 随机源，默认 Math.random。 */
  random?: RandomSource;
  /**
   * 短行阈值，默认 {@link SHORT_LINE_MAX}。
   * 入口会夹到 [{@link SHORT_LINE_MIN_LIMIT}, {@link SHORT_LINE_MAX_LIMIT}]。
   */
  shortLineMax?: number;
  /**
   * 单次合并的上限行数，默认 {@link MAX_MERGED_LINES}。
   * 入口会夹到 [{@link MERGE_MIN_LIMIT}, {@link MERGE_MAX_LIMIT}]。
   */
  maxMergedLines?: number;
}

export interface RandomLayoutResult {
  text: string;
  /** 吃掉的换行个数。 */
  merged: number;
  /** 合并出来的段落数。 */
  paragraphs: number;
}

/**
 * 把正文里「一句一换行」的短行随机并成段落。
 *
 * 不做任何其他改动：不删空行、不补空行、不碰缩进与标点，
 * 未参与合并的行逐字原样保留。
 */
export function randomizeLayout(
  text: string,
  options: RandomLayoutOptions = {},
): RandomLayoutResult {
  const random = options.random ?? Math.random;
  const shortLineMax = clamp(
    options.shortLineMax ?? SHORT_LINE_MAX,
    SHORT_LINE_MIN_LIMIT,
    SHORT_LINE_MAX_LIMIT,
  );
  const maxMerged = clamp(
    options.maxMergedLines ?? MAX_MERGED_LINES,
    MERGE_MIN_LIMIT,
    MERGE_MAX_LIMIT,
  );

  if (!text) return { text, merged: 0, paragraphs: 0 };

  const rawLines = text.split("\n");
  const lines: Line[] = [];
  let inFence = false;
  for (const raw of rawLines) {
    const result = classify(raw, inFence);
    inFence = result.inFence;
    lines.push({ text: raw, kind: result.kind, weight: weightOf(raw) });
  }

  const outLines: string[] = [];
  let merged = 0;
  let paragraphs = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* 只有「短正文行」才可能开启一次合并。 */
    if (line.kind !== "prose" || line.weight === 0 || line.weight > shortLineMax) {
      outLines.push(line.text);
      i += 1;
      continue;
    }

    /* 往后看：夹在短正文行之间的换行才是候选，遇到空行 / 结构行 / 长行就停。 */
    let end = i;
    while (
      end + 1 < lines.length &&
      lines[end + 1].kind === "prose" &&
      lines[end + 1].weight > 0 &&
      lines[end + 1].weight <= shortLineMax
    ) {
      end += 1;
    }

    const runLength = end - i + 1;
    if (runLength < 2) {
      /* 孤零零一行短句：人类也会这么写，留着。 */
      outLines.push(line.text);
      i += 1;
      continue;
    }

    /* 随机分组把这串短行切开：每组内部吃掉换行，组间保留换行。 */
    let cursor = i;
    while (cursor <= end) {
      const remaining = end - cursor + 1;
      const take = pickGroupSize(remaining, maxMerged, random);
      const group = lines.slice(cursor, cursor + take);
      if (take === 1) {
        outLines.push(group[0].text);
      } else {
        outLines.push(group.map((l) => l.text.trim()).join(""));
        merged += take - 1;
        paragraphs += 1;
      }
      cursor += take;
    }
    i = end + 1;
  }

  return { text: outLines.join("\n"), merged, paragraphs };
}

/**
 * 这一组吃几行。取 2 ~ maxMerged 之间的随机数，偶尔留单行——
 * 真人写稿不会全程整齐成组，掺一点「这句话就单独一行」才像手写的。
 */
function pickGroupSize(remaining: number, maxMerged: number, random: RandomSource): number {
  if (remaining <= 1) return 1;
  const upper = Math.min(remaining, maxMerged);
  /* 剩余行数装不满两组时，整串并成一段，免得尾巴上剩一行孤句太整齐。 */
  const roll = random();
  if (remaining <= upper) return remaining;
  /* 10% 概率留一个单行段，制造参差。 */
  if (roll < 0.1 && remaining - 1 >= 2) return 1;
  const size = 2 + Math.floor(random() * (upper - 1));
  return Math.min(size, upper);
}
