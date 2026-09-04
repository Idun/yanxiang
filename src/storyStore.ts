import { reactive } from "vue";

/**
 * 故事定制（角色原型 / 情节）。
 *
 * 与叙事定制同一套原理：用户自由点选若干项，后端据此约束生成；一项都不选时
 * 不注入任何指令，完全走项目原有流程。两类互相独立且全部可选。
 *
 * 与叙事定制的区别在作用范围——角色原型与情节**只在「对话」标签页生效**，
 * AI写作与审核意见两个标签页既不呈现也不参与，因此这里不需要 scope 参数。
 *
 * 数据取自项目根目录 output.txt。
 */

export type StoryKind = "archetype" | "plot";

export interface StoryOption {
  id: string;
  /** 展示与胶囊所用的名称。 */
  name: string;
  /** 完整释义，注入系统提示词时携带。 */
  desc: string;
  /** 一句话要点，便于模型快速抓取核心。 */
  gist: string;
}

export const CHARACTER_ARCHETYPES: StoryOption[] = [
  {
    id: "archetype_mentor",
    name: "导师原型",
    desc: "一位智慧、经验丰富的顾问，指导主角，并赠予他们装备或知识。",
    gist: "智慧的顾问或向导。",
  },
  {
    id: "archetype_herald",
    name: "信使原型",
    desc: "一个带来变革召唤的角色，向主角宣告挑战的到来。",
    gist: "带来冒险召唤的角色。",
  },
  {
    id: "archetype_threshold_guardian",
    name: "守卫原型",
    desc: "测试主角承诺的看门人，可能会阻挡道路，但最终可以被绕过或击败。",
    gist: "考验主角的守门人。",
  },
  {
    id: "archetype_shapeshifter",
    name: "变形者原型",
    desc: "一个善变、难以捉摸的角色，其忠诚和意图不明，给主角带来悬念和怀疑。",
    gist: "立场不明、善变的角色。",
  },
  {
    id: "archetype_shadow",
    name: "阴影原型",
    desc: "代表主角最深恐惧和压抑欲望的反派或内在力量，是主角必须面对和克服的主要障碍。",
    gist: "反派或主角的阴暗面。",
  },
  {
    id: "archetype_trickster",
    name: "欺诈者原型",
    desc: "一个喜欢制造混乱、打破规则的角色，既可以是盟友也可以是敌人，用幽默和恶作剧推动故事发展。",
    gist: "制造混乱的恶作剧者。",
  },
  {
    id: "archetype_ally",
    name: "伙伴原型",
    desc: "忠诚的同伴，在旅途中为主角提供支持、技能和友谊。",
    gist: "主角的忠实同伴。",
  },
  {
    id: "archetype_reluctant_hero",
    name: "不情愿的英雄",
    desc: "一个起初拒绝冒险召唤的普通人，但最终挺身而出，成为真正的英雄。",
    gist: "被迫成为英雄的普通人。",
  },
];

export const STORY_PLOTS: StoryOption[] = [
  {
    id: "plot_rags_to_riches",
    name: "底层逆袭",
    desc: "主角从贫困和默默无闻中崛起，获得财富、成功或幸福。",
    gist: "从贫穷到富有的逆袭。",
  },
  {
    id: "plot_quest",
    name: "探求",
    desc: "主角和同伴出发，去获得一个重要的对象或到达一个地方，途中面临障碍和诱惑。",
    gist: "为达成目标而踏上旅程。",
  },
  {
    id: "plot_voyage_and_return",
    name: "远行与回归",
    desc: "主角去到一个陌生的地方，克服了威胁，并带着经验和新的见解回家。",
    gist: "进入异世界并最终回归。",
  },
  {
    id: "plot_comedy",
    name: "喜剧",
    desc: "通过一系列混乱和误解，角色最终在一个快乐或胜利的结局中走到一起。",
    gist: "充满误解，但结局圆满。",
  },
  {
    id: "plot_tragedy",
    name: "悲剧",
    desc: "主角因一个重大的性格缺陷或错误而走向毁灭，结局令人惋惜。",
    gist: "主角因自身缺陷导致毁灭。",
  },
  {
    id: "plot_rebirth",
    name: "重生",
    desc: "一个事件迫使主角改变他们的方式，通常使他们成为一个更好的人。",
    gist: "主角经历转变并获得新生。",
  },
  {
    id: "plot_overcoming_the_monster",
    name: "战胜怪物",
    desc: "英雄必须消灭一个威胁他们家园的黑暗势力或怪物。",
    gist: "英雄对抗并战胜邪恶。",
  },
];

export const STORY_GROUPS: { kind: StoryKind; label: string; options: StoryOption[] }[] = [
  { kind: "archetype", label: "角色原型", options: CHARACTER_ARCHETYPES },
  { kind: "plot", label: "情节", options: STORY_PLOTS },
];

export interface StorySelection {
  archetype: string[];
  plot: string[];
}

function emptySelection(): StorySelection {
  return { archetype: [], plot: [] };
}

export const storyStore = reactive({
  /** 只服务「对话」标签页，因此是单一选择集而非按 scope 分桶。 */
  selection: emptySelection() as StorySelection,
});

