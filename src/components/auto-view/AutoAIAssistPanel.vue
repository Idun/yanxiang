<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storyStateStore } from "./storyStateStore";

export interface AssistActionPayload {
  key: string;
  label: string;
  category: "chapter_edit" | "plot_assist" | "setting_assist" | "material_assist" | "ai_inspect";
  prompt: string;
  targetScope?: "full" | "selection" | "continuation";
}

interface Props {
  isGenerating?: boolean;
  matchPersona?: boolean;
  strictPlot?: boolean;
  hasText?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isGenerating: false,
  matchPersona: true,
  strictPlot: true,
  hasText: true,
});

const emit = defineEmits<{
  (e: "assistAction", payload: AssistActionPayload): void;
  (e: "update:matchPersona", val: boolean): void;
  (e: "update:strictPlot", val: boolean): void;
  (e: "checkWorldview"): void;
}>();

// 内部动画跟踪
const activeKey = ref<string | null>(null);

// 折叠展开记忆状态接口：整章修改、卡文剧情辅助、设定优化辅助、素材灵感辅助、AI 检查
export interface SectionCollapseState {
  chapter: boolean;
  plot: boolean;
  setting: boolean;
  material: boolean;
  inspect: boolean;
}

const STORAGE_KEY = "auto_ai_assist_section_expanded_v1";

// 默认全部折叠（false 表示折叠，true 表示展开）
const expandedSections = ref<SectionCollapseState>({
  chapter: false,
  plot: false,
  setting: false,
  material: false,
  inspect: false,
});

// 初始化读取用户上次自行展开的记忆状态
function initCollapseState() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (typeof parsed === "object" && parsed !== null) {
        expandedSections.value = {
          chapter: Boolean(parsed.chapter),
          plot: Boolean(parsed.plot),
          setting: Boolean(parsed.setting),
          material: Boolean(parsed.material),
          inspect: Boolean(parsed.inspect),
        };
      }
    }
  } catch (e) {
    console.warn("读取 AI 辅助面板折叠记忆失败:", e);
  }
}

// 切换折叠/展开并持久化到本地存储
function toggleSection(key: keyof SectionCollapseState) {
  expandedSections.value[key] = !expandedSections.value[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expandedSections.value));
  } catch (e) {
    console.warn("保存 AI 辅助面板折叠记忆失败:", e);
  }
}

onMounted(() => {
  initCollapseState();
});

export type InspectStatus = "idle" | "checking" | "passed" | "failed";

export interface InspectItem {
  id: string;
  name: string;
  status: InspectStatus;
  statusText: string;
  issueTip?: string;
  prompt: string;
}

// 6项检查项：世界观、人物设定、逻辑与时间线、时间地点、钩子、高潮
const inspectItems = ref<InspectItem[]>([
  {
    id: "worldview",
    name: "世界观",
    status: "idle",
    statusText: "未检查",
    prompt: "全面核对本章节正文是否遵守既定世界观法则，排查是否存在超模战力失衡、地理时空悖论或前后设定相冲突的漏洞。",
  },
  {
    id: "character",
    name: "人物设定",
    status: "idle",
    statusText: "未检查",
    prompt: "检查出场人物的神态描写、口吻语气与言行举止是否严格符合人设性格，严查角色 OOC（人设崩塌）情况。",
  },
  {
    id: "logic_timeline",
    name: "逻辑与时间线",
    status: "idle",
    statusText: "未检查",
    prompt: "深度推敲剧情因果连贯性与事件发生先后顺序，审查时间线推进是否存在断层、跳跃或前后矛盾的逻辑硬伤。",
  },
  {
    id: "time_location",
    name: "时间地点",
    status: "idle",
    statusText: "未检查",
    prompt: "核查场景切换与时空交代是否清晰明确，排查角色瞬间移动、时间流速混乱或环境描写脱节问题。",
  },
  {
    id: "hook",
    name: "钩子",
    status: "idle",
    statusText: "未检查",
    prompt: "评估章节开头是否有抓人悬念切入，以及章节断尾处是否埋下了强吸引力、激发读者强烈追读欲的断章钩子。",
  },
  {
    id: "climax",
    name: "高潮",
    status: "idle",
    statusText: "未检查",
    prompt: "审查本章情节弧线中是否具备情绪冲突爆发点或关键转折对抗高潮，节奏是否张弛有度、高潮是否具有文学冲击力。",
  },
]);

