/**
 * 文档界面 WYSIWYG 阅读辅助侧栏的数据逻辑：
 * - 当前章节出场人物的启发式提取（人物星图数据）；
 * - 当前位置地图地点匹配（mapStore 里的地点标签与本章正文比对）；
 * - 章节号识别与「卷纲 → 对应章节细纲」解析（含【伏笔】呈现点与收回点）。
 *
 * 全部是纯数据 + 纯函数，组件层只负责渲染与交互。
 */
import { mapStore, type MapPlace } from "./mapStore";
import type { DocFileItem } from "./documentFilesStore";

/* ================= 中文数字 ================= */

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function cnToNumber(s: string): number | null {
  if (!s) return null;
  if (/^\d{1,4}$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : null;
  }
  const of = (ch: string): number =>
    Object.prototype.hasOwnProperty.call(CN_DIGITS, ch) ? CN_DIGITS[ch] : -1;
  if (/^[零一二三四五六七八九]$/.test(s)) return of(s);
  if (s === "十") return 10;
  const m100 = /^([一二三四五六七八九])?百([零一二三四五六七八九])?$/.exec(s);
  if (m100) {
    const h = m100[1] ? of(m100[1]) : 1;
    const r = m100[2] ? of(m100[2]) : 0;
    return h >= 1 && r >= 0 ? h * 100 + r : null;
  }
  const ti = s.indexOf("十");
  if (ti >= 0) {
    const tens = ti === 0 ? 1 : of(s[ti - 1]);
    const ones = ti + 1 < s.length ? of(s[s.length - 1]) : 0;
    return tens >= 1 && ones >= 0 ? tens * 10 + ones : null;
  }
  return null;
}

export interface ChapterInfo {
  num: number;
  label: string;
  title: string;
}

const SPECIAL_CHAPTER_MAP: Record<string, number> = {
  序章: 0,
  前言: 0,
  楔子: 0,
  引子: 0,
  序言: 0,
  序: 0,
  尾声: 9990,
  后记: 9990,
  结语: 9990,
  附录: 9990,
  番外篇: 9995,
  番外: 9995,
  外传: 9995,
};

/** 从标题 / 段落起始行识别章号与标签（包含数字章第X章/Chapter X，以及序章/楔子/前言/尾声/番外等非数字章）。 */
export function detectChapterInfo(text: string): ChapterInfo | null {
  const line = (text || "").trim().split("\n")[0] || "";
  if (!line) return null;

  // 正则匹配：支持 1) 序章/楔子/尾声/番外等; 2) 第X章; 3) Chapter X
  const re = /^\s*(?:#{1,6}\s+)?(?:——\s*)?(?:(序章|前言|楔子|引子|序言|序|尾声|后记|结语|附录|番外篇|番外|外传)|第\s*([0-9一二三四五六七八九十百零]+)\s*章|(?:Chapter|CH|Ch)\.?\s*([0-9]+))[：:\s、·—-]*([^\n]*)/i;
  const m = re.exec(line);
  if (!m) return null;

  if (m[1]) {
    const spec = m[1].trim();
    const num = SPECIAL_CHAPTER_MAP[spec] ?? 0;
    return {
      num,
      label: spec,
      title: (m[4] || "").trim(),
    };
  }

  if (m[2]) {
    const num = cnToNumber(m[2]);
    if (num === null) return null;
    return {
      num,
      label: `第${num}章`,
      title: (m[4] || "").trim(),
    };
  }

  if (m[3]) {
    const num = parseInt(m[3], 10);
    if (!num || isNaN(num)) return null;
    return {
      num,
      label: `第${num}章`,
      title: (m[4] || "").trim(),
    };
  }

  return null;
}

/** 从标题 / 正文中识别章号：优先匹配「第X章」或序章/楔子等，返回 null 表示识别不到。 */
export function detectChapterNumber(text: string): number | null {
  const info = detectChapterInfo(text);
  return info ? info.num : null;
}

/** 格式化章号对应的显示标签（如 "序章", "楔子", "第6章"）。 */
export function formatChapterLabel(num: number | null, fallbackLabel?: string): string {
  if (fallbackLabel) return fallbackLabel;
  if (num === null) return "正文";
  if (num === 0) return "序章";
  if (num === 9990) return "尾声";
  if (num === 9995) return "番外";
  return `第${num}章`;
}

/** 判断一个文档是否为「大纲 / 细纲 / 设定 / 非正文规划文档」（此类文档在左右两侧需屏蔽人物星图与细纲轴）。
 *  注意：严格仅从【文档名称/标题】做判断，不要从文档内容做判断，因为细纲和大纲内容中也会包含“第X章”等章节数。
 */
export function isNonMainDocument(
  fileItem: DocFileItem | undefined,
): boolean {
  if (!fileItem) return false;
  const title = (fileItem.title || "").trim();
  if (!title) return false;

  return /卷纲|章纲|细纲|大纲|纲要|分集|设定|人物卡|设定集|灵感|构思|梗概|草稿|脑图|话本|人物志|世界观|地图集/i.test(
    title,
  );
}

/* ================= 章节切分 ================= */

export interface ChapterSlice {
  num: number;
  label: string;
  title: string;
  /** 在原文中的起始偏移（字符级）。 */
  start: number;
  end: number;
}

/** 把正文按「第X章」或「序章/楔子」标题切成章节块；匹配不到任何章则当作单章整篇返回。 */
export function splitChapters(md: string): ChapterSlice[] {
  const base = md || "";
  const re = /(?:^|\n)\s*(?:#{1,6}\s+)?(?:——\s*)?(?:(序章|前言|楔子|引子|序言|序|尾声|后记|结语|附录|番外篇|番外|外传)|第\s*([0-9一二三四五六七八九十百零]+)\s*章|(?:Chapter|CH|Ch)\.?\s*([0-9]+))[：:\s、·—-]*([^\n]*)/gi;
  const marks: { index: number; num: number; label: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(base))) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const info = detectChapterInfo(m[0]);
    if (!info) continue;
    marks.push({ index: m.index, num: info.num, label: info.label, title: info.title });
  }

  if (marks.length === 0) {
    return base.trim() ? [{ num: 0, label: "全文", title: "", start: 0, end: base.length }] : [];
  }

  const out: ChapterSlice[] = [];
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : base.length;
    out.push({ num: mark.num, label: mark.label, title: mark.title, start: mark.index, end });
  });
  return out;
}

