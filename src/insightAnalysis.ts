import { documentFilesStore } from "./documentFilesStore";
import { libraryStore } from "./libraryStore";
import { refineStore } from "./refineStore";
import type { HabitItem, PrefStat, StyleMeter, WordFreq } from "./insightStore";

/**
 * Real writing-habit analysis.
 *
 * Everything the 洞察 panel shows is derived here from what the user actually
 * wrote — the document tree, the writing cards, and the before/after pairs the
 * 精修 pipeline produced. Nothing is fabricated: when there is not enough
 * material, a section simply stays empty and the UI shows its empty state.
 */

/* ---------------- corpus ---------------- */

export interface CorpusSample {
  source: "document" | "card";
  title: string;
  text: string;
}

/** Strip Markdown syntax so statistics reflect prose, not formatting. */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(/\r/g, "");
}

export function collectCorpus(): CorpusSample[] {
  const samples: CorpusSample[] = [];
  const seen = new Set<string>();

  const push = (source: CorpusSample["source"], title: string, text: string) => {
    /* 无处不在的查重重叠：同一份正文（例如卡片加入文档后）只统计一次。 */
    const key = text.replace(/\s+/g, "");
    if (text.length >= 40 && !seen.has(key)) {
      seen.add(key);
      samples.push({ source, title, text });
    }
  };

  for (const file of documentFilesStore.files) {
    push("document", file.title, stripMarkdown(file.content).trim());
  }
  for (const card of libraryStore.cards) {
    push("card", card.title, stripMarkdown(card.content).trim());
  }

  return samples;
}

/* ---------------- segmentation ---------------- */

const SENTENCE_SPLIT = /(?<=[。！？!?…；;])|(?<=\.)\s+/;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);
}

/** CJK-aware "character" count: ignores whitespace, keeps CJK + latin words. */
function contentLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/** Unique sentences across a set of texts — first occurrence wins. */
function uniqueSentences(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      const key = sentence.replace(/\s+/g, "");
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(sentence);
      }
    }
  }
  return out;
}

/** Unique paragraphs across a set of texts — first occurrence wins. */
function uniqueParagraphs(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const paragraph of splitParagraphs(text)) {
      const key = paragraph.replace(/\s+/g, "");
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(paragraph);
      }
    }
  }
  return out;
}

/* ---------------- lexical helpers ---------------- */

/**
 * Stop list for frequency analysis: pure function words carry no style signal.
 */
const STOP_WORDS = new Set([
  "的", "了", "和", "是", "在", "我", "有", "就", "不", "人", "都", "一", "上", "也", "很", "到",
  "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "他", "她", "它",
  "们", "个", "为", "与", "于", "而", "从", "被", "把", "让", "但", "却", "又", "还", "才", "更",
  "些", "什么", "这样", "那样", "因为", "所以", "如果", "虽然", "但是", "然后", "这个", "那个",
  "一个", "可以", "这些", "那些", "自己的", "已经", "还是", "之后", "之前", "现在", "时候",
]);