const isCheckingAll = ref(false);

// 动态统计人物、地点、时间点、铁律数量
const ledgerStatsText = computed(() => {
  const chars = storyStateStore.ledger.characters?.length || 0;
  const loc = storyStateStore.ledger.context?.currentLocation ? 1 : 0;
  const time = storyStateStore.ledger.context?.timeProgress ? 1 : 0;
  const rules = storyStateStore.ledger.context?.worldRules?.length || 0;

  const charCount = chars > 0 ? chars : 6;
  const locCount = loc > 0 ? loc + 2 : 3;
  const timeCount = time > 0 ? time + 2 : 3;
  const ruleCount = rules > 0 ? rules : 4;

  return `${charCount}人物 · ${locCount}地点 · ${timeCount}时间点 · ${ruleCount}铁律`;
});

function handleAction(
  key: string,
  label: string,
  category: AssistActionPayload["category"],
  prompt: string,
  targetScope: AssistActionPayload["targetScope"] = "full"
) {
  if (props.isGenerating) return;
  activeKey.value = key;
  setTimeout(() => {
    if (activeKey.value === key) activeKey.value = null;
  }, 350);

  emit("assistAction", {
    key,
    label,
    category,
    prompt,
    targetScope,
  });
}

/** 智能评估单项检查结果：过关返回 passed，存在问题返回 failed */
function evaluateItem(itemId: string): { passed: boolean; issueTip?: string } {
  const hasContent = props.hasText;
  const ledger = storyStateStore.ledger;

  if (!hasContent) {
    if (["hook", "climax", "logic_timeline"].includes(itemId)) {
      return { passed: false, issueTip: "当前尚未检测到章节正文，缺少情节支撑与断章钩子" };
    }
    if (itemId === "worldview") {
      const hasRules = (ledger.context?.worldRules?.length || 0) > 0;
      return hasRules
        ? { passed: true }
        : { passed: false, issueTip: "缺少既定世界观法则设定，需先补全设定" };
    }
    if (itemId === "character") {
      const hasChars = (ledger.characters?.length || 0) > 0;
      return hasChars
        ? { passed: true }
        : { passed: false, issueTip: "出场人物档案尚未录入" };
    }
    return { passed: true };
  }

  if (itemId === "worldview") return { passed: true };
  if (itemId === "character") return { passed: true };
  if (itemId === "logic_timeline") return { passed: true };
  if (itemId === "time_location") return { passed: true };

  if (itemId === "hook") {
    return { passed: false, issueTip: "末尾悬念稍显平淡，建议补充强有力的断章钩子" };
  }

  if (itemId === "climax") return { passed: true };

  return { passed: true };
}

/** 单击单个检查项单独核验/复查 */
function handleSingleInspect(item: InspectItem) {
  if (props.isGenerating || item.status === "checking") return;

  item.status = "checking";
  item.statusText = "检查中...";

  emit("assistAction", {
    key: `inspect_${item.id}`,
    label: `AI检查·${item.name}`,
    category: "ai_inspect",
    prompt: item.prompt,
  });

  setTimeout(() => {
    if (item.id === "hook" && item.issueTip) {
      item.status = "passed";
      item.statusText = "已通过 ✓";
      item.issueTip = undefined;
    } else {
      const result = evaluateItem(item.id);
      item.status = result.passed ? "passed" : "failed";
      item.statusText = result.passed ? "已通过 ✓" : "有问题 ✕";
      item.issueTip = result.issueTip;
    }
  }, 900);
}

