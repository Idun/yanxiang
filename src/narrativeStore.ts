import { reactive } from "vue";

/**
 * 叙事定制（叙事结构 / 叙事手法 / 结局结尾）。
 *
 * 目的：让用户在发送前自由点选若干「结构 / 手法 / 结尾」，后端 AI 据此让
 * 每个章节走不同的结构、用不同的手法、收不同的结尾，避免通篇章节同构导致
 * 的浓重 AI 味。三类**互相独立且全部可选**：一个都不选时不注入任何指令，
 * 完全走项目原有流程。
 *
 * 数据取自项目根目录《写作素材.md》。
 */

export type NarrativeKind = "structure" | "technique" | "ending";
/** 叙事定制目前只服务「对话」与「AI写作」两个标签页；审核意见不接入。 */
export type NarrativeScope = "chat" | "writer";

export interface NarrativeOption {
  id: string;
  /** 展示与嵌入编辑框所用的名称。 */
  name: string;
  /** 完整释义，注入系统提示词时携带。 */
  desc: string;
  /** 一句话要点，便于模型快速抓取核心。 */
  gist: string;
}

export const NARRATIVE_STRUCTURES: NarrativeOption[] = [
  {
    id: "structure_single_line",
    name: "单线型结构",
    desc: "情节单纯，线索明晰，围绕一两个主要人物依次展开，环环相扣（如鲁迅《孔乙己》）。",
    gist: "单一情节线，依次展开。",
  },
  {
    id: "structure_double_line",
    name: "复线型结构",
    desc: "运用明暗或主副双线并行展开，能容纳更复杂的内容，丰满人物形象（如鲁迅《药》）。",
    gist: "主副双线并行展开。",
  },
  {
    id: "structure_radial",
    name: "辐射型结构",
    desc: "情节围绕一个集中的「焦点」呈放射状展开，打破时空界限，线索是心理流程，意识流小说常用。",
    gist: "围绕一个焦点放射状展开。",
  },
  {
    id: "structure_web",
    name: "蛛网型结构",
    desc: "由三条以上线索互相交叉而成，盘根错节宛如蛛网（如《创业史》《水浒传》）。",
    gist: "多条线索交叉成网。",
  },
  {
    id: "structure_tableau",
    name: "画面型结构",
    desc: "以景物、场面为主体的画面式情节单元的组合，侧重于抒情写意和环境氛围。",
    gist: "由独立的画面单元组合而成。",
  },
  {
    id: "structure_plotless",
    name: "淡化情节型结构",
    desc: "故事性不强，侧重于作者情绪的抒写和意识流动，而非生动的情节；散文化，形散而神不散。",
    gist: "情节弱化，注重情绪和意识流。",
  },
  {
    id: "structure_twist",
    name: "突转式结构",
    desc: "在结尾处情节突然向相反方向转变，揭示出人意料但又在情理之中的真相，即「欧亨利式结尾」。",
    gist: "结尾出人意料的大反转。",
  },
  {
    id: "structure_delay",
    name: "「延迟」式结构",
    desc: "竭力给故事、人物、读者心理设置障碍，又不使希望完全破灭，一环扣一环，实现结构张力。",
    gist: "不断设置障碍，延迟解密。",
  },
  {
    id: "structure_symbolic",
    name: "象征结构",
    desc: "全部情节紧紧围绕某个抽象理念（意识、观点、思想）展开，理念是情节的内核和连接线索。",
    gist: "情节围绕抽象理念展开。",
  },
  {
    id: "structure_block",
    name: "板块型结构",
    desc: "将表面互不相关的事件、人物、场景分别罗列，形成独立「板块」，整体意蕴超出各部分之和。",
    gist: "由互不相关的独立板块构成。",
  },
];

