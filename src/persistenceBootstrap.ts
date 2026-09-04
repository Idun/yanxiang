import { watch } from "vue";
import { setCustomContentColors } from "./contentColoring";
import {
  aiSettings,
  activateProviderProfile,
  apiTypeOptions,
  defaultApiTypeFor,
  type ApiType,
  applyFont,
  applyKnowledgeAutoLoad,
  applyProvider,
  applyTheme,
  clampEditorFontSize,
  clampEditorLineHeight,
  clampEditorMarginX,
  clampEditorMarginY,
  type ContentColorScheme,
  MAX_CONTENT_COLOR_SCHEMES,
} from "./settings";
import { docStore } from "./docStore";
import { libraryStore } from "./libraryStore";
import { refineStore } from "./refineStore";
import { documentFilesStore } from "./documentFilesStore";
import { materialStore, ensureDefaultMaterials, normalizeMaterialOrder } from "./materialStore";
import {
  exportNarrativeSelections,
  importNarrativeSelections,
  narrativeStore,
} from "./narrativeStore";
import { exportStorySelection, importStorySelection, storyStore } from "./storyStore";
import {
  clampRingOpacity,
  clampRingSize,
  exportRingPositions,
  importRingPositions,
  readingRingStore,
} from "./readingRingStore";
import {
  exportReadingPositions,
  importReadingPositions,
  pruneReadingPositions,
  readingPositionStore,
} from "./readingPositionStore";
import { insightStore, refreshInsights } from "./insightStore";
import { bootHomeStore } from "./homeStore";
import { bootRevisionStore } from "./revisionStore";
import { exportTokenUsage, importTokenUsage, tokenStore } from "./tokenStore";
import { exportMap, importMap, mapStore, pruneMissingCards } from "./mapStore";
import { rebuildInsightVectorIndex } from "./vectorStore";
import {
  loadCardGroups,
  loadDocument,
  loadRefineHistory,
  loadSettings,
  loadWritingCards,
  saveCardGroups,
  saveDocument,
  saveRefineHistory,
  saveSettings,
  saveWritingCards,
  type CardGroupPayload,
  type RefineHistoryPayload,
  type WritingCardPayload,
} from "./persistence";
import { WRITER_AGENT_PROMPT } from "./prompts/writerAgent";
import { AUDITOR_AGENT_PROMPT } from "./prompts/auditorAgent";
import { REFINE_AGENT_PROMPT } from "./prompts/refineAgent";
import { CHAT_AGENT_PROMPT } from "./prompts/chatAgent";

let booted = false;

/* Bump this whenever the bundled prompts change so that previously stored
   prompt texts are re-synced with the latest defaults on next launch.

   v2: prompts 从「硬门槛」等旧措辞改为「硬性限制」，旧版本持久化的
   writer/auditor/refine 提示词需作废重同步，否则对话仍会沿用旧提示词。
   v3: 精修提示词新增「标点硬性限制：一律不动」一节，必须重同步，
   否则老用户的精修仍会照旧改标点。
   v4: 精修提示词重构：压缩标点限制、移除「拆分长复合句 / 使用破折号」等与
   「标点一律不动」矛盾的改写手法、解除「只占少数」配额改为按句子质地判断。
   必须重同步，否则老用户（含 v3 以来的默认副本）仍沿用旧版失衡提示词。
   v5: 精修提示词再次重构 —— v3/v4 那套「先判断再动手、自然句一律不得改动」
   的措辞让模型大面积照抄（十句里九句原样返回）。现在改为「默认动手改 +
   八项检查表 + 每组至少一半必须实质改写」，并把「标点一律不动」放宽为
   「标点写法照原文、句末对齐原文、句内断句可为改写需要而调整」。
   必须重同步，否则老用户仍沿用那份让模型不改的提示词。 */
const PROMPT_SYNC_VERSION = 5;