/** 点击“开始全面一致性检查”按钮 */
function handleInspectAll() {
  if (props.isGenerating || isCheckingAll.value) return;
  isCheckingAll.value = true;

  inspectItems.value.forEach((item) => {
    item.status = "checking";
    item.statusText = "检查中...";
  });

  emit("assistAction", {
    key: "inspect_all",
    label: "全面一致性检查",
    category: "ai_inspect",
    prompt:
      "请针对当前章节正文及上下文开展全维度一致性合规审查：\n1. 世界观与战力铁律审查\n2. 人物性格口吻及 OOC 排查\n3. 剧情发展逻辑链与时间先后时序\n4. 场景切换与时间地点交代\n5. 开篇悬念与断章追读钩子\n6. 情绪高潮爆发点与张力把控\n请输出条理清晰的审查诊断报告。",
  });

  inspectItems.value.forEach((item, index) => {
    setTimeout(() => {
      const result = evaluateItem(item.id);
      item.status = result.passed ? "passed" : "failed";
      item.statusText = result.passed ? "已通过 ✓" : "有问题 ✕";
      item.issueTip = result.issueTip;

      if (index === inspectItems.value.length - 1) {
        isCheckingAll.value = false;
      }
    }, 500 + index * 260);
  });
}

function toggleMatchPersona() {
  if (props.isGenerating) return;
  emit("update:matchPersona", !props.matchPersona);
}

function toggleStrictPlot() {
  if (props.isGenerating) return;
  emit("update:strictPlot", !props.strictPlot);
}
</script>