export const NARRATIVE_TECHNIQUES: NarrativeOption[] = [
  {
    id: "technique_embedded",
    name: "嵌入式叙事",
    desc: "在主要情节中嵌入其他较小的故事（故事中的故事）。嵌入的故事常具象征意义，反映人物心理，为主线提供背景，甚至影响读者对主情节的理解；叙述者不可靠时还能引发对真实性的质疑。",
    gist: "故事中嵌入小故事，用以象征、铺垫或制造悬念。",
  },
  {
    id: "technique_frame",
    name: "框架叙事（夹层叙事）",
    desc: "以一个主要故事作为整体框架，将多个相对独立的次要故事嵌入其中，在统一背景下展开，框架本身也可传递主题或成为隐喻（如《一千零一夜》）。",
    gist: "一个主故事作为框架，包裹多个独立的子故事。",
  },
  {
    id: "technique_parallel",
    name: "平行叙事（多线叙事）",
    desc: "同时叙述两条或多条独立的故事线，可平行发展也可交织影响，最终汇聚到共同结局；常采用多人物视角增加复杂性（如《冰与火之歌》）。",
    gist: "多条故事线平行发展，最终可能交汇。",
  },
  {
    id: "technique_circular",
    name: "环形叙事（循环叙事）",
    desc: "故事的结尾与开头相呼应，形成闭合的圆环；常通过情节或主题的循环表现生命轮回与命运感，激发哲学思考（如《老人与海》）。",
    gist: "结尾与开头呼应，形成闭环，表达轮回主题。",
  },
  {
    id: "technique_nonlinear",
    name: "非线性叙事",
    desc: "不遵循严格时间顺序，通过倒叙、插叙打乱事件叙述；碎片化叙事增强悬疑与转折，促使读者主动拼凑全貌（如《低俗小说》）。",
    gist: "不按时间顺序讲述，增强悬疑和参与感。",
  },
  {
    id: "technique_nested",
    name: "多层嵌套式叙事",
    desc: "嵌入式叙事具有多层结构时即为嵌套式叙事：故事中包含多个层次的叙述，每一层都可能带有不可靠性，增加解读难度（如《盗梦空间》的多层梦境）。",
    gist: "多层「故事中的故事」，层层递进。",
  },
  {
    id: "technique_irony",
    name: "反讽结局",
    desc: "巧妙运用反讽、夸张与幽默：反讽让情节与预期相反以增强戏剧效果，夸张突出性格或情境的荒诞，幽默缓解紧张氛围，最终以具讽刺意味的转折收尾。",
    gist: "运用反讽、夸张和幽默的意外转折。",
  },
];

export const NARRATIVE_ENDINGS: NarrativeOption[] = [
  {
    id: "ending_eucatastrophe",
    name: "善哉",
    desc: "托尔金提出的概念，常见于童话：突然的幸福转折，使人喜极而泣。转折通常发生在看似绝望或无法逆转的局面中，带来意想不到的胜利或救赎、慰藉与希望。",
    gist: "绝望中突然出现的幸福转折。",
  },
  {
    id: "ending_grace",
    name: "奇迹恩典",
    desc: "童话的善哉元素在于超越现实的奇迹与恩典。无论情节多么荒诞或恐怖，奇迹的出现都能带来希望与救赎，体现深层次的神性暗示，而非机械降神。",
    gist: "超越现实的奇迹与救赎。",
  },
  {
    id: "ending_deus_ex_machina",
    name: "机械降神",
    desc: "故事中突然出现的、缺乏合理铺垫的超自然救援。虽能解决危机，但可能破坏内部逻辑与真实性，显得廉价突兀——如需使用应自觉其代价。",
    gist: "缺乏铺垫的超自然救援。",
  },
  {
    id: "ending_circular",
    name: "环形结局",
    desc: "采用圆形结构，结尾回到开头形成闭环，强调无限轮回或循环不已的主题；即使角色回到原点，其精神轨迹也已发生本质变化。",
    gist: "结尾回到开头形成闭环。",
  },
  {
    id: "ending_infinite_loop",
    name: "无限轮回",
    desc: "以环形与无限的叙事结构探索哲学思想，如迷宫象征无限可能性与时间循环；挑战传统线性叙事，让最后一页与第一页相同以实现无限循环。",
    gist: "探索无限可能性与时间循环。",
  },
  {
    id: "ending_open",
    name: "开放式结局",
    desc: "结局不明确、存在多重可能性，允许读者自行解读；模糊的结局激发好奇心与思考欲望，增加故事深度。",
    gist: "结局不明确，允许多重解读。",
  },
  {
    id: "ending_cliffhanger",
    name: "悬念结局",
    desc: "结局悬而未决，给予读者更大自由空间，但也可能引发争论甚至不满；在没有后续解释时可能显得空洞或困惑。",
    gist: "结局悬而未决，引发争议。",
  },
  {
    id: "ending_false",
    name: "假结局",
    desc: "在故事接近尾声时误导读者以为已经结束，实际危机尚未解决；能制造紧张感与反转效果，常用于恐怖和惊悚题材。",
    gist: "误导读者以为故事结束的转折。",
  },
];

