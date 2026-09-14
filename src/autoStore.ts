import { reactive, watch } from "vue";
import { loadSettings, saveSettings } from "./persistence";

export interface ToolTrace {
  label: string;
  done: boolean;
  detail?: string;
}

export interface AiTurn {
  id: number;
  title: string;
  content: string;
  reasoning: string;
  tokens: number;
  timestamp: string;
  incomplete: boolean;
  continued: number;
  tools?: ToolTrace[];
  prompt?: string;
  /** 文稿分类文件夹 id（未分类 / 不属于任何文件夹时为缺省）。 */
  folderId?: string;
  /** 该条产出归属的写作模式（chat / writer / auditor / reader）。 */
  mode?: string;
  /** 产出摘要文案（部分入口写入，用于标题兜底判断）。 */
  summary?: string;
  /** 分页组 id：同面板位置的多版本产出共用一组。 */
  pageGroupId?: string;
  /** 变体产出指向的父产出 id。 */
  parentId?: number;
  /** 变体动作标识（refresh / structure / technique / ending / rewrite 等）。 */
  variant?: string;
}

export interface DraftFolder {
  id: string;
  name: string;
}

/** 一轮「新建创作」的归档快照：保证每轮创作互相独立，且整体持久保存。 */
export interface AutoSessionArchive {
  id: string;
  /** 用作「过往创作」列表标题，如「创作 · 09-13 14:05」。 */
  title: string;
  createdAt: number;
  turns: AiTurn[];
  topicContent: string;
  setup: AutoSetupState;
  articleLength: ArticleLength;
  targetWordCount: number;
  outputTargetType: OutputTargetType;
  selectedStoryIds: string[];
  selectedNarrativeIds: string[];
}

export interface SessionSourceItem {
  id: string;
  title: string;
  content: string;
  selected: boolean;
}

export interface AutoSetupState {
  genre: string;
  channel: string;
  person: string;
  tense: string;
  tone: string;
  pace: string;
  conflict: string;
  focus: string;
}

export type WritingMode = "chat" | "writer" | "auditor" | "reader";
export type OutputTargetType = "story" | "outline";
export type ArticleLength = "short" | "medium" | "long";

export const autoStore = reactive({
  aiTurns: [] as AiTurn[],
  topicContent: "",
  writingMode: "writer" as WritingMode,
  targetWordCount: 2000,
  outputTargetType: "story" as OutputTargetType,
  articleLength: "short" as ArticleLength,
  setup: {
    genre: "",
    channel: "",
    person: "",
    tense: "",
    tone: "",
    pace: "",
    conflict: "",
    focus: "",
  } as AutoSetupState,
  selectedStoryIds: [] as string[],
  selectedNarrativeIds: [] as string[],
  sessionSources: [] as SessionSourceItem[],
  draftFolders: [] as DraftFolder[],
  autoSessions: [] as AutoSessionArchive[],
  /** 思考链（推理过程）展开/折叠偏好，跨会话持久化。默认展开。 */
  thinkingExpanded: true,
  /** 左侧面板当前激活的标签页（素材来源 / 文稿），跨会话持久化。 */
  leftPanelTab: "source" as "source" | "drafts",
  /** 文稿分类文件夹的折叠状态（id 集合），跨会话持久化。 */
  collapsedFolderIds: [] as string[],
});

const KEY_TURNS = "autoAiTurns";
const KEY_TOPIC = "autoTopicContent";
const KEY_MODE = "autoWritingMode";
const KEY_WORD_COUNT = "autoTargetWordCount";
const KEY_TARGET_TYPE = "autoOutputTargetType";
const KEY_ARTICLE_LENGTH = "autoArticleLength";
const KEY_SETUP = "autoSetup";
const KEY_STORY_IDS = "autoSelectedStoryIds";
const KEY_NARRATIVE_IDS = "autoSelectedNarrativeIds";
const KEY_SESSION_SOURCES = "autoSessionSources";
const KEY_DRAFT_FOLDERS = "autoDraftFolders";
const KEY_AUTO_SESSIONS = "autoSessions";
const KEY_THINKING_EXPANDED = "autoThinkingExpanded";
const KEY_LEFT_PANEL_TAB = "autoLeftPanelTab";
const KEY_COLLAPSED_FOLDERS = "autoCollapsedFolders";

let booted = false;