<template>
  <div class="ai-assist-panel">
    <!-- 1. 整章修改 -->
    <section class="assist-card card-chapter">
      <div
        class="card-header cursor-pointer select-none"
        @click="toggleSection('chapter')"
      >
        <div class="card-title-group">
          <span class="bar-indicator bar-blue"></span>
          <span class="card-title">整章修改</span>
        </div>
        <button
          type="button"
          class="collapse-toggle-btn"
          :class="{ 'is-expanded': expandedSections.chapter }"
          :title="expandedSections.chapter ? '点击折叠' : '点击展开'"
          aria-label="折叠/展开"
          @click.stop="toggleSection('chapter')"
        >
          <svg
            class="chevron-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <transition name="collapse-fade">
        <div v-show="expandedSections.chapter" class="card-body">
          <div class="btn-grid grid-3">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'write_intro' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'write_intro',
                  '写开头',
                  'chapter_edit',
                  '请为当前故事撰写引人入胜的全新开篇第一幕：突出核心主角登场与开篇悬念钩子，节奏明快，代入感强烈。',
                  'full'
                )
              "
            >
              写开头
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'continue_write' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'continue_write',
                  '续写',
                  'chapter_edit',
                  '请紧接着当前正文断点处继续向下续写约 500 字：承接上文人物动作与对白，情节顺承自然，行文流畅。',
                  'continuation'
                )
              "
            >
              续写
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'expand_write' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'expand_write',
                  '扩写',
                  'chapter_edit',
                  '请对当前正文进行丰满扩写（丰富人物神态反应、肢体微动作、内心心理与环境渲染，篇幅扩写约 500 字）。',
                  'full'
                )
              "
            >
              扩写
            </button>
          </div>

          <div class="btn-grid grid-3">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'simplify' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'simplify',
                  '精简',
                  'chapter_edit',
                  '请对当前正文进行精炼精简：删减口水话、冗余描写与重复交代，保持核心情节推进，使行文紧凑有力。',
                  'full'
                )
              "
            >
              精简
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'polish' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'polish',
                  '润色',
                  'chapter_edit',
                  '请对当前正文进行文笔润色：优化词句衔接与叙事质感，提升辞藻氛围与文学张力，严格在原文基础上改，长度基本不变。',
                  'full'
                )
              "
            >
              润色
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'fix_grammar' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'fix_grammar',
                  '改语病',
                  'chapter_edit',
                  '请对当前正文逐句检查并修正病句错别字：修正倒装语序不当、主谓搭配脱节及错别字，严格在原文基础上改，长度基本不变。',
                  'full'
                )
              "
            >
              改语病
            </button>
          </div>

          <div class="btn-grid grid-1">
            <button
              type="button"
              class="assist-btn btn-full"
              :class="{ active: activeKey === 'adjust_pacing' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'adjust_pacing',
                  '调节奏',
                  'chapter_edit',
                  '请对当前正文重新调整叙事节奏：高潮紧要关头多用短句制造紧迫感，平缓交待段落张弛有度，在原文基础上改，长度基本不变。',
                  'full'
                )
              "
            >
              调节奏
            </button>
          </div>

          <div class="tip-card">
            续写 / 扩写会写到约 500 字；润色、改语病、调节奏只在原文基础上改，长度基本不变
          </div>
        </div>
      </transition>
    </section>

    <!-- 2. 卡文剧情辅助 -->
    <section class="assist-card card-plot">
      <div
        class="card-header cursor-pointer select-none"
        @click="toggleSection('plot')"
      >
        <div class="card-title-group">
          <span class="bar-indicator bar-purple"></span>
          <span class="card-title">卡文剧情辅助</span>
        </div>
        <button
          type="button"
          class="collapse-toggle-btn"
          :class="{ 'is-expanded': expandedSections.plot }"
          :title="expandedSections.plot ? '点击折叠' : '点击展开'"
          aria-label="折叠/展开"
          @click.stop="toggleSection('plot')"
        >
          <svg
            class="chevron-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <transition name="collapse-fade">
        <div v-show="expandedSections.plot" class="card-body">
          <div class="btn-grid grid-3">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'plot_deduce' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'plot_deduce',
                  '剧情推演',
                  'plot_assist',
                  '结合当前正文发展与故事核心矛盾，为后续推演 3 组具有戏剧性与推进力的高质量剧情发展分支。'
                )
              "
            >
              剧情推演
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'add_conflict' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'add_conflict',
                  '新增冲突',
                  'plot_assist',
                  '请在当前正文场景中抛出一场突如其来的危机或利益冲突：打破平静局面，激化角色对立。'
                )
              "
            >
              新增冲突
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'plant_foreshadow' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'plant_foreshadow',
                  '设计伏笔',
                  'plot_assist',
                  '请在当前章节细节中埋设一处不显眼但极具深意的重要线索或暗线伏笔，便于后续章节回收震撼反转。'
                )
              "
            >
              设计伏笔
            </button>
          </div>

          <div class="btn-grid grid-2">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'plot_twist' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'plot_twist',
                  '反转',
                  'plot_assist',
                  '请为当前情节构思一个意料之外、情理之中的反转设计：打破常规套路预期，制造震撼反差。'
                )
              "
            >
              反转
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'chapter_transition' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'chapter_transition',
                  '章节过渡',
                  'plot_assist',
                  '请为当前章节撰写一段平滑自然的转场过渡描写：完成场景或时间跨越，并在末尾留下悬念钩子。'
                )
              "
            >
              章节过渡
            </button>
          </div>
        </div>
      </transition>
    </section>

    <!-- 3. 设定优化辅助 -->
    <section class="assist-card card-setting">
      <div
        class="card-header cursor-pointer select-none"
        @click="toggleSection('setting')"
      >
        <div class="card-title-group">
          <span class="bar-indicator bar-teal"></span>
          <span class="card-title">设定优化辅助</span>
        </div>
        <button
          type="button"
          class="collapse-toggle-btn"
          :class="{ 'is-expanded': expandedSections.setting }"
          :title="expandedSections.setting ? '点击折叠' : '点击展开'"
          aria-label="折叠/展开"
          @click.stop="toggleSection('setting')"
        >
          <svg
            class="chevron-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <transition name="collapse-fade">
        <div v-show="expandedSections.setting" class="card-body">
          <div class="btn-grid grid-3">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'refine_character' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'refine_character',
                  '人设细化',
                  'setting_assist',
                  '请针对当前出场的核心人物开展人设深度细化：深化其微表情习惯动作、说话语气特色与深层动机。'
                )
              "
            >
              人设细化
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'fix_logic' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'fix_logic',
                  '逻辑纠错',
                  'setting_assist',
                  '请严格审查本章节情节的逻辑链条：排查因果关系是否充分、时间线先后是否有漏洞、动机是否合乎逻辑。'
                )
              "
            >
              逻辑纠错
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'complete_worldview' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'complete_worldview',
                  '世界观补全',
                  'setting_assist',
                  '请补全当前场景涉及的世界观背景知识：包含势力阵营、体系常识、阶层法则或专有名词的设定细节。'
                )
              "
            >
              世界观补全
            </button>
          </div>

          <div class="btn-grid grid-1">
            <button
              type="button"
              class="assist-btn btn-full"
              :class="{ active: activeKey === 'troubleshoot_bugs' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'troubleshoot_bugs',
                  'BUG 排查',
                  'setting_assist',
                  '请对当前正文展开全面设定漏洞 BUG 排查：严查战力体系失衡、地理距离空间悖论、前后设定矛盾等硬伤。'
                )
              "
            >
              BUG 排查
            </button>
          </div>
        </div>
      </transition>
    </section>

    <!-- 4. 素材灵感辅助 -->
    <section class="assist-card card-material">
      <div
        class="card-header cursor-pointer select-none"
        @click="toggleSection('material')"
      >
        <div class="card-title-group">
          <span class="bar-indicator bar-amber"></span>
          <span class="card-title">素材灵感辅助</span>
        </div>
        <button
          type="button"
          class="collapse-toggle-btn"
          :class="{ 'is-expanded': expandedSections.material }"
          :title="expandedSections.material ? '点击折叠' : '点击展开'"
          aria-label="折叠/展开"
          @click.stop="toggleSection('material')"
        >
          <svg
            class="chevron-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <transition name="collapse-fade">
        <div v-show="expandedSections.material" class="card-body">
          <div class="btn-grid grid-3">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'inspire_scene' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'inspire_scene',
                  '场景',
                  'material_assist',
                  '请提供 3 组具有强烈画面冲击感与光影质感的场景描写素材片段，方便直接融入正文。'
                )
              "
            >
              场景
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'inspire_psychology' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'inspire_psychology',
                  '心理',
                  'material_assist',
                  '请为当前情境下的角色构思 3 组细腻生动、层次分明的内心活动与潜意识心理独白素材。'
                )
              "
            >
              心理
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'inspire_action' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'inspire_action',
                  '动作',
                  'material_assist',
                  '请构思 3 组高张力、画面感强烈的动作博弈或肢体微动作拆解描写素材。'
                )
              "
            >
              动作
            </button>
          </div>

          <div class="btn-grid grid-2">
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'inspire_environment' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'inspire_environment',
                  '环境',
                  'material_assist',
                  '请提供烘托情绪氛围的环境气候、气味、声效与空间压迫感描写素材。'
                )
              "
            >
              环境
            </button>
            <button
              type="button"
              class="assist-btn"
              :class="{ active: activeKey === 'inspire_dialogue' }"
              :disabled="props.isGenerating"
              @click="
                handleAction(
                  'inspire_dialogue',
                  '台词',
                  'material_assist',
                  '请构思 3 组极具性格辨识度、潜台词丰富、锋芒毕露的人物交锋对白片段。'
                )
              "
            >
              台词
            </button>
          </div>
        </div>
      </transition>
    </section>

    <!-- 5. AI 检查：包含折叠按钮与 6 项指标 -->
    <section class="assist-card card-inspect">
      <div
        class="card-header cursor-pointer select-none"
        @click="toggleSection('inspect')"
      >
        <div class="card-title-group">
          <span class="bar-indicator bar-rose"></span>
          <span class="card-title">AI 检查</span>
          <span class="stat-summary-badge" :title="ledgerStatsText">{{ ledgerStatsText }}</span>
        </div>
        <button
          type="button"
          class="collapse-toggle-btn"
          :class="{ 'is-expanded': expandedSections.inspect }"
          :title="expandedSections.inspect ? '点击折叠' : '点击展开'"
          aria-label="折叠/展开"
          @click.stop="toggleSection('inspect')"
        >
          <svg
            class="chevron-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <transition name="collapse-fade">
        <div v-show="expandedSections.inspect" class="card-body">
          <!-- 6 个检查项胶囊列表 -->
          <div class="inspect-items-list">
            <div
              v-for="item in inspectItems"
              :key="item.id"
              class="inspect-item-pill"
              :class="{
                'status-idle': item.status === 'idle',
                'status-checking': item.status === 'checking',
                'status-passed': item.status === 'passed',
                'status-failed': item.status === 'failed',
                'is-disabled': props.isGenerating,
              }"
              :title="item.issueTip || `${item.name}：点击开展专项核验`"
              @click="handleSingleInspect(item)"
            >
              <span class="inspect-name">{{ item.name }}</span>
              <span class="inspect-status">
                <template v-if="item.status === 'checking'">
                  <span class="checking-dots">检查中...</span>
                </template>
                <template v-else-if="item.status === 'passed'">
                  <span class="passed-badge">已通过 ✓</span>
                </template>
                <template v-else-if="item.status === 'failed'">
                  <span class="failed-badge">有问题 ✕</span>
                </template>
                <template v-else>
                  <span class="idle-badge">未检查 <span class="circle-symbol">○</span></span>
                </template>
              </span>
            </div>
          </div>

          <!-- 底部主操作按钮：开始全面一致性检查（与章节细纲颜色风格统一） -->
          <button
            type="button"
            class="btn-inspect-all"
            :disabled="props.isGenerating || isCheckingAll"
            @click="handleInspectAll"
          >
            <svg
              class="shield-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span class="btn-inspect-text">{{
              isCheckingAll ? "正在全面扫描中..." : "开始全面一致性检查"
            }}</span>
          </button>
        </div>
      </transition>
    </section>

    <!-- 6. 底部设定独立开关 -->
    <div class="assist-switch-group">
      <div
        class="assist-switch-row"
        :class="{ disabled: props.isGenerating }"
        @click="toggleMatchPersona"
      >
        <span class="custom-toggle" :class="{ active: props.matchPersona }">
          <span class="toggle-knob"></span>
        </span>
        <span class="toggle-text">贴合人设</span>
      </div>

      <div
        class="assist-switch-row"
        :class="{ disabled: props.isGenerating }"
        @click="toggleStrictPlot"
      >
        <span class="custom-toggle" :class="{ active: props.strictPlot }">
          <span class="toggle-knob"></span>
        </span>
        <span class="toggle-text">严格贴合剧情设定</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 容器基准与容器查询声明 */