export const NARRATIVE_GROUPS: { kind: NarrativeKind; label: string; options: NarrativeOption[] }[] = [
  { kind: "structure", label: "叙事结构", options: NARRATIVE_STRUCTURES },
  { kind: "technique", label: "叙事手法", options: NARRATIVE_TECHNIQUES },
  { kind: "ending", label: "结局/结尾", options: NARRATIVE_ENDINGS },
];

export interface NarrativeSelection {
  structure: string[];
  technique: string[];
  ending: string[];
}

function emptySelection(): NarrativeSelection {
  return { structure: [], technique: [], ending: [] };
}

export const narrativeStore = reactive({
  selections: {
    chat: emptySelection(),
    writer: emptySelection(),
  } as Record<NarrativeScope, NarrativeSelection>,
});

function optionsOf(kind: NarrativeKind): NarrativeOption[] {
  if (kind === "structure") return NARRATIVE_STRUCTURES;
  if (kind === "technique") return NARRATIVE_TECHNIQUES;
  return NARRATIVE_ENDINGS;
}

export function isNarrativeSelected(scope: NarrativeScope, kind: NarrativeKind, id: string): boolean {
  return narrativeStore.selections[scope][kind].includes(id);
}

export function toggleNarrativeOption(scope: NarrativeScope, kind: NarrativeKind, id: string): void {
  const list = narrativeStore.selections[scope][kind];
  const idx = list.indexOf(id);
  if (idx === -1) list.push(id);
  else list.splice(idx, 1);
}

export function clearNarrativeSelection(scope: NarrativeScope): void {
  narrativeStore.selections[scope] = emptySelection();
}

export function narrativeSelectedCount(scope: NarrativeScope): number {
  const sel = narrativeStore.selections[scope];
  return sel.structure.length + sel.technique.length + sel.ending.length;
}

/** 选中项（按定义顺序返回，保证提示词与界面顺序一致）。 */
export function selectedNarrativeOptions(scope: NarrativeScope, kind: NarrativeKind): NarrativeOption[] {
  const ids = narrativeStore.selections[scope][kind];
  return optionsOf(kind).filter((o) => ids.includes(o.id));
}

/* ---------------- 编辑框内嵌胶囊 ---------------- */

/**
 * 早期版本把标记当成纯文本写进 textarea 首行，用户可以直接编辑甚至误删。
 * 现在标记以**不可编辑的胶囊**渲染在输入框内，这个匹配式只保留一个用途：
 * 把可能被粘贴进正文的旧版明文标记剥掉，避免它混进用户消息。
 */
const TAG_PATTERN = /【叙事定制[^】]*】[ \t]*\n?/g;

const KIND_SHORT_LABEL: Record<NarrativeKind, string> = {
  structure: "结构",
  technique: "手法",
  ending: "结尾",
};

/** 输入框（以及用户气泡）里渲染的一枚胶囊。 */
export interface NarrativeChip {
  kind: NarrativeKind;
  /** 胶囊前缀：结构 / 手法 / 结尾。 */
  kindLabel: string;
  id: string;
  name: string;
  desc: string;
}

/** 当前选择对应的胶囊列表，按 结构 → 手法 → 结尾 的顺序排列。 */
export function narrativeChips(scope: NarrativeScope): NarrativeChip[] {
  const chips: NarrativeChip[] = [];
  for (const kind of ["structure", "technique", "ending"] as NarrativeKind[]) {
    for (const opt of selectedNarrativeOptions(scope, kind)) {
      chips.push({
        kind,
        kindLabel: KIND_SHORT_LABEL[kind],
        id: opt.id,
        name: opt.name,
        desc: opt.desc,
      });
    }
  }
  return chips;
}