export async function initPersistence() {
  if (booted) return;
  booted = true;

  /* Restore settings */
  const settings = await loadSettings();
  if (settings.provider) aiSettings.provider = settings.provider;
  if (settings.url) aiSettings.url = settings.url;
  if (settings.model) aiSettings.model = settings.model;
  if (settings.auditorModel) aiSettings.auditorModel = settings.auditorModel;
  if (settings.apiKey) aiSettings.apiKey = settings.apiKey;
  /* Re-sync prompts: when the bundled prompt version is bumped, ignore any
     previously-stored prompt texts so the settings panel shows the latest ones. */
  aiSettings.writerPrompt =
    settings.writerPrompt?.trim()
      ? settings.writerPrompt
      : WRITER_AGENT_PROMPT;
  aiSettings.auditorPrompt =
    settings.auditorPrompt?.trim()
      ? settings.auditorPrompt
      : AUDITOR_AGENT_PROMPT;
  aiSettings.refinePrompt =
    settings.refinePrompt?.trim()
      ? settings.refinePrompt
      : REFINE_AGENT_PROMPT;
  aiSettings.chatPrompt =
    settings.chatPrompt?.trim()
      ? settings.chatPrompt
      : CHAT_AGENT_PROMPT;
  if (settings.promptSyncVersion !== String(PROMPT_SYNC_VERSION)) {
    aiSettings.writerPrompt = WRITER_AGENT_PROMPT;
    aiSettings.auditorPrompt = AUDITOR_AGENT_PROMPT;
    aiSettings.refinePrompt = REFINE_AGENT_PROMPT;
    aiSettings.chatPrompt = CHAT_AGENT_PROMPT;
  }
  if (settings.vectorEnabled !== undefined) {
    aiSettings.vectorEnabled = settings.vectorEnabled === "true";
  }
  if (settings.selectionToolbarEnabled !== undefined) {
    aiSettings.selectionToolbarEnabled = settings.selectionToolbarEnabled === "true";
  }
  if (settings.revisionAnnotationEnabled !== undefined) {
    aiSettings.revisionAnnotationEnabled = settings.revisionAnnotationEnabled === "true";
  }
  if (settings.materialLibraryEnabled !== undefined) {
    aiSettings.materialLibraryEnabled = settings.materialLibraryEnabled === "true";
  }
  if (settings.storyCraftEnabled !== undefined) {
    aiSettings.storyCraftEnabled = settings.storyCraftEnabled === "true";
  }
  if (settings.narrativeCraftEnabled !== undefined) {
    aiSettings.narrativeCraftEnabled = settings.narrativeCraftEnabled === "true";
  }
  if (settings.readingRingEnabled !== undefined) {
    aiSettings.readingRingEnabled = settings.readingRingEnabled === "true";
  }
  if (settings.readingRingSize !== undefined) {
    aiSettings.readingRingSize = clampRingSize(Number(settings.readingRingSize));
  }
  if (settings.readingRingOpacity !== undefined) {
    aiSettings.readingRingOpacity = clampRingOpacity(Number(settings.readingRingOpacity));
  }
  /* 圆环摆放位置（每个界面位点一条归一化坐标）。 */
  if (settings.readingRingPositions) {
    try {
      importRingPositions(JSON.parse(settings.readingRingPositions));
    } catch {
      /* keep default → 右上角 */
    }
  }
  if (settings.vectorSource === "local" || settings.vectorSource === "remote") {
    aiSettings.vectorSource = settings.vectorSource;
  }
  if (settings.activeVectorModel) {
    aiSettings.activeVectorModel = settings.activeVectorModel;
  }
  if (settings.builtinVectorModels) {
    try {
      aiSettings.builtinVectorModels = JSON.parse(settings.builtinVectorModels);
    } catch {
      /* keep default */
    }
  }
  applyProvider(aiSettings.provider);
  /* applyProvider resets url/model from the provider defaults — restore the
     user's own values afterwards (critical for OpenAICompatible relays, whose
     default url is empty). */
  if (settings.url) aiSettings.url = settings.url;
  if (settings.apiType) {
    /* Guard against a stale/unknown value from an older build. */
    const known = apiTypeOptions.some((o) => o.id === settings.apiType);
    aiSettings.apiType = known ? (settings.apiType as ApiType) : defaultApiTypeFor(aiSettings.provider);
  }
  if (settings.model) {
    aiSettings.model = settings.model;
    if (!aiSettings.models.includes(settings.model)) {
      aiSettings.models = [settings.model, ...aiSettings.models];
    }
  }
  if (settings.auditorModel) aiSettings.auditorModel = settings.auditorModel;
  /* Restore saved provider cards, then re-apply the active one so the live
     settings (key/url/model) match the card the user last used. */
  if (settings.providerProfiles) {
    try {
      const parsed = JSON.parse(settings.providerProfiles);
      if (Array.isArray(parsed)) aiSettings.providerProfiles = parsed;
    } catch {
      /* keep default */
    }
  }
  if (settings.activeProfileId) {
    aiSettings.activeProfileId = settings.activeProfileId;
    activateProviderProfile(settings.activeProfileId);
  }
  if (settings.chatKnowledge) {
    try {
      aiSettings.chatKnowledge = JSON.parse(settings.chatKnowledge);
    } catch {
      /* keep default */
    }
  }
  if (settings.writerKnowledge) {
    try {
      aiSettings.writerKnowledge = JSON.parse(settings.writerKnowledge);
    } catch {
      /* keep default */
    }
  }
  if (settings.auditorKnowledge) {
    try {
      aiSettings.auditorKnowledge = JSON.parse(settings.auditorKnowledge);
    } catch {
      /* keep default */
    }
  }
  if (settings.chatKnowledgeAutoLoad !== undefined) {
    aiSettings.chatKnowledgeAutoLoad = settings.chatKnowledgeAutoLoad === "true";
  }
  if (settings.writerKnowledgeAutoLoad !== undefined) {
    aiSettings.writerKnowledgeAutoLoad = settings.writerKnowledgeAutoLoad === "true";
  }
  if (settings.auditorKnowledgeAutoLoad !== undefined) {
    aiSettings.auditorKnowledgeAutoLoad = settings.auditorKnowledgeAutoLoad === "true";
  }
  if (settings.webSearchEnabled !== undefined) {
    aiSettings.webSearchEnabled = settings.webSearchEnabled === "true";
  }
  if (settings.webSearchEngine === "bing" || settings.webSearchEngine === "google") {
    aiSettings.webSearchEngine = settings.webSearchEngine;
  }
  if (settings.thinkingLevel === "off" || settings.thinkingLevel === "auto" || settings.thinkingLevel === "standard") {
    aiSettings.thinkingLevel = settings.thinkingLevel;
  }
  /* Sync bundled knowledge with the auto-load flags (chat/writer/auditor). */
  applyKnowledgeAutoLoad("chat");
  applyKnowledgeAutoLoad("writer");
  applyKnowledgeAutoLoad("auditor");

  /* Restore appearance (font + theme) and push it into the CSS variables. */
  if (settings.appFont) {
    applyFont(settings.appFont);
  } else {
    applyFont(aiSettings.appFont);
  }
  /* 编辑区字号与排版：所有编辑区共用一份。 */
  if (settings.editorFontSize !== undefined) {
    aiSettings.editorFontSize = clampEditorFontSize(Number(settings.editorFontSize));
  }
  if (settings.editorLineHeight !== undefined) {
    aiSettings.editorLineHeight = clampEditorLineHeight(Number(settings.editorLineHeight));
  }
  if (settings.editorMarginX !== undefined) {
    aiSettings.editorMarginX = clampEditorMarginX(Number(settings.editorMarginX));
  }
  if (settings.editorMarginY !== undefined) {
    aiSettings.editorMarginY = clampEditorMarginY(Number(settings.editorMarginY));
  }
  if (settings.editorGridLine !== undefined) {
    const gl = settings.editorGridLine;
    if (gl === "none" || gl === "solid" || gl === "dashed" || gl === "dotted") {
      aiSettings.editorGridLine = gl;
    }
  }
  if (settings.theme) {
    try {
      applyTheme(JSON.parse(settings.theme));
    } catch {
      /* keep default */
    }
  }
  if (settings.firstLineIndent !== undefined) {
    aiSettings.firstLineIndent = settings.firstLineIndent === "true";
  }
  if (settings.dropCap !== undefined) {
    aiSettings.dropCap = settings.dropCap === "true";
  }
  if (settings.contentColorScheme) {
    try {
      const parsed = JSON.parse(settings.contentColorScheme);
      aiSettings.contentColorScheme = parsed;
      setCustomContentColors(parsed);
    } catch {
      /* keep default */
    }
  }
  /* 内容上色方案集：恢复到最近的方案（如「方案二」），并以其为当前生效配色。
     旧版本可能存下超过上限的记录，这里按 MAX_CONTENT_COLOR_SCHEMES 截断。 */
  if (settings.contentColorSchemes) {
    try {
      const parsed = JSON.parse(settings.contentColorSchemes) as ContentColorScheme[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        aiSettings.contentColorSchemes = parsed
          .filter((s) => s && typeof s.id === "string" && s.colors && typeof s.colors === "object")
          .slice(0, MAX_CONTENT_COLOR_SCHEMES);
        const last = aiSettings.contentColorSchemes[aiSettings.contentColorSchemes.length - 1];
        if (last) {
          aiSettings.contentColorScheme = { ...last.colors };
          setCustomContentColors(last.colors);
        }
      }
    } catch {
      /* keep default */
    }
  }

  /* Persist the prompt sync version up-front so subsequent launches know the
     prompts are already in sync with the current bundled defaults. */
  void saveSettings([{ key: "promptSyncVersion", value: String(PROMPT_SYNC_VERSION) }]);

  /* Restore Refine active content */
  if (settings.refineInputText !== undefined) {
    refineStore.inputText = settings.refineInputText;
  }
  if (settings.refineState === "input" || settings.refineState === "processing" || settings.refineState === "completed") {
    refineStore.state = settings.refineState;
  }
  if (settings.refineProcessedSentences) {
    try {
      refineStore.processedSentences = JSON.parse(settings.refineProcessedSentences);
    } catch {
      /* keep default */
    }
  }

  /* Restore document */
  const doc = await loadDocument();
  if (doc) docStore.markdown = doc;

  /* Restore document file tree */
  if (settings.docTreeFolders) {
    try {
      documentFilesStore.folders = JSON.parse(settings.docTreeFolders);
    } catch {
      /* keep default */
    }
  }
  if (settings.docTreeFiles) {
    try {
      documentFilesStore.files = JSON.parse(settings.docTreeFiles);
    } catch {
      /* keep default */
    }
  }
  if (settings.activeDocFileId) {
    documentFilesStore.activeFileId = settings.activeDocFileId;
  }
  if (!documentFilesStore.files.some((f) => f.id === documentFilesStore.activeFileId)) {
    documentFilesStore.activeFileId = documentFilesStore.files[0]?.id ?? null;
  }

  /* Restore 阅读停留位置（按文档条目分别记忆）。必须排在文档树之后：
     恢复完才知道哪些文档还在，才能顺手清掉已删除文档的残留记忆。 */
  if (settings.docReadingPositions) {
    try {
      importReadingPositions(JSON.parse(settings.docReadingPositions));
    } catch {
      /* keep default */
    }
  }
  pruneReadingPositions(documentFilesStore.files.map((f) => f.id));

  /* Migrate any pre-existing single document into the default Main file. */
  if (docStore.markdown) {
    const target =
      documentFilesStore.files.find((f) => f.id === documentFilesStore.activeFileId) ??
      documentFilesStore.files.find((f) => f.folderId === null) ??
      documentFilesStore.files[0];
    if (target && !target.content) {
      target.content = docStore.markdown;
    }
  }

  /* Restore material library */
  if (settings.chatMaterials) {
    try {
      materialStore.items = JSON.parse(settings.chatMaterials);
    } catch {
      /* keep default */
    }
  }
  /* Merge any missing defaults (e.g. newly-shipped materials) without
     overriding entries the user has already customized or removed. */
  ensureDefaultMaterials();
  /* 既有已持久化素材的顺序修正：确保「倒推五线手法」位于「五线写作原则」下方。 */
  normalizeMaterialOrder();

  /* Restore 叙事定制勾选（对话 / AI写作 各自独立）。 */
  if (settings.narrativeSelections) {
    try {
      importNarrativeSelections(JSON.parse(settings.narrativeSelections));
    } catch {
      /* keep empty selection → 走项目原有流程 */
    }
  }

  /* Restore 故事定制勾选（角色原型 / 情节，仅「对话」标签页）。 */
  if (settings.storySelection) {
    try {
      importStorySelection(JSON.parse(settings.storySelection));
    } catch {
      /* keep empty selection → 走项目原有流程 */
    }
  }

  /* Restore writing cards & groups */
  const cards = await loadWritingCards();
  if (cards.length > 0) {
    libraryStore.cards = cards.map((c, i) => ({
      id: c.id ?? i + 1,
      title: c.title,
      content: c.content,
      x: c.x,
      y: c.y,
      groupId: c.groupId,
    }));
  }
  const groups = await loadCardGroups();
  if (groups.length > 0) {
    libraryStore.groups = groups.map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      folded: !!g.folded,
      collapsed: !!g.collapsed,
    }));
  }
  /* 防御性恢复：旧版本或分组落库失败的场景下，卡片可能带着 groupId 而分组
     未写入（例如过去 color 约束冲突导致 db_save_card_groups 整批失败）。此时
     不能把卡片的 groupId 悄悄清掉——否则重启后打组就“丢”了。这里自动重建
     缺失的分组，保住组框与卡片的隶属关系，不产生悬挂引用。 */
  const validGroupIds = new Set(libraryStore.groups.map((g) => g.id));
  const restored = libraryStore.groups;
  for (const card of libraryStore.cards) {
    if (card.groupId && !validGroupIds.has(card.groupId)) {
      restored.push({ id: card.groupId, title: `分组 ${restored.length + 1}`, folded: false, collapsed: false });
      validGroupIds.add(card.groupId);
    }
  }
  if (restored.length > libraryStore.groups.length) {
    libraryStore.groups = [...restored];
  }

  /* Card accent overrides live in the settings map rather than the card table,
     so no SQLite migration is needed for what is purely presentational. */
  if (settings.cardAccents) {
    try {
      const map = JSON.parse(settings.cardAccents) as Record<string, string>;
      for (const card of libraryStore.cards) {
        const accent = map[String(card.id)];
        if (accent) card.accent = accent;
      }
    } catch {
      /* ignore */
    }
  }

  /* Restore refine history */
  const history = await loadRefineHistory();
  if (history.length > 0) {
    refineStore.historyVersions = history.map((h) => ({
      id: h.id,
      time: h.time,
      title: h.title,
      original: h.original,
      content: h.content,
      chars: h.chars,
      adjusted: h.adjusted,
      tokens: h.tokens,
    }));
  }

  /* Restore the story map (paths / places / groups) */
  if (settings.mapData) {
    try {
      importMap(JSON.parse(settings.mapData));
    } catch {
      /* keep empty map */
    }
  }
  /* Drop attachments for cards that no longer exist. */
  pruneMissingCards(new Set(libraryStore.cards.map((c) => c.id)));

  /* Restore the modification memory that powers 洞察 → 修改记忆 */
  if (settings.insightHistory) {
    try {
      const parsed = JSON.parse(settings.insightHistory);
      if (Array.isArray(parsed)) insightStore.history.items = parsed;
    } catch {
      /* keep empty */
    }
  }
  if (settings.insightToggles) {
    try {
      const parsed = JSON.parse(settings.insightToggles);
      if (Array.isArray(parsed)) {
        parsed.forEach((on: boolean, i: number) => {
          if (insightStore.habits.toggles[i]) insightStore.habits.toggles[i].on = !!on;
        });
      }
    } catch {
      /* keep defaults */
    }
  }

  /* Restore the global Token ledger that powers 主页 → Token HUD */
  if (settings.tokenUsage) {
    try {
      importTokenUsage(JSON.parse(settings.tokenUsage));
    } catch {
      /* keep zeros */
    }
  }

  /* Derive habits / profile from the restored corpus, then keep them fresh. */
  refreshInsights(true);
  rebuildInsightVectorIndex();

  /* 主页数据（置顶 / 最近打开 / 今日目标）。放在文档树恢复之后，这样第一次
     记录的「最近打开」指向的是真实存在的文档。 */
  await bootHomeStore();

  /* 修订与批注图层：同样要在文档树恢复之后，孤立图层才能被正确清理。
     图层自带落库监听，恢复完成后才会开始写入。 */
  await bootRevisionStore();

  let insightTimer: number | null = null;
  watch(
    () => [
      documentFilesStore.files.map((f) => f.content.length).join(","),
      libraryStore.cards.length,
      refineStore.historyVersions.length,
    ],
    () => {
      if (insightTimer !== null) window.clearTimeout(insightTimer);
      /* Debounced: analysis is O(corpus) and typing shouldn't trigger it. */
      insightTimer = window.setTimeout(() => {
        insightTimer = null;
        if (refreshInsights()) rebuildInsightVectorIndex();
      }, 2500);
    },
    { deep: true },
  );

  watch(
    () => [insightStore.history.items, insightStore.habits.toggles],
    () => {
      try {
        void saveSettings([
          { key: "insightHistory", value: JSON.stringify(insightStore.history.items) },
          {
            key: "insightToggles",
            value: JSON.stringify(insightStore.habits.toggles.map((t) => t.on)),
          },
        ]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* Token 账本：只在 updatedAt 变化时落盘，避免深比较整张表。 */
  watch(
    () => tokenStore.updatedAt,
    () => {
      try {
        void saveSettings([{ key: "tokenUsage", value: JSON.stringify(exportTokenUsage()) }]);
      } catch {
        /* ignore */
      }
    },
  );

  /* Autosave wiring */
  watch(
    () => aiSettings,
    (s) => {
      let chatKnowledge: string;
      let writerKnowledge: string;
      let auditorKnowledge: string;
      let providerProfiles: string;
      try {
        chatKnowledge = JSON.stringify(s.chatKnowledge);
      } catch {
        chatKnowledge = "[]";
      }
      try {
        writerKnowledge = JSON.stringify(s.writerKnowledge);
      } catch {
        writerKnowledge = "[]";
      }
      try {
        auditorKnowledge = JSON.stringify(s.auditorKnowledge);
      } catch {
        auditorKnowledge = "[]";
      }
      try {
        providerProfiles = JSON.stringify(s.providerProfiles);
      } catch {
        providerProfiles = "[]";
      }
      void saveSettings([
        { key: "provider", value: s.provider },
        { key: "apiType", value: s.apiType },
        { key: "url", value: s.url },
        { key: "model", value: s.model },
        { key: "auditorModel", value: s.auditorModel },
        { key: "apiKey", value: s.apiKey },
        { key: "providerProfiles", value: providerProfiles },
        { key: "activeProfileId", value: s.activeProfileId },
        { key: "writerPrompt", value: s.writerPrompt },
        { key: "auditorPrompt", value: s.auditorPrompt },
        { key: "refinePrompt", value: s.refinePrompt },
        { key: "chatPrompt", value: s.chatPrompt },
        { key: "writerKnowledge", value: writerKnowledge },
        { key: "auditorKnowledge", value: auditorKnowledge },
        { key: "chatKnowledge", value: chatKnowledge },
        { key: "writerKnowledgeAutoLoad", value: String(s.writerKnowledgeAutoLoad) },
        { key: "auditorKnowledgeAutoLoad", value: String(s.auditorKnowledgeAutoLoad) },
        { key: "chatKnowledgeAutoLoad", value: String(s.chatKnowledgeAutoLoad) },
        { key: "promptSyncVersion", value: String(PROMPT_SYNC_VERSION) },
        { key: "webSearchEnabled", value: String(s.webSearchEnabled) },
        { key: "webSearchEngine", value: s.webSearchEngine },
        { key: "thinkingLevel", value: s.thinkingLevel },
        { key: "vectorEnabled", value: String(s.vectorEnabled) },
        { key: "selectionToolbarEnabled", value: String(s.selectionToolbarEnabled) },
        { key: "revisionAnnotationEnabled", value: String(s.revisionAnnotationEnabled) },
        { key: "materialLibraryEnabled", value: String(s.materialLibraryEnabled) },
        { key: "storyCraftEnabled", value: String(s.storyCraftEnabled) },
        { key: "narrativeCraftEnabled", value: String(s.narrativeCraftEnabled) },
        { key: "readingRingEnabled", value: String(s.readingRingEnabled) },
        { key: "readingRingSize", value: String(s.readingRingSize) },
        { key: "readingRingOpacity", value: String(s.readingRingOpacity) },
        { key: "vectorSource", value: s.vectorSource },
        { key: "activeVectorModel", value: s.activeVectorModel },
        { key: "builtinVectorModels", value: JSON.stringify(s.builtinVectorModels) },
        { key: "firstLineIndent", value: String(s.firstLineIndent) },
        { key: "dropCap", value: String(s.dropCap) },
        { key: "contentColorScheme", value: JSON.stringify(s.contentColorScheme) },
        { key: "contentColorSchemes", value: JSON.stringify(s.contentColorSchemes) },
        { key: "appFont", value: s.appFont },
        { key: "editorFontSize", value: String(s.editorFontSize) },
        { key: "editorLineHeight", value: String(s.editorLineHeight) },
        { key: "editorMarginX", value: String(s.editorMarginX) },
        { key: "editorMarginY", value: String(s.editorMarginY) },
        { key: "editorGridLine", value: s.editorGridLine },
        { key: "theme", value: JSON.stringify(s.theme) },
      ]);
    },
    { deep: true },
  );

  watch(
    () => [refineStore.inputText, refineStore.state, refineStore.processedSentences],
    () => {
      let processedStr = "[]";
      try {
        processedStr = JSON.stringify(refineStore.processedSentences);
      } catch {
        /* ignore */
      }
      void saveSettings([
        { key: "refineInputText", value: refineStore.inputText },
        { key: "refineState", value: refineStore.state },
        { key: "refineProcessedSentences", value: processedStr },
      ]);
    },
    { deep: true },
  );

  watch(
    () => docStore.markdown,
    (val) => {
      void saveDocument(val);
    },
  );

  watch(
    () => libraryStore.cards,
    (cards) => {
      const payload: WritingCardPayload[] = cards.map((c) => ({
        id: c.id,
        title: c.title,
        content: c.content,
        x: c.x,
        y: c.y,
        groupId: c.groupId,
      }));
      void saveWritingCards(payload).catch((err) => console.error("saveWritingCards failed:", err));

      /* Presentational extras stored alongside, keyed by card id. */
      const accents: Record<string, string> = {};
      for (const c of cards) {
        if (c.accent) accents[String(c.id)] = c.accent;
      }
      void saveSettings([{ key: "cardAccents", value: JSON.stringify(accents) }]);
    },
    { deep: true },
  );

  watch(
    () => libraryStore.groups,
    (groups) => {
      const payload: CardGroupPayload[] = groups.map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        folded: g.folded,
        collapsed: g.collapsed,
      }));
      void saveCardGroups(payload).catch((err) => console.error("saveCardGroups failed:", err));
    },
    { deep: true },
  );

  watch(
    () => refineStore.historyVersions,
    (items) => {
      const payload: RefineHistoryPayload[] = items.map((h) => ({
        id: h.id,
        time: h.time,
        title: h.title,
        original: h.original,
        content: h.content,
        chars: h.chars,
        adjusted: h.adjusted,
        tokens: h.tokens,
      }));
      void saveRefineHistory(payload);
    },
    { deep: true },
  );

  /* Document file tree persistence */
  watch(
    () => documentFilesStore,
    (store) => {
      try {
        void saveSettings([
          { key: "docTreeFolders", value: JSON.stringify(store.folders) },
          { key: "docTreeFiles", value: JSON.stringify(store.files) },
          { key: "activeDocFileId", value: store.activeFileId ?? "" },
        ]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* Material library persistence */
  watch(
    () => materialStore.items,
    (items) => {
      try {
        void saveSettings([{ key: "chatMaterials", value: JSON.stringify(items) }]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* 叙事定制持久化：结构 / 手法 / 结尾的勾选跨会话保留。 */
  watch(
    () => narrativeStore.selections,
    () => {
      try {
        void saveSettings([
          { key: "narrativeSelections", value: JSON.stringify(exportNarrativeSelections()) },
        ]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* 故事定制持久化：角色原型 / 情节的勾选跨会话保留。 */
  watch(
    () => storyStore.selection,
    () => {
      try {
        void saveSettings([
          { key: "storySelection", value: JSON.stringify(exportStorySelection()) },
        ]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* Story map persistence */
  watch(
    () => [mapStore.paths, mapStore.places, mapStore.groups, mapStore.showGrid],
    () => {
      try {
        void saveSettings([{ key: "mapData", value: JSON.stringify(exportMap()) }]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* 阅读圆环摆放位置：拖动松手才写入 store，所以这里落库频率天然很低。 */
  watch(
    () => readingRingStore.positions,
    () => {
      try {
        void saveSettings([
          { key: "readingRingPositions", value: JSON.stringify(exportRingPositions()) },
        ]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* 阅读停留位置：DocumentViewer 已把滚动事件合并到停手后才写 store，
     这里再叠一层 800ms 节流，长文连续翻页也不会频繁落库。 */
  let readingPosTimer: number | null = null;
  watch(
    () => readingPositionStore.positions,
    () => {
      if (readingPosTimer !== null) return;
      readingPosTimer = window.setTimeout(() => {
        readingPosTimer = null;
        try {
          void saveSettings([
            { key: "docReadingPositions", value: JSON.stringify(exportReadingPositions()) },
          ]);
        } catch {
          /* ignore */
        }
      }, 800);
    },
    { deep: true },
  );
}