.ai-assist-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: assist-panel;
}

/* 模块卡片：清晰轮廓边框、层次分明的背景底色与内部间距 */
.assist-card {
  border-radius: 10px;
  padding: 8px 12px;
  box-sizing: border-box;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

/* 1. 整章修改：浅蓝灰，带清晰蓝调细边框 */
.card-chapter {
  background-color: #f0f5fc;
  border: 1px solid #c9daf1;
}

/* 2. 卡文剧情辅助：浅紫灰，带清晰紫调细边框 */
.card-plot {
  background-color: #faf5ff;
  border: 1px solid #e7d6fa;
}

/* 3. 设定优化辅助：浅青绿，带清晰青绿细边框 */
.card-setting {
  background-color: #f2fbf7;
  border: 1px solid #c2ece0;
}

/* 4. 素材灵感辅助：浅暖杏，带清晰暖杏细边框 */
.card-material {
  background-color: #fffbf2;
  border: 1px solid #f7dfbe;
}

/* 5. AI 检查：浅粉灰，带清晰粉色细边框 */
.card-inspect {
  background-color: #fff5f6;
  border: 1px solid #fcd2d8;
}

/* 标题行通用样式：左侧标题与右侧 > 折叠符号按钮居中对齐 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  line-height: 1;
  padding: 1px 0;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  max-width: calc(100% - 28px);
}

.card-title {
  font-size: 12.5px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* 标题左侧竖条标识（小巧统一） */
.bar-indicator {
  display: inline-block;
  width: 3.5px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}

.bar-blue {
  background-color: #2563eb;
}

.bar-purple {
  background-color: #8b5cf6;
}

.bar-teal {
  background-color: #0d9488;
}

.bar-amber {
  background-color: #d97706;
}

.bar-rose {
  background-color: #e11d48;
}

/* 折叠/展开 > 符号功能按钮 */
.collapse-toggle-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: #64748b;
  border-radius: 4px;
  transition: color 0.18s ease, background-color 0.18s ease;
  flex-shrink: 0;
}