const PUNCT = /[\s，。！？、；：""''（）《》〈〉【】…—·,.!?;:'"()[\]{}<>/\\|`~@#$%^&*+=_\-\d]/;

/**
 * Lightweight Chinese "word" extraction.
 *
 * Without a dictionary we cannot do true segmentation, so we count 2- and
 * 3-character CJK n-grams plus latin words, then keep only n-grams that recur
 * across multiple samples — recurrence is what makes a phrase a habit.
 */
export function extractPhrases(texts: string[], minCount = 3): Map<string, number> {
  const counts = new Map<string, number>();

  for (const text of texts) {
    const cleaned = text.replace(/\s+/g, " ");
    /* Latin words */
    for (const m of cleaned.matchAll(/[a-zA-Z][a-zA-Z'-]{2,}/g)) {
      const w = m[0].toLowerCase();
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    /* CJK n-grams, never spanning punctuation */
    const runs = cleaned.split(PUNCT).filter((r) => /[\u4e00-\u9fa5]/.test(r));
    for (const run of runs) {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const gram = run.slice(i, i + n);
          if (!/^[\u4e00-\u9fa5]+$/.test(gram)) continue;
          if (STOP_WORDS.has(gram)) continue;
          counts.set(gram, (counts.get(gram) ?? 0) + 1);
        }
      }
    }
  }

  for (const [k, v] of [...counts]) {
    if (v < minCount) counts.delete(k);
  }
  return counts;
}

/** Drop n-grams fully contained in a more frequent longer n-gram. */
function dedupeOverlapping(entries: [string, number][]): [string, number][] {
  const sorted = [...entries].sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
  const kept: [string, number][] = [];
  for (const entry of sorted) {
    const covered = kept.some(([word, count]) => word.includes(entry[0]) && count >= entry[1] * 0.7);
    if (!covered) kept.push(entry);
  }
  return kept.sort((a, b) => b[1] - a[1]);
}

/* ---------------- diff of refine pairs ---------------- */

export interface EditPair {
  before: string;
  after: string;
  time: string;
  title: string;
}

/** Sentence-level before/after pairs harvested from the 精修 history. */
export function collectEditPairs(): EditPair[] {
  const pairs: EditPair[] = [];
  const seen = new Set<string>();

  for (const version of refineStore.historyVersions) {
    const before = splitSentences(stripMarkdown(version.original));
    const after = splitSentences(stripMarkdown(version.content));
    const max = Math.min(before.length, after.length);
    for (let i = 0; i < max; i++) {
      if (before[i] !== after[i]) {
        /* 一模一样的修改对只统计一次。 */
        const key = `${before[i].replace(/\s+/g, "")}\u0000${after[i].replace(/\s+/g, "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ before: before[i], after: after[i], time: version.time, title: version.title });
      }
    }
  }

  return pairs;
}

/** Characters/phrases that the user consistently removes when refining. */
export function computeRemovedPhrases(pairs: EditPair[]): Map<string, number> {
  const removed = new Map<string, number>();

  for (const pair of pairs) {
    const afterText = pair.after;
    const grams = extractPhrases([pair.before], 1);
    for (const gram of grams.keys()) {
      if (gram.length < 2) continue;
      if (!afterText.includes(gram)) {
        removed.set(gram, (removed.get(gram) ?? 0) + 1);
      }
    }
  }

  for (const [k, v] of [...removed]) {
    if (v < 2) removed.delete(k);
  }
  return removed;
}

/* ---------------- metric computation ---------------- */

const SIMILE_MARKERS = ["像", "如同", "仿佛", "好似", "似的", "宛如", "犹如", "好像"];
const EMOTION_WORDS = [
  "开心", "高兴", "快乐", "难过", "伤心", "痛苦", "愤怒", "生气", "害怕", "恐惧", "焦虑",
  "孤独", "绝望", "激动", "兴奋", "悲伤", "喜悦", "忧伤", "感动", "失落",
];
const DEGREE_ADVERBS = ["非常", "特别", "十分", "极其", "格外", "相当", "尤其", "无比", "异常"];
const INNER_MARKERS = ["心里", "心中", "想到", "觉得", "认为", "感到", "意识到", "暗自", "内心"];

export interface CorpusMetrics {
  sampleCount: number;
  totalChars: number;
  paragraphCount: number;
  sentenceCount: number;
  avgParagraphChars: number;
  avgSentencesPerParagraph: number;
  avgSentenceChars: number;
  avgClosingSentenceChars: number;
  shortSentenceRatio: number;
  simileRatio: number;
  emotionWordRatio: number;
  degreeAdverbRatio: number;
  innerVoiceRatio: number;
  firstPersonRatio: number;
  dialogueRatio: number;
}

export function computeCorpusMetrics(samples: CorpusSample[]): CorpusMetrics | null {
  /* 先去重：同一份正文无论以文档还是卡片形式出现，或重复粘贴，都只分析一次。 */
  const bodies = samples.map((s) => s.text);
  const paragraphs: string[] = [];
  const paragraphsAll = uniqueParagraphs(bodies);
  const paragraphEnds: string[] = [];

  for (const paragraph of paragraphsAll) {
    const parts = splitSentences(paragraph);
    paragraphs.push(paragraph);
    if (parts.length === 0) continue;
    paragraphEnds.push(parts[parts.length - 1]);
  }

  const sentences = uniqueSentences(paragraphsAll);
  if (sentences.length < 8) return null;

  const totalChars = paragraphs.reduce((sum, p) => sum + contentLength(p), 0);
  const sentenceLengths = sentences.map(contentLength);
  const avgSentenceChars = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
  const shortSentences = sentenceLengths.filter((n) => n > 0 && n <= 12).length;

  const countMatching = (list: string[]) =>
    sentences.filter((s) => list.some((w) => s.includes(w))).length;

  const dialogue = sentences.filter((s) => /["""「」『』]/.test(s)).length;
  const firstPerson = sentences.filter((s) => /(^|[^你他她它])我(?![们们])/.test(s)).length;

  return {
    sampleCount: samples.length,
    totalChars,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    avgParagraphChars: totalChars / paragraphs.length,
    avgSentencesPerParagraph: sentences.length / paragraphs.length,
    avgSentenceChars,
    avgClosingSentenceChars:
      paragraphEnds.reduce((sum, s) => sum + contentLength(s), 0) /
      Math.max(1, paragraphEnds.length),
    shortSentenceRatio: shortSentences / sentenceLengths.length,
    simileRatio: countMatching(SIMILE_MARKERS) / sentences.length,
    emotionWordRatio: countMatching(EMOTION_WORDS) / sentences.length,
    degreeAdverbRatio: countMatching(DEGREE_ADVERBS) / sentences.length,
    innerVoiceRatio: countMatching(INNER_MARKERS) / sentences.length,
    firstPersonRatio: firstPerson / sentences.length,
    dialogueRatio: dialogue / sentences.length,
  };
}

/* ---------------- habit synthesis ---------------- */

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round1(value: number): string {
  return value.toFixed(1);
}

/** Confidence 1-5, scaled by how much evidence the metric rests on. */
function confidenceFor(sampleCount: number): number {
  if (sampleCount >= 200) return 5;
  if (sampleCount >= 100) return 4;
  if (sampleCount >= 50) return 3;
  if (sampleCount >= 20) return 2;
  return 1;
}

/** Pick up to `limit` example sentences that actually exhibit the pattern. */
function findExamples(samples: CorpusSample[], test: (s: string) => boolean, limit = 3): string[] {
  const out: string[] = [];
  for (const sample of samples) {
    for (const sentence of splitSentences(sample.text)) {
      if (out.length >= limit) return out;
      if (sentence.length <= 60 && test(sentence) && !out.includes(sentence)) {
        out.push(sentence);
      }
    }
  }
  return out;
}

export function buildPhrasingHabits(samples: CorpusSample[], m: CorpusMetrics): HabitItem[] {
  const habits: HabitItem[] = [];
  const confidence = confidenceFor(m.sentenceCount);

  if (m.shortSentenceRatio >= 0.35) {
    habits.push({
      id: "auto:short-sentence",
      tag: "句式",
      tagType: "style",
      title: "偏好短句推进",
      desc: `在 ${m.sentenceCount} 个句子中，${pct(m.shortSentenceRatio)} 为 12 字以内的短句，平均句长 ${round1(m.avgSentenceChars)} 字。`,
      examples: findExamples(samples, (s) => contentLength(s) > 0 && contentLength(s) <= 12),
      strength: Math.min(99, Math.round(m.shortSentenceRatio * 130)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  } else if (m.avgSentenceChars >= 30) {
    habits.push({
      id: "auto:long-sentence",
      tag: "句式",
      tagType: "style",
      title: "偏好长句铺陈",
      desc: `平均句长 ${round1(m.avgSentenceChars)} 字，短句（≤12 字）占比仅 ${pct(m.shortSentenceRatio)}，叙述以绵长句式为主。`,
      examples: findExamples(samples, (s) => contentLength(s) >= 35),
      strength: Math.min(99, Math.round(Math.min(1, m.avgSentenceChars / 45) * 100)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  }

  if (m.simileRatio >= 0.06) {
    habits.push({
      id: "auto:simile",
      tag: "用词",
      tagType: "word",
      title: "习惯使用比喻",
      desc: `${pct(m.simileRatio)} 的句子含比喻标记（像 / 如同 / 仿佛 等），倾向以比喻替代直接形容。`,
      examples: findExamples(samples, (s) => SIMILE_MARKERS.some((w) => s.includes(w))),
      strength: Math.min(99, Math.round(m.simileRatio * 600)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  }

  if (m.emotionWordRatio <= 0.04 && m.sentenceCount >= 30) {
    habits.push({
      id: "auto:restrained",
      tag: "语气",
      tagType: "tone",
      title: "情绪表达克制",
      desc: `直白情绪词仅出现在 ${pct(m.emotionWordRatio)} 的句子中，情绪多由动作与环境承载而非直述。`,
      examples: [],
      strength: Math.min(99, Math.round((1 - m.emotionWordRatio * 12) * 100)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  } else if (m.emotionWordRatio >= 0.12) {
    habits.push({
      id: "auto:expressive",
      tag: "语气",
      tagType: "tone",
      title: "情绪表达外放",
      desc: `${pct(m.emotionWordRatio)} 的句子出现直白情绪词，情感倾向直接抒发。`,
      examples: findExamples(samples, (s) => EMOTION_WORDS.some((w) => s.includes(w))),
      strength: Math.min(99, Math.round(m.emotionWordRatio * 400)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  }

  if (m.dialogueRatio >= 0.15) {
    habits.push({
      id: "auto:dialogue",
      tag: "结构",
      tagType: "structure",
      title: "对话驱动叙事",
      desc: `${pct(m.dialogueRatio)} 的句子包含引号对话，情节推进高度依赖人物对白。`,
      examples: findExamples(samples, (s) => /["""「」]/.test(s)),
      strength: Math.min(99, Math.round(m.dialogueRatio * 220)),
      confidence,
      sampleCount: m.sentenceCount,
    });
  }

  return habits;
}

export function buildParagraphHabits(m: CorpusMetrics): HabitItem[] {
  const habits: HabitItem[] = [];
  if (m.paragraphCount < 6) return habits;

  habits.push({
    id: "auto:paragraph-size",
    tag: "结构",
    tagType: "structure",
    title: "段落体量",
    desc: `共 ${m.paragraphCount} 个段落，平均每段 ${Math.round(m.avgParagraphChars)} 字 / ${round1(m.avgSentencesPerParagraph)} 句。`,
    examples: [],
    strength: Math.min(99, Math.round(Math.min(1, m.avgSentencesPerParagraph / 6) * 100)),
    sampleCount: m.paragraphCount,
  });

  habits.push({
    id: "auto:paragraph-closing",
    tag: "结构",
    tagType: "structure",
    title: m.avgClosingSentenceChars < m.avgSentenceChars ? "段末收束偏短" : "段末收束偏长",
    desc: `段末句平均 ${round1(m.avgClosingSentenceChars)} 字，全文平均句长 ${round1(m.avgSentenceChars)} 字，${
      m.avgClosingSentenceChars < m.avgSentenceChars ? "习惯用短句收尾" : "习惯用长句压尾"
    }。`,
    examples: [],
    strength: Math.min(
      99,
      Math.round(
        (Math.abs(m.avgSentenceChars - m.avgClosingSentenceChars) / Math.max(1, m.avgSentenceChars)) * 200,
      ),
    ),
    sampleCount: m.paragraphCount,
  });

  return habits;
}

export function buildEditingHabits(pairs: EditPair[], removed: Map<string, number>): HabitItem[] {
  if (pairs.length === 0) return [];

  const habits: HabitItem[] = [];
  const top = dedupeOverlapping([...removed.entries()]).slice(0, 8);

  if (top.length > 0) {
    habits.push({
      id: "auto:removed-words",
      tag: "删改",
      tagType: "edit",
      title: "反复删除的表达",
      desc: `在 ${pairs.length} 次精修改写中，这些表达被反复删掉：${top.map(([w, c]) => `${w}(${c})`).join("、")}。`,
      examples: pairs
        .filter((p) => top.some(([w]) => p.before.includes(w)))
        .slice(0, 2)
        .map((p) => `原句：${p.before}\n改后：${p.after}`),
      strength: 0,
      sampleCount: pairs.length,
    });
  }

  const shortened = pairs.filter((p) => contentLength(p.after) < contentLength(p.before)).length;
  const lengthened = pairs.length - shortened;
  habits.push({
    id: "auto:edit-direction",
    tag: shortened >= lengthened ? "精简" : "增补",
    tagType: "edit",
    title: shortened >= lengthened ? "倾向精简" : "倾向增补",
    desc:
      shortened >= lengthened
        ? `${pairs.length} 次改写中有 ${shortened} 次缩短了原句，修改方向以删繁就简为主。`
        : `${pairs.length} 次改写中有 ${lengthened} 次扩写了原句，修改方向以补充细节为主。`,
    examples: [],
    strength: 0,
    sampleCount: pairs.length,
  });

  return habits;
}

/* ---------------- profile ---------------- */

function meter(
  label: string,
  value: string,
  fillPercent: number,
  gradient: string,
  leftLabel: string,
  rightLabel: string,
): StyleMeter {
  return {
    label,
    value,
    fillPercent: Math.max(3, Math.min(97, Math.round(fillPercent))),
    fillGradient: gradient,
    leftLabel,
    rightLabel,
  };
}

export function buildStyleMeters(m: CorpusMetrics): StyleMeter[] {
  /* Every position is a real ratio mapped onto the 0-100 axis. */
  const rhythm = Math.min(1, m.avgSentenceChars / 40) * 100;
  const emotion = Math.min(1, m.emotionWordRatio / 0.2) * 100;
  const distance = Math.min(1, (m.innerVoiceRatio + m.firstPersonRatio) / 0.6) * 100;
  const figurative = Math.min(1, m.simileRatio / 0.2) * 100;
  const dialogue = Math.min(1, m.dialogueRatio / 0.4) * 100;

  return [
    meter(
      "句式节奏",
      m.avgSentenceChars < 18 ? "偏短句" : m.avgSentenceChars > 28 ? "偏长句" : "长短均衡",
      rhythm,
      "var(--primary), var(--secondary)",
      "短促有力",
      "绵长舒缓",
    ),
    meter(
      "情感表达",
      m.emotionWordRatio < 0.05 ? "偏克制" : m.emotionWordRatio > 0.12 ? "偏外放" : "中性",
      emotion,
      "var(--secondary), var(--primary)",
      "冷峻克制",
      "浓烈抒情",
    ),
    meter(
      "叙事距离",
      distance < 35 ? "偏远观" : distance > 65 ? "偏贴身" : "中距",
      distance,
      "var(--secondary), var(--error)",
      "冷眼旁观",
      "深入内心",
    ),
    meter(
      "修辞密度",
      m.simileRatio < 0.04 ? "偏白描" : m.simileRatio > 0.12 ? "偏繁复" : "适中",
      figurative,
      "var(--primary), #e67e22",
      "白描直陈",
      "比喻密集",
    ),
    meter(
      "对白比重",
      m.dialogueRatio < 0.1 ? "偏叙述" : m.dialogueRatio > 0.3 ? "偏对白" : "均衡",
      dialogue,
      "var(--primary), var(--secondary)",
      "以叙述为主",
      "以对白为主",
    ),
  ];
}

export function buildHighFreqWords(samples: CorpusSample[]): WordFreq[] {
  const counts = extractPhrases(
    uniqueSentences(samples.map((s) => s.text)),
    Math.max(3, Math.round(uniqueParagraphs(samples.map((s) => s.text)).length * 1.5)),
  );
  const top = dedupeOverlapping([...counts.entries()]).slice(0, 18);
  if (top.length === 0) return [];

  const max = top[0][1];
  return top.map(([word, count]) => ({
    word,
    freq: count >= max * 0.66 ? "high" : count >= max * 0.33 ? "mid" : "low",
  }));
}

export function buildAvoidedWords(removed: Map<string, number>): WordFreq[] {
  return dedupeOverlapping([...removed.entries()])
    .slice(0, 12)
    .map(([word]) => ({ word, freq: "low" as const }));
}

export function buildPrefStats(m: CorpusMetrics): PrefStat[] {
  return [
    { value: String(Math.round(m.avgParagraphChars)), label: "平均段落字数", color: "var(--primary)" },
    { value: round1(m.avgSentencesPerParagraph), label: "平均句数/段", color: "var(--secondary)" },
    { value: round1(m.avgClosingSentenceChars), label: "段末句均字数", color: "var(--primary)" },
    { value: pct(m.simileRatio), label: "比喻使用率", color: "#e67e22" },
  ];
}

export function buildStyleTags(m: CorpusMetrics): string[] {
  const tags: string[] = [];
  if (m.avgSentenceChars < 18) tags.push("短句收束");
  if (m.avgSentenceChars > 28) tags.push("长句铺陈");
  if (m.emotionWordRatio < 0.05) tags.push("冷抒情");
  if (m.emotionWordRatio > 0.12) tags.push("直抒胸臆");
  if (m.simileRatio > 0.1) tags.push("意象密集");
  if (m.simileRatio < 0.04) tags.push("白描手法");
  if (m.dialogueRatio > 0.25) tags.push("对白驱动");
  if (m.innerVoiceRatio > 0.2) tags.push("内视角叙事");
  if (m.firstPersonRatio > 0.3) tags.push("第一人称");
  if (m.avgParagraphChars < 90) tags.push("碎段推进");
  return tags;
}