export async function bootAutoStore(): Promise<void> {
  if (booted) return;
  booted = true;

  try {
    const settings = await loadSettings();

    if (settings[KEY_TURNS]) {
      const parsed = JSON.parse(settings[KEY_TURNS]);
      if (Array.isArray(parsed)) autoStore.aiTurns = parsed;
    }
    if (typeof settings[KEY_TOPIC] === "string") {
      autoStore.topicContent = settings[KEY_TOPIC];
    }
    if (settings[KEY_MODE] && ["chat", "writer", "auditor", "reader"].includes(settings[KEY_MODE])) {
      autoStore.writingMode = settings[KEY_MODE] as WritingMode;
    }
    if (settings[KEY_WORD_COUNT]) {
      const num = Number(settings[KEY_WORD_COUNT]);
      if (Number.isFinite(num) && num > 0) autoStore.targetWordCount = num;
    }
    if (settings[KEY_TARGET_TYPE] && ["story", "outline"].includes(settings[KEY_TARGET_TYPE])) {
      autoStore.outputTargetType = settings[KEY_TARGET_TYPE] as OutputTargetType;
    }
    if (settings[KEY_ARTICLE_LENGTH] && ["short", "medium", "long"].includes(settings[KEY_ARTICLE_LENGTH])) {
      autoStore.articleLength = settings[KEY_ARTICLE_LENGTH] as ArticleLength;
    }
    if (settings[KEY_SETUP]) {
      const parsed = JSON.parse(settings[KEY_SETUP]);
      if (parsed && typeof parsed === "object") {
        autoStore.setup = { ...autoStore.setup, ...parsed };
      }
    }
    if (settings[KEY_STORY_IDS]) {
      const parsed = JSON.parse(settings[KEY_STORY_IDS]);
      if (Array.isArray(parsed)) autoStore.selectedStoryIds = parsed;
    }
    if (settings[KEY_NARRATIVE_IDS]) {
      const parsed = JSON.parse(settings[KEY_NARRATIVE_IDS]);
      if (Array.isArray(parsed)) autoStore.selectedNarrativeIds = parsed;
    }
    if (settings[KEY_SESSION_SOURCES]) {
      const parsed = JSON.parse(settings[KEY_SESSION_SOURCES]);
      if (Array.isArray(parsed)) autoStore.sessionSources = parsed;
    }
    if (settings[KEY_DRAFT_FOLDERS]) {
      const parsed = JSON.parse(settings[KEY_DRAFT_FOLDERS]);
      if (Array.isArray(parsed)) autoStore.draftFolders = parsed;
    }
    if (settings[KEY_AUTO_SESSIONS]) {
      const parsed = JSON.parse(settings[KEY_AUTO_SESSIONS]);
      if (Array.isArray(parsed)) autoStore.autoSessions = parsed;
    }
    if (typeof settings[KEY_THINKING_EXPANDED] === "string") {
      autoStore.thinkingExpanded = settings[KEY_THINKING_EXPANDED] !== "false";
    }
    if (settings[KEY_LEFT_PANEL_TAB] && ["source", "drafts"].includes(settings[KEY_LEFT_PANEL_TAB])) {
      autoStore.leftPanelTab = settings[KEY_LEFT_PANEL_TAB] as "source" | "drafts";
    }
    if (settings[KEY_COLLAPSED_FOLDERS]) {
      const parsed = JSON.parse(settings[KEY_COLLAPSED_FOLDERS]);
      if (Array.isArray(parsed)) autoStore.collapsedFolderIds = parsed.filter((x) => typeof x === "string");
    }
  } catch (e) {
    console.error("bootAutoStore error:", e);
  }
}

watch(
  () => [
    autoStore.aiTurns,
    autoStore.topicContent,
    autoStore.writingMode,
    autoStore.targetWordCount,
    autoStore.outputTargetType,
    autoStore.articleLength,
    autoStore.setup,
    autoStore.selectedStoryIds,
    autoStore.selectedNarrativeIds,
    autoStore.sessionSources,
    autoStore.draftFolders,
    autoStore.autoSessions,
    autoStore.thinkingExpanded,
    autoStore.leftPanelTab,
    autoStore.collapsedFolderIds,
  ],
  () => {
    if (!booted) return;
    try {
      void saveSettings([
        { key: KEY_TURNS, value: JSON.stringify(autoStore.aiTurns) },
        { key: KEY_TOPIC, value: autoStore.topicContent },
        { key: KEY_MODE, value: autoStore.writingMode },
        { key: KEY_WORD_COUNT, value: String(autoStore.targetWordCount) },
        { key: KEY_TARGET_TYPE, value: autoStore.outputTargetType },
        { key: KEY_ARTICLE_LENGTH, value: autoStore.articleLength },
        { key: KEY_SETUP, value: JSON.stringify(autoStore.setup) },
        { key: KEY_STORY_IDS, value: JSON.stringify(autoStore.selectedStoryIds) },
        { key: KEY_NARRATIVE_IDS, value: JSON.stringify(autoStore.selectedNarrativeIds) },
        { key: KEY_SESSION_SOURCES, value: JSON.stringify(autoStore.sessionSources) },
        { key: KEY_DRAFT_FOLDERS, value: JSON.stringify(autoStore.draftFolders) },
        { key: KEY_AUTO_SESSIONS, value: JSON.stringify(autoStore.autoSessions) },
        { key: KEY_THINKING_EXPANDED, value: String(autoStore.thinkingExpanded) },
        { key: KEY_LEFT_PANEL_TAB, value: autoStore.leftPanelTab },
        { key: KEY_COLLAPSED_FOLDERS, value: JSON.stringify(autoStore.collapsedFolderIds) },
      ]);
    } catch (e) {
      console.error("saveAutoStore error:", e);
    }
  },
  { deep: true },
);