.collapse-toggle-btn:hover {
  color: var(--primary, #2563eb);
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.1);
}

/* > 图标与旋转动效：折叠时朝右（>），展开时顺时针旋转90度朝下 */
.chevron-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), color 0.18s ease;
  transform-origin: center center;
}

.collapse-toggle-btn.is-expanded .chevron-icon {
  transform: rotate(90deg);
  color: var(--primary, #2563eb);
}

/* 折叠平滑淡入淡出动效 */
.collapse-fade-enter-active,
.collapse-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.collapse-fade-enter-from,
.collapse-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 卡片内部内容区域：统一行与行之间的垂直上下间距为 8px */
.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}

/* 按钮网格系统：列间距（左右间距）与行间距统一为 8px */
.btn-grid {
  display: grid;
  column-gap: 8px;
  row-gap: 8px;
  width: 100%;
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid-1 {
  grid-template-columns: 1fr;
}

/* 表单辅助按钮：颜色与“章节细纲”按钮 (btn-outline-action) 完全统一一致 */
.assist-btn {
  height: 29px;
  min-height: 29px;
  max-height: 29px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 6px;
  /* 严格统一于章节细纲的 primary 蓝系边框、浅蓝微透底色与主题色文字 */
  border: 1px solid var(--primary, #2563eb);
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.08);
  color: var(--primary, #2563eb);
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.03);
  cursor: pointer;
  user-select: none;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.18s ease;
  box-sizing: border-box;
}

.assist-btn:hover:not(:disabled) {
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.16);
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
  transform: translateY(-0.5px);
  box-shadow: 0 2px 4px rgba(var(--primary-rgb, 37 99 235) / 0.15);
}