function optionsOf(kind: StoryKind): StoryOption[] {
  return kind === "archetype" ? CHARACTER_ARCHETYPES : STORY_PLOTS;
}

const KIND_SHORT_LABEL: Record<StoryKind, string> = {
  archetype: "角色",
  plot: "情节",
};

export function isStorySelected(kind: StoryKind, id: string): boolean {
  return storyStore.selection[kind].includes(id);
}

export function toggleStoryOption(kind: StoryKind, id: string): void {
  const list = storyStore.selection[kind];
  const idx = list.indexOf(id);
  if (idx === -1) list.push(id);
  else list.splice(idx, 1);
}

export function clearStorySelection(): void {
  storyStore.selection = emptySelection();
}

export function storySelectedCount(): number {
  return storyStore.selection.archetype.length + storyStore.selection.plot.length;
}

export function storyGroupCount(kind: StoryKind): number {
  return storyStore.selection[kind].length;
}

/** 选中项（按定义顺序返回，保证提示词与界面顺序一致）。 */
export function selectedStoryOptions(kind: StoryKind): StoryOption[] {
  const ids = storyStore.selection[kind];
  return optionsOf(kind).filter((o) => ids.includes(o.id));
}

/* ---------------- 编辑框内嵌胶囊 ---------------- */

/** 输入框（以及用户气泡）里渲染的一枚胶囊。 */
export interface StoryChip {
  kind: StoryKind;
  /** 胶囊前缀：角色 / 情节。 */
  kindLabel: string;
  id: string;
  name: string;
  desc: string;
}

/** 当前选择对应的胶囊列表，按 角色原型 → 情节 的顺序排列。 */
export function storyChips(): StoryChip[] {
  const chips: StoryChip[] = [];
  for (const kind of ["archetype", "plot"] as StoryKind[]) {
    for (const opt of selectedStoryOptions(kind)) {
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

/* ---------------- 系统提示词 ---------------- */

function renderGroup(label: string, options: StoryOption[]): string {
  const lines = options.map((o) => `- ${o.name}：${o.desc}（要点：${o.gist}）`);
  return `${label}（用户已选 ${options.length} 项）:\n${lines.join("\n")}`;
}

/**
 * 用户所选角色原型 / 情节 → 系统提示词片段。两类都未选时返回空串，调用方
 * 据此保持原有流程完全不变。
 */
export function buildStoryDirective(): string {
  const archetypes = selectedStoryOptions("archetype");
  const plots = selectedStoryOptions("plot");
  if (archetypes.length === 0 && plots.length === 0) return "";

  const blocks: string[] = [];
  if (archetypes.length > 0) blocks.push(renderGroup("【角色原型】", archetypes));
  if (plots.length > 0) blocks.push(renderGroup("【情节】", plots));

  const chosenKinds: string[] = [];
  if (archetypes.length > 0) chosenKinds.push("角色原型");
  if (plots.length > 0) chosenKinds.push("情节");

  const rules: string[] = [
    `1. 只在用户已选的维度上受约束：本次用户指定了「${chosenKinds.join(" / ")}」，未指定的维度由你按内容需要自由处理，不要自行补齐或声明。`,
    "2. 角色原型是**功能位**而非人物模板：把它落成具体的人——有自己的名字、来历、说话方式与私心，而不是原型说明的复述。同一原型在不同角色身上应有不同的外在形态。",
    "3. 选中多个角色原型时，让它们各自承担不同的叙事功能并彼此产生张力；不要把多个原型堆到同一个角色身上，也不要让某个原型只露一面就消失。",
    "4. 情节是骨架而非提纲：按所选情节类型推进因果，但不要机械照抄其阶段描述。选中多个情节类型时，以其中一个为主干，其余作为副线或分卷走向交织，不要各写一段拼贴。",
    "5. 不要在正文里点名这些术语（如「导师原型」「底层逆袭」），也不要输出「本章使用××原型」这类说明；用人物行动与情节本身体现它们。",
    "6. 与既有写作规范（风格、爆发性、禁止并列三项、禁止捏造等）冲突时，既有规范优先，故事定制在其允许范围内落实。",
  ];

  return [
    "【故事定制（用户在界面上勾选，必须遵守）】",
    "用户从角色原型 / 情节两类里挑出了以下选项，作为本次创作的人物功能位与情节骨架。",
    blocks.join("\n\n"),
    "执行规则：",
    rules.join("\n"),
  ].join("\n\n");
}

/* ---------------- 持久化 ---------------- */

export function exportStorySelection(): StorySelection {
  return {
    archetype: [...storyStore.selection.archetype],
    plot: [...storyStore.selection.plot],
  };
}

/** 宽容导入：只接受已知 id，脏数据自动丢弃，避免旧版本数据把界面弄坏。 */
export function importStorySelection(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const data = raw as Partial<StorySelection>;
  const next = emptySelection();
  for (const kind of ["archetype", "plot"] as StoryKind[]) {
    const ids = data[kind];
    if (!Array.isArray(ids)) continue;
    const valid = new Set(optionsOf(kind).map((o) => o.id));
    next[kind] = ids.filter((id): id is string => typeof id === "string" && valid.has(id));
  }
  storyStore.selection = next;
}