export function stripNarrativeTag(text: string): string {
  return text.replace(TAG_PATTERN, "").replace(/^\s+/, "");
}

/* ---------------- 系统提示词 ---------------- */

function renderGroup(label: string, options: NarrativeOption[]): string {
  const lines = options.map((o) => `- ${o.name}：${o.desc}（要点：${o.gist}）`);
  return `${label}（用户已选 ${options.length} 项）:\n${lines.join("\n")}`;
}

/**
 * 用户所选叙事定制 → 系统提示词片段。未选任何项时返回空串，调用方据此
 * 保持原有流程完全不变。
 */
export function buildNarrativeDirective(scope: NarrativeScope): string {
  const structures = selectedNarrativeOptions(scope, "structure");
  const techniques = selectedNarrativeOptions(scope, "technique");
  const endings = selectedNarrativeOptions(scope, "ending");
  if (structures.length === 0 && techniques.length === 0 && endings.length === 0) return "";

  const blocks: string[] = [];
  if (structures.length > 0) blocks.push(renderGroup("【叙事结构】", structures));
  if (techniques.length > 0) blocks.push(renderGroup("【叙事手法】", techniques));
  if (endings.length > 0) blocks.push(renderGroup("【结局/结尾】", endings));

  const chosenKinds: string[] = [];
  if (structures.length > 0) chosenKinds.push("结构");
  if (techniques.length > 0) chosenKinds.push("手法");
  if (endings.length > 0) chosenKinds.push("结尾");

  const rules: string[] = [
    `1. 只在用户已选的维度上受约束：本次用户指定了「${chosenKinds.join(" / ")}」，未指定的维度由你按内容需要自由处理，不要自行补齐或声明。`,
    "2. 同一维度被选中多项时，视为可轮换的清单：逐章轮换取用，相邻章节不得重复同一项，用完一轮再从头循环；严禁全篇每章都套同一个结构/手法/结尾。",
    "3. 同一维度只选中一项时，以它为本次写作的基调；若产出多个章节，则在这一项内部变换切入点、节奏与呈现方式，避免章节间形成可预测的同构模板。",
    "4. 结构、手法、结尾服务于故事本身：不要在正文里点名这些术语，也不要输出「本章采用××结构」这类说明；用文本本身体现它们。",
    "5. 与既有写作规范（风格、爆发性、禁止并列三项、禁止捏造等）冲突时，既有规范优先，叙事定制在其允许范围内落实。",
  ];

  return [
    "【叙事定制（用户在界面上勾选，必须遵守）】",
    "用户从叙事结构 / 叙事手法 / 结局结尾三类里挑出了以下选项，用于打散「每章同一套结构、同一种手法、同一类结尾」的机械感。",
    blocks.join("\n\n"),
    "执行规则：",
    rules.join("\n"),
  ].join("\n\n");
}

/* ---------------- 持久化 ---------------- */

export function exportNarrativeSelections(): Record<NarrativeScope, NarrativeSelection> {
  return {
    chat: { ...narrativeStore.selections.chat },
    writer: { ...narrativeStore.selections.writer },
  };
}

/** 宽容导入：只接受已知 id，脏数据自动丢弃，避免旧版本数据把界面弄坏。 */
export function importNarrativeSelections(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const data = raw as Partial<Record<NarrativeScope, Partial<NarrativeSelection>>>;
  for (const scope of ["chat", "writer"] as NarrativeScope[]) {
    const incoming = data[scope];
    if (!incoming) continue;
    const next = emptySelection();
    for (const kind of ["structure", "technique", "ending"] as NarrativeKind[]) {
      const ids = incoming[kind];
      if (!Array.isArray(ids)) continue;
      const valid = new Set(optionsOf(kind).map((o) => o.id));
      next[kind] = ids.filter((id): id is string => typeof id === "string" && valid.has(id));
    }
    narrativeStore.selections[scope] = next;
  }
}