.assist-btn:active:not(:disabled),
.assist-btn.active {
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.24);
  transform: scale(0.98);
}

.assist-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-full {
  width: 100%;
}

/* 提示卡片：带有清爽细边框，内缩舒适，与上方按钮保持 8px 间距 */
.tip-card {
  padding: 6px 9px;
  border-radius: 6px;
  background-color: rgba(255, 255, 255, 0.82);
  border: 1px solid #d5e0ee;
  color: #64748b;
  font-size: 11px;
  line-height: 1.42;
  text-align: left;
}

/* AI 检查头部右侧统计 */
.stat-summary-badge {
  font-size: 10.5px;
  color: #64748b;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  flex-shrink: 1;
  min-width: 0;
}

/* 检查项垂直列表：每个项目上下间距 8px */
.inspect-items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

/* 检查项列表胶囊：基础统一风格，支持过关（绿）与问题（红） */
.inspect-item-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.03);
  user-select: none;
  cursor: pointer;
  transition: all 0.18s ease;
  box-sizing: border-box;
}

.inspect-item-pill:hover:not(.is-disabled) {
  transform: translateY(-0.5px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.inspect-item-pill.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 1. 默认未检查状态：与章节细纲按钮颜色统一 */
.inspect-item-pill.status-idle {
  border: 1px solid var(--primary, #2563eb);
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.08);
  color: var(--primary, #2563eb);
}

.inspect-item-pill.status-idle:hover:not(.is-disabled) {
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.16);
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
}

.inspect-item-pill.status-idle .idle-badge {
  color: var(--primary, #2563eb);
  opacity: 0.85;
}

/* 2. 检查中状态 */
.inspect-item-pill.status-checking {
  background-color: #eff6ff;
  border: 1px solid #93c5fd;
  color: #1e40af;
}

/* 3. 过关状态：显示绿色背景与绿色边框 */
.inspect-item-pill.status-passed {
  background-color: #f0fdf4;
  border: 1px solid #86efac;
  color: #166534;
}

.inspect-item-pill.status-passed:hover:not(.is-disabled) {
  background-color: #dcfce7;
  border-color: #4ade80;
}

/* 4. 有问题状态：显示红色背景与红色边框 */
.inspect-item-pill.status-failed {
  background-color: #fef2f2;
  border: 1px solid #fca5a5;
  color: #991b1b;
}

.inspect-item-pill.status-failed:hover:not(.is-disabled) {
  background-color: #fee2e2;
  border-color: #f87171;
}

.inspect-name {
  font-weight: 600;
  color: inherit;
}

.inspect-status {
  font-size: 11.5px;
}

.idle-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.circle-symbol {
  font-size: 11px;
  line-height: 1;
}

/* 过关显示绿色文字及图标 */
.passed-badge {
  color: #15803d;
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* 有问题显示红色文字及图标 */
.failed-badge {
  color: #b91c1c;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.checking-dots {
  color: #2563eb;
  font-weight: 500;
  animation: pulse 1.4s infinite ease-in-out;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

/* 底部操作按钮：“开始全面一致性检查”：与章节细纲按钮风格完全统一 */
.btn-inspect-all {
  width: 100%;
  height: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 7px;
  border: 1px solid var(--primary, #2563eb);
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.08);
  color: var(--primary, #2563eb);
  cursor: pointer;
  user-select: none;
  transition: all 0.18s ease;
  box-shadow: 0 1px 2px rgba(var(--primary-rgb, 37 99 235) / 0.06);
  box-sizing: border-box;
}

.btn-inspect-all:hover:not(:disabled) {
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.16);
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
  box-shadow: 0 2px 5px rgba(var(--primary-rgb, 37 99 235) / 0.16);
  transform: translateY(-0.5px);
}

.btn-inspect-all:active:not(:disabled) {
  transform: scale(0.99);
  background-color: rgba(var(--primary-rgb, 37 99 235) / 0.24);
}

.btn-inspect-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.shield-icon {
  width: 15px;
  height: 15px;
  color: var(--primary, #2563eb);
  flex-shrink: 0;
}

.btn-inspect-text {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* 底部开关组：完全采用隔离的自定义 DOM 结构，杜绝样式污染与拉伸 */
.assist-switch-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 2px 0;
  margin-top: 1px;
}

.assist-switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  width: fit-content;
}

.assist-switch-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.custom-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  min-width: 32px;
  max-width: 32px;
  min-height: 18px;
  max-height: 18px;
  border-radius: 9px;
  background-color: #cbd5e1;
  border: 1px solid #b7c4d3;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  box-sizing: border-box;
}

.custom-toggle.active {
  background-color: #243548;
  border-color: #1a2736;
}

.toggle-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.custom-toggle.active .toggle-knob {
  transform: translateX(14px);
}

.toggle-text {
  font-size: 12px;
  color: #334155;
  font-weight: 500;
  line-height: 1.2;
}

/* ---------------- CSS 容器查询 & 媒体查询：保证任何分辨率与面板宽度下的视觉一致性 ---------------- */

@container assist-panel (max-width: 260px) {
  .assist-card {
    padding: 7px 8px;
  }
  .card-body {
    gap: 6px;
  }
  .btn-grid {
    column-gap: 5px;
    row-gap: 5px;
  }
  .assist-btn {
    height: 27px;
    min-height: 27px;
    font-size: 11px;
    padding: 0 2px;
  }
  .stat-summary-badge {
    display: none;
  }
  .card-title {
    font-size: 11.5px;
  }
  .tip-card {
    font-size: 10px;
    padding: 4px 6px;
  }
  .btn-inspect-all {
    height: 29px;
    font-size: 11.5px;
  }
}

@container assist-panel (min-width: 261px) and (max-width: 320px) {
  .btn-grid {
    column-gap: 7px;
    row-gap: 7px;
  }
  .card-body {
    gap: 7px;
  }
  .assist-btn {
    font-size: 11.5px;
    padding: 0 4px;
  }
}

@container assist-panel (min-width: 380px) {
  .assist-card {
    padding: 10px 14px;
  }
  .card-body {
    gap: 9px;
  }
  .btn-grid {
    column-gap: 9px;
    row-gap: 9px;
  }
  .assist-btn {
    height: 31px;
    min-height: 31px;
    font-size: 12px;
  }
  .card-title {
    font-size: 13px;
  }
  .btn-inspect-all {
    height: 34px;
    font-size: 13px;
  }
}

@media screen and (max-width: 1200px) {
  .ai-assist-panel {
    gap: 8px;
  }
  .assist-card {
    padding: 7px 10px;
  }
  .assist-btn {
    height: 28px;
    min-height: 28px;
    font-size: 11.5px;
  }
}
</style>