/* ================= 出场人物提取 ================= */

export interface CharacterNode {
  name: string;
  count: number;
  /** 选中过的段落里与其他角色的共现数（星图连线的权重）。 */
  edges: Map<string, number>;
}

function isStopName(name: string): boolean {
  const stop = new Set([
    "他说", "她说", "他说", "有人", "众人", "大家", "对方", "那人", "男人",
    "女人", "少年", "少女", "老人", "大哥", "小子", "某人", "我们", "你们",
    "他们", "她们", "自己", "天下", "世界", "大人", "将军", "陛下", "姑娘",
    "师傅", "师哥", "师兄", "师弟", "师姐", "妹子", "姐姐", "哥哥", "孩子",
  ]);
  return stop.has(name) || name.length < 2 || name.length > 5;
}

const STOP_CJK_SET = new Set(
  "的了着呢吗吧啊呀哦呃嗯哈嘻哈哈呵呵可是但是于是因为所以如果虽然既然即使还是就是但是不过只是然而却并而便都也又再才刚正在已经曾经就要会能可以应该必须"
    .split(""),
);

/** 把一个中文段落里可能的「人名」候选抽出来（启发式）。 */
function candidateNamesFromParagraph(para: string): string[] {
  const names = new Set<string>();
  const stripVerb = (name: string): string =>
    name.replace(/[说道问喊叫笑答喝应]$/, "").trim();

  /* 1) 「xxx说 / 道 / 问 / 喊 / 笑道 …」前面的 2–4 字人名候选。 */
  const attribution = /([\u4e00-\u9fff]{2,4})(?:说|道|问|喊|叫|笑|答|喝道|厉声道|低声道|轻声道|苦笑道|应道|开口道|摇摇头|点点头)[：:，。！？\s"“”「」]/g;
  let m: RegExpExecArray | null;
  while ((m = attribution.exec(para))) {
    const cand = stripVerb(m[1].trim());
    if (cand && /[\u4e00-\u9fff]/.test(cand[cand.length - 1])) names.add(cand);
  }

  /* 2) 【名字】标记，并剥离「·」前缀装饰。 */
  for (const mm of para.matchAll(/【[\s·]?([\u4e00-\u9fffA-Za-z·]{2,12})[\s·]?】/g)) {
    const cand = mm[1].trim().replace(/^[·\s]+|[·\s]+$/g, "");
    if (cand) names.add(cand);
  }

  /* 3) 英文专名（全名或首字母大写且出现≥1次的连续词）。 */
  for (const mm of para.matchAll(/\b[A-Z][A-Za-z]{1,18}\b/g)) {
    const cand = mm[0].trim();
    if (!/^(I|The|Chapter|Mr|Mrs|Sir|Lord)\b/.test(cand)) names.add(cand);
  }

  return Array.from(names).filter((n) => !isStopName(n));
}

/** 按段落做人物候选增量：先收集一轮全体出现数，再筛出「稳定」的人物。 */
export function extractCharacters(md: string): CharacterNode[] {
  const base = (md || "").replace(/```[\s\S]*?```/g, " ").replace(/```/g, " ");
  const paras = base
    .split(/\n{1,}/)
    .map((p) => p.replace(/[#>*`_~\-=]/g, " ").trim())
    .filter((p) => p.length >= 2);

  const rawCount = new Map<string, number>();
  const perPara = new Map<string, Set<string>>();
  for (const para of paras) {
    const cands = candidateNamesFromParagraph(para);
    if (cands.length === 0) continue;
    for (const c of cands) rawCount.set(c, (rawCount.get(c) ?? 0) + 1);
    const arr = perPara.get(para) ?? new Set<string>();
    for (const c of cands) arr.add(c);
    perPara.set(para, arr);
  }

  /* 只用「出现 ≥2 次 或 长度 ≥4」的人物，避免单次误识；
     再剔掉纯停用字组成的 2 字组合。 */
  const freq = Array.from(rawCount.entries())
    .filter(([name, c]) => {
      if (name.length > 5) return false;
      if (c < 2 && name.length < 4) return false;
      if (/^[\u4e00-\u9fff]{2}$/.test(name)) {
        return !STOP_CJK_SET.has(name[0]) && !STOP_CJK_SET.has(name[1]);
      }
      return true;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const nodes: CharacterNode[] = freq.map(([name, count]) => {
    const edges = new Map<string, number>();
    for (const set of perPara.values()) {
      if (!set.has(name)) continue;
      for (const other of set) {
        if (other === name) continue;
        edges.set(other, (edges.get(other) ?? 0) + 1);
      }
    }
    return { name, count, edges };
  });

  return nodes;
}

/* ================= 地图地点匹配 ================= */

export interface MatchedPlace {
  place: MapPlace;
  count: number;
}

/** 从本章正文中找出「点名出现」的地图地点。 */
export function extractMapPlaces(md: string, places: MapPlace[]): MatchedPlace[] {
  const base = md || "";
  const out: MatchedPlace[] = [];
  for (const place of places) {
    const label = (place.label || "").trim();
    if (!label || label.length < 1) continue;
    let count = 0;
    let idx = 0;
    while ((idx = base.indexOf(label, idx)) !== -1) {
      count++;
      idx += label.length;
    }
    if (count > 0) out.push({ place, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/* ================= 卷纲 / 章节细纲解析 ================= */

export interface OutlineSection {
  label: string;
  /** 定位用的锚文本（取节名首句，用于在正文里找对应块）。 */
  anchor: string;
}

export interface OutlineForeshadow {
  text: string;
  /** 关联目标描述（原文，如「后文第十二章……」）。 */
  targetText: string;
  /** 解析出的目标章号（没有标注章号则为 null）。 */
  targetChapter: number | null;
}

export interface OutlineChapter {
  num: number;
  title: string;
  sections: OutlineSection[];
  foreshadows: OutlineForeshadow[];
  /** 该章原始文本。 */
  start: number;
  end: number;
}

/** 小节锚文本去 Markdown 记号与后置标点，便于在正文块里精确匹配。 */
function cleanAnchor(text: string): string {
  return text
    .replace(/[*_~>#`]/g, "")
    .replace(/[：:。，,．！？!?·…、\s]+$/g, "")
    .slice(0, 24);
}

/** 在一个给定区段内收集：小节（编号 / 标题行）与【伏笔】条目。 */
function parseOutlineBlock(text: string): { sections: OutlineSection[]; foreshadows: OutlineForeshadow[] } {
  const sections: OutlineSection[] = [];
  const foreshadows: OutlineForeshadow[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    /* 场面 / 小节：数字加顿号、中文数字、括号数字或【】包裹的小节名。 */
    const numMatch = /^\s*(?:\d{1,2}|[一二三四五六七八九十]+)[、.．\s]\s*(\S.{0,40})/.exec(line);
    if (numMatch && /[\u4e00-\u9fffA-Za-z]/.test(numMatch[1])) {
      sections.push({ label: line.slice(0, 40), anchor: cleanAnchor(numMatch[1]) });
      continue;
    }
    const parenMatch = /^\s*[（(]\s*(?:\d{1,2}|[一二三四五六七八九十]+)\s*[)）]\s*(\S.{0,40})/.exec(line);
    if (parenMatch && /[\u4e00-\u9fffA-Za-z]/.test(parenMatch[1])) {
      sections.push({ label: line.slice(0, 40), anchor: cleanAnchor(parenMatch[1]) });
      continue;
    }
    const bracket = /^(?:——\s*)?【([\u4e00-\u9fffA-Za-z0-9·，、\s]{2,24})】\s*$/.exec(line);
    if (bracket) {
      sections.push({ label: line.slice(0, 40), anchor: cleanAnchor(bracket[1]) });
      continue;
    }

    /* 伏笔行：圈号开头，可能带「—— 关联…」目标。 */
    const fb = /^[①②③④⑤⑥⑦⑧⑨]+\s*(.+?)(?:——|—|——)\s*关联?\s*(.+)$/.exec(line);
    if (fb) {
      foreshadows.push({
        text: fb[1].trim().slice(0, 60),
        targetText: fb[2].trim().slice(0, 60),
        targetChapter: detectChapterNumber(fb[2]),
      });
      continue;
    }
    const fb2 = /^[①②③④⑤⑥⑦⑧⑨]+\s*(.+)$/.exec(line);
    if (fb2) {
      foreshadows.push({
        text: fb2[1].trim().slice(0, 60),
        targetText: "",
        targetChapter: null,
      });
    }
  }
  return { sections, foreshadows };
}

/** 解析一份卷纲 / 章纲文件：按「第X章」切分，逐章抽取小节与伏笔。 */
export function parseVolumeOutline(md: string): OutlineChapter[] {
  const base = md || "";
  const chapters = splitChapters(base);
  if (chapters.length === 0) return [];

  const out: OutlineChapter[] = [];
  for (const ch of chapters) {
    const block = base.slice(ch.start, ch.end);
    const { sections, foreshadows } = parseOutlineBlock(block);
    out.push({
      num: ch.num,
      title: ch.title,
      sections,
      foreshadows,
      start: ch.start,
      end: ch.end,
    });
  }
  return out;
}

/** 判断一份文档内容看起来像「卷纲 / 章节细纲」：至少包含结构化小节或伏笔。 */
export function looksLikeOutline(md: string): boolean {
  const outline = parseVolumeOutline(md);
  if (outline.length >= 2) {
    return outline.some((ch) => ch.foreshadows.length > 0 || ch.sections.length > 0 || !!ch.title);
  }
  if (outline.length === 1) {
    return outline[0].foreshadows.length > 0 || outline[0].sections.length > 0;
  }
  return false;
}

/** 在当前文件同文件夹或全局下找「卷纲」：优先同文件夹标题匹配，其次结构最全的。 */
export function findVolumeOutlineFile(
  files: DocFileItem[],
  currentFileId: string | null,
): DocFileItem | undefined {
  if (!currentFileId) return undefined;
  const current = files.find((f) => f.id === currentFileId);
  if (!current) return undefined;

  const sameFolder = files.filter(
    (f) => f.id !== currentFileId && f.folderId === current.folderId,
  );

  // 1. 同文件夹下优先匹配标题带卷纲/细纲/大纲关键字且解析出章节的
  const sameFolderTitleMatch = sameFolder.find(
    (f) => /卷纲|章纲|细纲|大纲|卷|章表/i.test(f.title || "") && parseVolumeOutline(f.content).length > 0,
  );
  if (sameFolderTitleMatch) return sameFolderTitleMatch;

  // 2. 同文件夹下结构候选
  const sameFolderCandidates = sameFolder.filter((f) => looksLikeOutline(f.content));
  if (sameFolderCandidates.length > 0) {
    sameFolderCandidates.sort((a, b) => parseVolumeOutline(b.content).length - parseVolumeOutline(a.content).length);
    return sameFolderCandidates[0];
  }

  // 3. 跨文件夹回退（用户可能把大纲/卷纲放在根目录或专属目录）
  const otherFiles = files.filter((f) => f.id !== currentFileId && f.folderId !== current.folderId);
  const globalTitleMatch = otherFiles.find(
    (f) => /卷纲|章纲|细纲|大纲|卷|章表/i.test(f.title || "") && parseVolumeOutline(f.content).length > 0,
  );
  if (globalTitleMatch) return globalTitleMatch;

  const globalCandidates = otherFiles.filter((f) => looksLikeOutline(f.content));
  if (globalCandidates.length > 0) {
    globalCandidates.sort((a, b) => parseVolumeOutline(b.content).length - parseVolumeOutline(a.content).length);
    return globalCandidates[0];
  }

  return undefined;
}

/** 卷纲里、某一章作为「收回点」承接的伏笔（来自更前章节、目标指向该章）。 */
export function payoffsForChapter(outline: OutlineChapter[], chapterNum: number): OutlineForeshadow[] {
  const out: OutlineForeshadow[] = [];
  for (const ch of outline) {
    if (ch.num === chapterNum) continue;
    for (const fb of ch.foreshadows) {
      if (fb.targetChapter === chapterNum) out.push(fb);
    }
  }
  return out;
}

/** 全局地图地点视图里「本章出场」需要 mapStore 快照，这里导出便捷函数供组件使用。 */
export function placesInStore(): MapPlace[] {
  return mapStore.places;
}