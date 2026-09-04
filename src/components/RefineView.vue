<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { BrainCircuit, Check, CheckCheck, ChevronDown, ChevronRight, Clock, Copy, Download, History, PencilLine, Play, Square, Trash2, X, ArrowLeft } from "lucide-vue-next";
import { activateProviderProfile, aiSettings, providerLabel } from "../settings";
import { REFINE_AGENT_PROMPT } from "../prompts/refineAgent";
import { runAgent } from "../agentRunner";
import { refreshInsights, showToast } from "../insightStore";
import { refineStore, type HistoryVersion, type RefinedSentence } from "../refineStore";
import { mergeRefined, type RefineOutcome } from "../refinePunctuation";
import { parseRefinedLines, splitSentences } from "../refineText";
import { recordTokens } from "../tokenStore";

const historyOpen = ref(false);
const compareVersion = ref<HistoryVersion | null>(null);
let originalSnapshot = "";
let cancelled = false;
let currentController: AbortController | null = null;

const historyVersions = computed(() => refineStore.historyVersions);

const inputText = computed({
  get: () => refineStore.inputText,
  set: (val: string) => {
    refineStore.inputText = val;
  },
});

const parallelGroups = computed({
  get: () => refineStore.parallelGroups,
  set: (val: number) => {
    refineStore.parallelGroups = val;
  },
});

type RefineState = "input" | "processing" | "completed";

const state = computed<RefineState>({
  get: () => refineStore.state,
  set: (val) => {
    refineStore.state = val;
  },
});

const processedSentences = computed<RefinedSentence[]>({
  get: () => refineStore.processedSentences,
  set: (val) => {
    refineStore.processedSentences = val;
  },
});

const progress = computed({
  get: () => refineStore.progress,
  set: (val) => {
    refineStore.progress = val;
  },
});

const totalGroups = computed({
  get: () => refineStore.totalGroups,
  set: (val) => {
    refineStore.totalGroups = val;
  },
});

const completedGroups = computed({
  get: () => refineStore.completedGroups,
  set: (val) => {
    refineStore.completedGroups = val;
  },
});

const adjustedCount = computed({
  get: () => refineStore.adjustedCount,
  set: (val) => {
    refineStore.adjustedCount = val;
  },
});

const charCount = computed(() => refineStore.inputText.length);
const sentenceCount = computed(() => {
  if (!refineStore.inputText.trim()) return 0;
  /* 与实际断句保持一致，免得「识别句子」和真正处理的句数对不上。 */
  return splitSentences(refineStore.inputText).length;
});

/** 实质改写占比：直接摆出来，用户一眼能看到这次到底改了多少。 */
const reviseRateLabel = computed(() => {
  const total = refineStore.processedSentences.length;
  if (total === 0) return "—";
  const pct = Math.round((refineStore.adjustedCount / total) * 100);
  return `${refineStore.adjustedCount}/${total} · ${pct}%`;
});

const hasApiKey = computed(() => aiSettings.apiKey.trim().length > 0);

const finalText = computed(() => {
  return processedSentences.value
    .map((s) => (s.accepted === false ? s.original : s.refined))
    .join("");
});

const finalCharCount = computed(() => finalText.value.replace(/\s/g, "").length);

/* ---- 修改采纳/拒绝 ------ */

/** 单句修订的三态决定：none(未修改) / pending(待定) / accepted / rejected。 */
function decisionOf(item: RefinedSentence): "none" | "pending" | "accepted" | "rejected" {
  if (item.changes.length === 0) return "none";
  if (item.accepted === false) return "rejected";
  if (item.accepted === true) return "accepted";
  return "pending";
}

const decisionStats = computed(() => {
  let accepted = 0;
  let rejected = 0;
  for (const item of processedSentences.value) {
    const d = decisionOf(item);
    if (d === "accepted" || d === "pending") accepted++;
    else if (d === "rejected") rejected++;
  }
  return { accepted, rejected };
});

/** 接受本句修订：修订内容进入原文（accepted=true 后按 refined 输出）。 */
function toggleAccept(item: RefinedSentence) {
  item.accepted = item.accepted === true ? undefined : true;
  syncCurrentVersion();
}

/** 拒绝本句修订：原文不动（accepted=false 后按 original 输出）。 */
function toggleReject(item: RefinedSentence) {
  item.accepted = item.accepted === false ? undefined : false;
  syncCurrentVersion();
}

/** 一键接受全部修改：所有修订均按原本意见（refined）执行。 */
function acceptAll() {
  let applied = 0;
  for (const item of processedSentences.value) {
    if (item.changes.length > 0 && item.accepted !== true) {
      item.accepted = true;
      applied++;
    }
  }
  if (applied > 0) {
    syncCurrentVersion();
    showToast("已全部接受", `已将 ${applied} 处修改全部采纳到原文`, "habit");
  } else {
    showToast("无需处理", "当前修订均已接受，无需重复操作", "edit");
  }
}

/* ---- 模型选择器（与写作界面右侧面板的模型下拉保持同一套交互） ---- */

interface RefineModelGroup {
  id: string;
  label: string;
  provider: string;
  models: string[];
  /** True for the provider profile that is currently live. */
  isActive: boolean;
}

const modelPickerOpen = ref(false);
const refineModelFilter = ref("");
const refineExpandedGroups = ref<Set<string>>(new Set());
const refineTouchedGroups = ref(false);

/**
 * 把扁平模型列表按已保存的接口卡片分组，避免下拉变成一长串无差别的模型名。
 * 属于当前接口、但未挂到任何卡片上的模型，归入合成的「(未保存)」组。
 */
const refineModelGroups = computed<RefineModelGroup[]>(() => {
  const groups: RefineModelGroup[] = [];
  const claimed = new Set<string>();

  for (const profile of aiSettings.providerProfiles) {
    const models = profile.models.length > 0 ? [...profile.models] : [profile.model].filter(Boolean);
    if (models.length === 0) continue;
    const isActive = profile.id === aiSettings.activeProfileId;
    if (isActive) models.forEach((m) => claimed.add(m));
    groups.push({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      models,
      isActive,
    });
  }

  const loose = aiSettings.models.filter((m) => !claimed.has(m));
  if (loose.length > 0) {
    groups.push({
      id: "__current__",
      label: `${providerLabel(aiSettings.provider, aiSettings.providerName)}（未保存）`,
      provider: aiSettings.provider,
      models: loose,
      isActive: aiSettings.providerProfiles.every((p) => p.id !== aiSettings.activeProfileId),
    });
  }

  /* 当前接口排最前。 */
  groups.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  return groups;
});

function isRefineGroupOpen(group: RefineModelGroup): boolean {
  if (refineExpandedGroups.value.has(group.id)) return true;
  if (refineModelFilter.value.trim()) return true;
  return !refineTouchedGroups.value && group.models.includes(aiSettings.model);
}

function toggleRefineGroup(group: RefineModelGroup) {
  refineTouchedGroups.value = true;
  const next = new Set(refineExpandedGroups.value);
  if (next.has(group.id)) next.delete(group.id);
  else next.add(group.id);
  refineExpandedGroups.value = next;
}

function filteredRefineModels(group: RefineModelGroup): string[] {
  const q = refineModelFilter.value.trim().toLowerCase();
  if (!q) return group.models;
  return group.models.filter((m) => m.toLowerCase().includes(q));
}

const visibleRefineGroups = computed(() =>
  refineModelGroups.value.filter((g) => filteredRefineModels(g).length > 0),
);

/**
 * 选中某个接口卡片下的模型时，同时切换到该卡片的接口凭据，
 * 否则模型会被发到错误的接口上去。
 */
function selectRefineModel(group: RefineModelGroup, model: string) {
  if (group.id !== "__current__" && group.id !== aiSettings.activeProfileId) {
    activateProviderProfile(group.id);
  }
  aiSettings.model = model;
  modelPickerOpen.value = false;
  refineModelFilter.value = "";
}

const refineModelLabel = computed(() => {
  const active = aiSettings.providerProfiles.find((p) => p.id === aiSettings.activeProfileId);
  const prefix = active?.label ?? providerLabel(aiSettings.provider, aiSettings.providerName);
  return `${prefix} · ${aiSettings.model}`;
});

function handleRefineModelDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".refine-model-picker")) modelPickerOpen.value = false;
}

onMounted(() => document.addEventListener("click", handleRefineModelDocClick));
onBeforeUnmount(() => document.removeEventListener("click", handleRefineModelDocClick));

/** 采纳决定变化后，同步最新历史版本内容并刷新洞察（拒绝项不再进入统计）。 */
function syncCurrentVersion() {
  const text = finalText.value.trim();
  if (!text) return;
  const latest = refineStore.historyVersions[0];
  if (latest) {
    latest.content = text;
    latest.chars = text.length;
  }
  refreshInsights(true);
}

function changeTagType(change: string): "del" | "add" | "rep" {
  if (change.startsWith("删除")) return "del";
  if (change.startsWith("新增")) return "add";
  return "rep";
}

function usedTokensFormatted(): string {
  return refineStore.usedTokens.toLocaleString();
}

const compareDiff = computed(() => {
  if (!compareVersion.value) return null;
  return diffTexts(compareVersion.value.original, compareVersion.value.content);
});

async function callRefineGroup(
  sentences: string[],
  context: string,
  signal: AbortSignal,
  /** 补修一轮：上一轮命中率不足，点名这些句号（1 起）必须给出实质改写。 */
  retryTargets?: number[],
): Promise<{ lines: string[]; tokens: number; parsed: number; failed: boolean }> {
  /* 精修为纯提示词驱动：系统提示词只来自用户配置的精修提示词，不加载任何知识项内容。 */
  const systemPrompt = aiSettings.refinePrompt.trim() || REFINE_AGENT_PROMPT;
  const retryBlock = retryTargets?.length
    ? `\n【补修要求】上一轮你把第 ${retryTargets.join("、")} 句原样抄回来了，但用户交来的这批文本是需要修订的。请对这几句重新动手：从用词过度优化、空话套话、长定语套嵌、结构过于工整、句长均匀、抽象名词堆叠、情绪缺席、连接词过密这八项里逐条对照，找出可改之处改掉。其余句子按上一轮的结论输出即可。这一轮不允许把这几句再照抄一遍。\n`
    : "";
  const quota = Math.max(1, Math.ceil(sentences.length / 2));
  const userContent = `请逐句精修以下 ${sentences.length} 个目标句（编号从 1 开始）：
- 这批文本是用户判定「有AI味、需要修订」才交过来的，你的默认动作是改，不是照抄。
- 逐句按检查表对照：用词过度优化 / 空话套话与程式化副词 / 长定语长状语套嵌 / 结构过于工整（三项并列、对称排比）/ 句长均匀 / 抽象名词堆叠 / 情绪缺席 / 连接词过密。命中任一条就动手改。
- 本组 ${sentences.length} 句里**至少 ${quota} 句必须给出实质改写**。只有短对白、纯过渡句、以及改一个字就伤原意的句子才配得上原样照抄。
- 优先改字词与语序，其次才动句式；不要扩写，改写后字数与原句相近（不超过 1.3 倍）。
- 事实、数字、人名、专有名词一字不改，也不新增原文没有的事实。
- 标点的写法照原文抄（全角/半角、引号样式跟原文一致），句末标点与原句一致；句内断句可为改写需要而调整。
${retryBlock}
目标句：
${sentences
  .map((s, i) => `[${i + 1}] ${s}`)
  .join("\n")}\n
${context ? `参考上下文：\n${context}\n` : ""}
严格逐句输出：每句一行，行首标注编号（[1] 或 1. 均可），编号与句子一一对应，一句都不能少，不要输出任何其他内容。`;

  const result = await runAgent({
    provider: aiSettings.provider,
    apiType: aiSettings.apiType,
    apiKey: aiSettings.apiKey,
    url: aiSettings.url,
    model: aiSettings.model,
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    stream: false,
    maxRounds: 1,
    signal,
  });

  const text = (result.text ?? "").trim();
  /* 推理模型有时把正文写进 reasoning 而 content 为空，或请求被限流/审查拦截时，
     整组回复为空——视为整组未获得有效回复，宁可保留也不静默地假装「判定无需修改」。 */
  if (!text) {
    return { lines: [], tokens: result.tokens, parsed: 0, failed: true };
  }
  const { lines, parsed } = parseRefinedLines(text, sentences.length);
  return { lines, tokens: result.tokens, parsed, failed: false };
}

function buildContextWindow(sentences: string[], startIdx: number, endIdx: number): string {
  const before = sentences.slice(Math.max(0, startIdx - 2), startIdx);
  const after = sentences.slice(endIdx, Math.min(sentences.length, endIdx + 2));
  return [...before.map((s) => `-- 上文 -- ${s}`), ...after.map((s) => `-- 下文 -- ${s}`)].join("\n");
}

/**
 * 修订率下限：一组里实质改写的句子占比低于这个数就补修一轮。
 *
 * 用户交来的文本本就是「判定有AI味、需要修订」的，模型却常常大面积照抄
 * （提示词里任何一句「自然句原样保留」都会被它当成免修许可）。这里用一轮
 * 点名补修把比例拉回来，而不是被动接受「十句九句不改」。
 */
const MIN_REVISE_RATIO = 0.5;

/** 一组最多补修几轮（一轮通常就够，多了只是烧 token）。 */
const MAX_RETRY_ROUNDS = 1;

/** 各类合并结论对应的界面说明。空串 = 正常修订，不需要额外说明。 */
const OUTCOME_NOTE: Record<RefineOutcome, string> = {
  merged: "",
  relaxed: "",
  verbatim: "模型判定本句已足够自然，原样保留",
  "punct-only": "模型只改了标点写法，未触及内容，已按「标点保护」保留原文",
  empty: "模型未返回本句的修订，按原样保留",
  runaway: "模型的改写偏离过大（过度扩写或答非所问），已保留原文",
};

async function startRefine() {
  if (!inputText.value.trim() || !hasApiKey.value) return;

  state.value = "processing";
  progress.value = 0;
  completedGroups.value = 0;
  adjustedCount.value = 0;
  processedSentences.value = [];
  refineStore.usedTokens = 0;
  originalSnapshot = inputText.value;
  cancelled = false;

  const sentences = splitSentences(inputText.value);
  totalGroups.value = Math.ceil(sentences.length / parallelGroups.value);

  currentController = new AbortController();
  const signal = currentController.signal;

  /* 精修为纯提示词驱动，不使用知识项工具，也无须额外的资料准备请求。 */

  /* 收集各组未获得有效回复的情况，结束后统一提示，避免静默地整组保留。 */
  const degradedGroups: string[] = [];
  /* 补修后修订率仍不达标的组，结束后一并如实告知。 */
  const lowYieldGroups: string[] = [];

  for (let group = 0; group < totalGroups.value; group++) {
    const startIdx = group * parallelGroups.value;
    const endIdx = Math.min(startIdx + parallelGroups.value, sentences.length);
    const groupSentences = sentences.slice(startIdx, endIdx);
    const context = buildContextWindow(sentences, startIdx, endIdx);

    /* 整组统一的保留原因（中止 / 空回复 / 请求失败）。为空表示逐句判定。 */
    let groupNote = "";
    /* 每句的合并结论，决定界面上如实显示哪条说明。 */
    let outcomes: RefineOutcome[] = groupSentences.map(() => "empty" as RefineOutcome);
    let merged: string[] = groupSentences.slice();

    if (cancelled || signal.aborted) {
      groupNote = "已停止处理，本句按原样保留";
    } else {
      try {
        const groupResult = await callRefineGroup(groupSentences, context, signal);
        refineStore.usedTokens += groupResult.tokens;
        recordTokens("refine", groupResult.tokens);
        if (groupResult.failed) {
          /* 整组空回复：按原文保留，但要明确标记为「没拿到结果」，不是「无需修改」。 */
          groupNote = "整组未获得有效回复（模型返回为空），按原样保留";
          degradedGroups.push(`第 ${group + 1} 组（空回复）`);
          console.error(`[精修] 第 ${group + 1} 组返回空文本，整组按原文保留。`);
        } else {
          const hit = groupResult.parsed / groupSentences.length;
          if (hit < 0.6) {
            degradedGroups.push(`第 ${group + 1} 组（格式异常，仅解析到 ${groupResult.parsed}/${groupSentences.length} 句）`);
            console.error(
              `[精修] 第 ${group + 1} 组回复格式异常，仅解析到 ${groupResult.parsed}/${groupSentences.length} 句，其余按原文保留。`,
            );
          }
          /* 合并 + 统计本组实质改写比例。 */
          ({ merged, outcomes } = mergeGroup(groupSentences, groupResult.lines));

          /* 修订率不达标 → 点名那些被照抄的句子补修一轮。 */
          for (
            let round = 0;
            round < MAX_RETRY_ROUNDS &&
            !cancelled &&
            !signal.aborted &&
            reviseRatio(outcomes) < MIN_REVISE_RATIO;
            round++
          ) {
            const targets = outcomes
              .map((o, i) => (o === "verbatim" || o === "punct-only" ? i : -1))
              .filter((i) => i >= 0);
            if (targets.length === 0) break;

            const retry = await callRefineGroup(
              groupSentences,
              context,
              signal,
              targets.map((i) => i + 1),
            );
            refineStore.usedTokens += retry.tokens;
            recordTokens("refine", retry.tokens);
            if (retry.failed) break;

            /* 只吸收补修确实改动了的那几句，别让补修把已改好的句子换回照抄。 */
            const retryMerged = mergeGroup(groupSentences, retry.lines);
            let gained = 0;
            for (const i of targets) {
              const o = retryMerged.outcomes[i];
              if (o === "merged" || o === "relaxed") {
                merged[i] = retryMerged.merged[i];
                outcomes[i] = o;
                gained++;
              }
            }
            if (gained === 0) break;
          }

          if (reviseRatio(outcomes) < MIN_REVISE_RATIO) {
            const revised = outcomes.filter((o) => o === "merged" || o === "relaxed").length;
            lowYieldGroups.push(`第 ${group + 1} 组（${revised}/${groupSentences.length} 句）`);
          }
        }
      } catch (error) {
        merged = groupSentences.slice();
        outcomes = groupSentences.map(() => "empty" as RefineOutcome);
        if ((error as Error)?.name === "AbortError") {
          cancelled = true;
          groupNote = "已停止处理，本句按原样保留";
        } else {
          groupNote = "本次请求出错，按原样保留";
          degradedGroups.push(`第 ${group + 1} 组（请求失败）`);
        }
      }
    }

    groupSentences.forEach((sentence, i) => {
      let target = merged[i] ?? sentence;
      let changes = findChanges(sentence, target);
      /* 兜底：算不出任何可展示的改动，就一律以原文为准。
         否则界面显示「已保留」而 finalText 里悄悄换成了改写稿。 */
      if (changes.length === 0 && target !== sentence) {
        target = sentence;
        changes = [];
      }
      /* 如实区分「模型照抄」「只改了标点」「没拿到结果」「改坏了」这几种情况：
         早先它们全被显示成「已按标点保护还原为原文」，用户据此得出「保护机制
         太严」的结论，其实绝大多数是模型自己没改。 */
      const note = groupNote || (changes.length === 0 ? OUTCOME_NOTE[outcomes[i] ?? "empty"] : "");
      processedSentences.value.push({
        original: sentence,
        refined: target,
        changes,
        note: note || undefined,
        relaxed: outcomes[i] === "relaxed" || undefined,
      });
      if (changes.length > 0) adjustedCount.value++;
    });

    completedGroups.value = group + 1;
    progress.value = Math.round((completedGroups.value / totalGroups.value) * 100);
  }

  if (degradedGroups.length > 0) {
    showToast(
      "部分句子未获得修订",
      `共 ${degradedGroups.length} 组未获得有效回复：${degradedGroups.join("、")}。这些句子已按原文保留，可在句子卡片上查看原因。`,
      "edit",
    );
  } else if (lowYieldGroups.length > 0) {
    showToast(
      "部分分组修订率偏低",
      `${lowYieldGroups.join("、")} 补修后实质改写仍不到一半 —— 通常说明这几段原文本就比较口语化，也可换个模型再跑一遍。`,
      "edit",
    );
  }

  state.value = "completed";
  currentController = null;
  saveHistoryVersion();
}

/** 一组里「实质改写」的占比（甲档合并 + 乙档降级都算改到了）。 */
function reviseRatio(outcomes: RefineOutcome[]): number {
  if (outcomes.length === 0) return 1;
  const revised = outcomes.filter((o) => o === "merged" || o === "relaxed").length;
  return revised / outcomes.length;
}

/** 把一组模型回复逐句合并，同时留下每句的合并结论。 */
function mergeGroup(
  sentences: string[],
  lines: string[],
): { merged: string[]; outcomes: RefineOutcome[] } {
  const merged: string[] = [];
  const outcomes: RefineOutcome[] = [];
  sentences.forEach((sentence, i) => {
    const result = mergeRefined(sentence, lines[i] ?? "");
    merged.push(result.text);
    outcomes.push(result.outcome);
  });
  return { merged, outcomes };
}

/* ---- phrase-level diff ---- */

type DiffSpan = { text: string; type: "same" | "del" | "ins" };

function findChanges(original: string, refined: string): string[] {
  if (original === refined) return [];

  /* For very long strings (rare in practice, but possible if a "sentence"
   * swallows a whole paragraph with no punctuation) fall back to a cheap
   * prefix/suffix trim diff to avoid an O(n*m) LCS table. */
  if (original.length * refined.length > 2_000_000) {
    return coarseDiff(original, refined);
  }

  /* Character-level LCS diff between the original and the refined sentence. */
  const o = Array.from(original);
  const r = Array.from(refined);
  const n = o.length;
  const m = r.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = o[i] === r[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const spans: DiffSpan[] = [];
  const append = (type: DiffSpan["type"], char: string) => {
    const last = spans[spans.length - 1];
    if (last && last.type === type) last.text += char;
    else spans.push({ type, text: char });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (o[i] === r[j]) {
      append("same", o[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      append("del", o[i]);
      i++;
    } else {
      append("ins", r[j]);
      j++;
    }
  }
  while (i < n) {
    append("del", o[i]);
    i++;
  }
  while (j < m) {
    append("ins", r[j]);
    j++;
  }

  /* Coalesce deletions/insertions into human-readable change descriptions:
   * replacement, deletion, or insertion. */
  const clean = (text: string) => text.replace(/^[\s，,；;：:]+|[\s，,；;：:]+$/g, "");

  const changes: string[] = [];
  let pendingDel = "";
  for (const span of spans) {
    if (span.type === "same") {
      if (pendingDel) changes.push(`删除「${clean(pendingDel)}」`);
      pendingDel = "";
      continue;
    }
    if (span.type === "del") {
      pendingDel += span.text;
      continue;
    }
    const inserted = clean(span.text);
    if (pendingDel) {
      const removed = clean(pendingDel);
      if (inserted) {
        changes.push(`将「${removed}」改为「${inserted}」`);
      } else if (removed) {
        changes.push(`删除「${removed}」`);
      }
    } else if (inserted) {
      changes.push(`新增「${inserted}」`);
    }
    pendingDel = "";
  }
  if (pendingDel) {
    const removed = clean(pendingDel);
    if (removed) changes.push(`删除「${removed}」`);
  }

  return changes;
}

function coarseDiff(original: string, refined: string): string[] {
  const o = Array.from(original);
  const r = Array.from(refined);
  let p = 0;
  while (p < o.length && p < r.length && o[p] === r[p]) p++;
  let s = 0;
  while (s < o.length - p && s < r.length - p && o[o.length - 1 - s] === r[r.length - 1 - s]) s++;

  const removed = o.slice(p, o.length - s).join("");
  const inserted = r.slice(p, r.length - s).join("");
  const changes: string[] = [];
  if (removed && inserted) changes.push(`将「${removed}」改为「${inserted}」`);
  else if (removed) changes.push(`删除「${removed}」`);
  else if (inserted) changes.push(`新增「${inserted}」`);
  return changes;
}

function stopProcessing() {
  cancelled = true;
  if (currentController) currentController.abort();
}

function goBack() {
  cancelled = true;
  if (currentController) currentController.abort();
  state.value = "input";
  processedSentences.value = [];
  progress.value = 0;
  completedGroups.value = 0;
  adjustedCount.value = 0;
}

function copyFinalText() {
  const text = finalText.value.trim();
  if (!text) return;
  navigator.clipboard.writeText(text);
}

function downloadMarkdown() {
  const text = finalText.value.trim();
  if (!text) return;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `精修文稿_${formatNow().replace(/[: ]/g, "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function saveHistoryVersion() {
  const text = finalText.value.trim();
  if (!text) return;
  const total = refineStore.historyVersions.length + 1;
  refineStore.historyVersions.unshift({
    id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
    time: formatNow(),
    title: `历史版本 ${total}`,
    original: originalSnapshot,
    content: text,
    chars: text.length,
    adjusted: adjustedCount.value,
    tokens: refineStore.usedTokens,
  });

  /* 洞察的「修改记忆」由 refreshInsights 从精修历史版本中重建（importRefineHistory），
     只收录最终采纳/保留的修订；被拒绝的句子（accepted=false）会从全部历史内容中
     移除，因此不会被重复统计。 */
  refreshInsights(true);
}

function deleteHistoryVersion(id: string) {
  const idx = refineStore.historyVersions.findIndex((v) => v.id === id);
  if (idx !== -1) refineStore.historyVersions.splice(idx, 1);
}

function openCompare(version: HistoryVersion) {
  compareVersion.value = version;
}

function closeCompare() {
  compareVersion.value = null;
}

const leftPanelRef = ref<HTMLDivElement | null>(null);
const rightPanelRef = ref<HTMLDivElement | null>(null);
let syncScrollLock = false;

function onLeftScroll() {
  if (syncScrollLock) return;
  syncScrollLock = true;
  const left = leftPanelRef.value;
  const right = rightPanelRef.value;
  if (left && right && left.scrollHeight > left.clientHeight) {
    const ratio = left.scrollTop / (left.scrollHeight - left.clientHeight);
    right.scrollTop = ratio * (right.scrollHeight - right.clientHeight);
  }
  requestAnimationFrame(() => {
    syncScrollLock = false;
  });
}

function onRightScroll() {
  if (syncScrollLock) return;
  syncScrollLock = true;
  const left = leftPanelRef.value;
  const right = rightPanelRef.value;
  if (left && right && right.scrollHeight > right.clientHeight) {
    const ratio = right.scrollTop / (right.scrollHeight - right.clientHeight);
    left.scrollTop = ratio * (left.scrollHeight - left.clientHeight);
  }
  requestAnimationFrame(() => {
    syncScrollLock = false;
  });
}

interface DiffToken {
  text: string;
  type: "same" | "added" | "removed";
}

function splitSentenceUnits(text: string): string[] {
  if (!text) return [];
  const units = text.split(/(?<=[。！？.!?\n])/g).filter(Boolean);
  return units.length > 0 ? units : [text];
}

function diffSentencePair(s1: string, s2: string): { left: DiffToken[]; right: DiffToken[] } {
  const c1 = Array.from(s1);
  const c2 = Array.from(s2);
  const n = c1.length;
  const m = c2.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = c1[i] === c2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const left: DiffToken[] = [];
  const right: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (c1[i] === c2[j]) {
      left.push({ text: c1[i], type: "same" });
      right.push({ text: c2[j], type: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: c1[i], type: "removed" });
      i++;
    } else {
      right.push({ text: c2[j], type: "added" });
      j++;
    }
  }

  while (i < n) {
    left.push({ text: c1[i], type: "removed" });
    i++;
  }
  while (j < m) {
    right.push({ text: c2[j], type: "added" });
    j++;
  }

  return { left, right };
}

function mergeDiffTokens(tokens: DiffToken[]): DiffToken[] {
  const merged: DiffToken[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    if (merged.length > 0 && merged[merged.length - 1].type === t.type) {
      merged[merged.length - 1].text += t.text;
    } else {
      merged.push({ ...t });
    }
  }
  return merged;
}

function sentenceSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const c1 = Array.from(s1);
  const c2 = Array.from(s2);
  let common = 0;
  const set2 = new Map<string, number>();
  for (const char of c2) set2.set(char, (set2.get(char) || 0) + 1);
  for (const char of c1) {
    const count = set2.get(char);
    if (count && count > 0) {
      common++;
      set2.set(char, count - 1);
    }
  }
  return (2 * common) / (c1.length + c2.length);
}

function diffTexts(oldText: string | undefined, newText: string | undefined): { left: DiffToken[]; right: DiffToken[] } {
  const oldStr = oldText ?? "";
  const newStr = newText ?? "";

  if (!oldStr && !newStr) return { left: [], right: [] };
  if (!oldStr) return { left: [], right: [{ text: newStr, type: "added" }] };
  if (!newStr) return { left: [{ text: oldStr, type: "removed" }], right: [] };

  const u1 = splitSentenceUnits(oldStr);
  const u2 = splitSentenceUnits(newStr);
  const n = u1.length;
  const m = u2.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = u1[i] === u2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const leftRaw: DiffToken[] = [];
  const rightRaw: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (u1[i] === u2[j]) {
      leftRaw.push({ text: u1[i], type: "same" });
      rightRaw.push({ text: u2[j], type: "same" });
      i++;
      j++;
    } else {
      const isPair =
        j < m &&
        sentenceSimilarity(u1[i], u2[j]) >= 0.22 &&
        (dp[i + 1][j + 1] === dp[i + 1][j] || dp[i + 1][j + 1] === dp[i][j + 1] || dp[i][j] === dp[i + 1][j + 1]);

      if (isPair) {
        const pair = diffSentencePair(u1[i], u2[j]);
        leftRaw.push(...pair.left);
        rightRaw.push(...pair.right);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        leftRaw.push({ text: u1[i], type: "removed" });
        i++;
      } else {
        rightRaw.push({ text: u2[j], type: "added" });
        j++;
      }
    }
  }

  while (i < n) {
    leftRaw.push({ text: u1[i], type: "removed" });
    i++;
  }
  while (j < m) {
    rightRaw.push({ text: u2[j], type: "added" });
    j++;
  }

  return { left: mergeDiffTokens(leftRaw), right: mergeDiffTokens(rightRaw) };
}

function versionCharCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

function decreaseGroups() {
  if (parallelGroups.value > 1) parallelGroups.value--;
}

function increaseGroups() {
  if (parallelGroups.value < 20) parallelGroups.value++;
}

function switchToRevised() {
  if (processedSentences.value.length > 0) {
    state.value = "completed";
  }
}
</script>

<template>
  <div class="refine-view">
    <aside class="refine-sidebar">
      <div class="sidebar-section">
        <div class="section-title">处理流程</div>
        <div class="flow-steps">
          <button
            class="flow-step"
            :class="{ active: state === 'input', completed: state !== 'input', clickable: true }"
            title="切换到输入原文"
            @click="state = 'input'"
          >
            <div class="step-number">
              <Check v-if="state !== 'input'" :size="14" :stroke-width="2" />
              <span v-else>01</span>
            </div>
            <div class="step-content">
              <div class="step-title">输入原文</div>
              <div class="step-desc">准备待处理文本</div>
            </div>
          </button>
          <button
            class="flow-step"
            :class="{ active: state === 'processing' || state === 'completed', clickable: true }"
            title="切换到全文修订结果"
            @click="switchToRevised"
          >
            <div class="step-number">02</div>
            <div class="step-content">
              <div class="step-title">全文修订</div>
              <div class="step-desc">逐句去AI味 · 至少改一半</div>
            </div>
          </button>
        </div>
      </div>
    </aside>

    <main class="refine-main">
      <!-- 输入原文状态 -->
      <template v-if="state === 'input'">
        <div class="main-header">
          <div class="header-left">
            <div class="header-label">原始文本</div>
            <p class="header-desc">粘贴需要处理的文章，智能体会逐句去 AI 味：默认动手改，每组至少修订一半，照抄过多时自动补修一轮。</p>
          </div>
          <div class="header-actions">
            <button class="history-btn" @click="historyOpen = true">
              <History :size="14" :stroke-width="1.8" />
              历史版本记录
              <span v-if="historyVersions.length > 0" class="history-count-badge">{{ historyVersions.length }}</span>
            </button>
          </div>
        </div>

        <div class="text-input-area">
          <textarea
            v-model="inputText"
            v-auto-pair
            class="text-textarea"
            placeholder="在这里粘贴或输入文本......"
            rows="16"
          ></textarea>
          <div class="text-footer">
            <span class="text-stats">{{ charCount }} 字  {{ sentenceCount }} 句</span>
            <span class="text-limit">最大 100,000 字</span>
          </div>
        </div>

        <div v-if="!hasApiKey" class="api-warning">
          当前匿名会话尚未配置 API Key，请先完成模型设置。
        </div>

        <div class="bottom-bar">
          <div class="bottom-left">默认动手改 · 每组至少修订一半 · 照抄过多自动补修 · 标点按原文</div>
          <div class="bottom-right">
            <div class="model-pill refine-model-picker" :class="{ open: modelPickerOpen }">
              <button
                class="model-pill-btn"
                :title="`当前模型: ${refineModelLabel}`"
                @click.stop="modelPickerOpen = !modelPickerOpen"
              >
                <BrainCircuit :size="14" class="brain" />
                <span class="model-pill-value">{{ aiSettings.model || "选择模型" }}</span>
                <ChevronDown :size="14" class="model-chevron" />
              </button>
              <div v-if="modelPickerOpen" class="refine-model-dropdown" @click.stop>
                <div class="popover-title">选择 AI 模型</div>
                <input
                  v-model="refineModelFilter"
                  class="model-filter-input"
                  placeholder="筛选模型…"
                  @click.stop
                />
                <div class="model-options">
                  <div v-if="visibleRefineGroups.length === 0" class="model-empty">
                    没有匹配的模型
                  </div>
                  <div v-for="group in visibleRefineGroups" :key="group.id" class="model-group">
                    <button class="model-group-head" @click.stop="toggleRefineGroup(group)">
                      <ChevronDown v-if="isRefineGroupOpen(group)" :size="12" :stroke-width="2.2" />
                      <ChevronRight v-else :size="12" :stroke-width="2.2" />
                      <span class="model-group-name" :title="group.label">{{ group.label }}</span>
                      <span v-if="group.isActive" class="model-group-dot" title="当前使用的接口"></span>
                      <span class="model-group-count">{{ filteredRefineModels(group).length }}</span>
                    </button>
                    <div v-if="isRefineGroupOpen(group)" class="model-group-body">
                      <div
                        v-for="model in filteredRefineModels(group)"
                        :key="group.id + model"
                        class="popover-option model-option"
                        :class="{ selected: group.isActive && aiSettings.model === model }"
                        :title="model"
                        @click="selectRefineModel(group, model)"
                      >
                        <span class="model-option-name">{{ model }}</span>
                        <Check v-if="group.isActive && aiSettings.model === model" :size="12" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button class="start-btn" :disabled="!inputText.trim() || !hasApiKey" @click="startRefine">
              <Play :size="16" :stroke-width="2" />
              开始全文修订
            </button>
          </div>
        </div>
      </template>

      <!-- 修订中/完成状态 -->
      <template v-else>
        <div class="processing-header">
          <div class="header-left">
            <div class="header-label">全文修订</div>
            <h1 class="header-title">逐句去 AI 味 · 定向精修</h1>
            <p class="header-desc" v-if="state === 'processing'">
              已完成 {{ completedGroups }}/{{ totalGroups }} 组，逐组处理中；照抄过多的组会自动补修一轮。
            </p>
            <p class="header-desc" v-else>
              处理完成，共修订 {{ adjustedCount }}/{{ processedSentences.length }} 句（{{ reviseRateLabel }}），其中 {{ decisionStats.accepted }} 处已接受、{{ decisionStats.rejected }} 处已拒绝。
            </p>
          </div>
          <div class="header-actions">
            <button class="action-btn action-history" title="历史版本记录" @click="historyOpen = true">
              <History :size="18" :stroke-width="1.7" />
              <span v-if="historyVersions.length > 0" class="history-count-badge">{{ historyVersions.length }}</span>
            </button>
            <button
              v-if="state === 'completed'"
              class="action-btn action-accept-all"
              title="一键接受全部修改：所有修订按原本意见执行，修订内容进入原文"
              @click="acceptAll"
            >
              <CheckCheck :size="18" :stroke-width="1.7" />
            </button>
            <button class="action-btn" title="复制修改后正文" @click="copyFinalText">
              <Copy :size="18" :stroke-width="1.7" />
            </button>
            <button class="action-btn" title="下载为 Markdown" @click="downloadMarkdown">
              <Download :size="18" :stroke-width="1.7" />
            </button>
          </div>
        </div>

        <div class="progress-card">
          <div class="progress-header">
            <span class="progress-title">{{ state === 'processing' ? '判定精修中' : '修订完成' }}</span>
            <span class="progress-percent">{{ progress }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="progress-footer">
            <span>{{ completedGroups }}/{{ totalGroups }} 组完成</span>
            <span>{{ adjustedCount }} 句有调整</span>
          </div>
        </div>

        <div class="sentences-list">
          <div v-for="(item, index) in processedSentences" :key="index" class="sentence-card">
            <div class="card-header">
              <span class="sentence-number">句子 {{ String(index + 1).padStart(2, '0') }}</span>
              <span
                class="status-badge"
                :class="{
                  kept: item.changes.length === 0,
                  accepted: decisionOf(item) === 'accepted',
                  rejected: decisionOf(item) === 'rejected',
                }"
              >
                <template v-if="item.changes.length === 0">
                  <Check :size="12" :stroke-width="2" />
                  已保留
                </template>
                <template v-else-if="decisionOf(item) === 'rejected'">
                  <X :size="12" :stroke-width="2" />
                  已拒绝
                </template>
                <template v-else-if="decisionOf(item) === 'accepted'">
                  <Check :size="12" :stroke-width="2" />
                  已接受
                </template>
                <template v-else>
                  <PencilLine :size="12" :stroke-width="2" />
                  已精修
                </template>
              </span>
            </div>
            <div class="card-content">
              <div class="text-column">
                <div class="column-label">原文</div>
                <div class="column-text">{{ item.original }}</div>
              </div>
              <div class="text-column">
                <div class="column-label">修订</div>
                <div class="column-text">{{ item.refined }}</div>
              </div>
            </div>
            <div v-if="item.changes.length > 0" class="card-changes">
              <div class="change-tags">
                <span
                  v-for="(change, ci) in item.changes"
                  :key="ci"
                  class="change-tag"
                  :class="changeTagType(change)"
                >{{ change }}</span>
                <span
                  v-if="item.relaxed"
                  class="change-tag relaxed"
                  title="模型调整了本句的断句：已采纳它的内容与断句，标点写法按原文归一、句末标点与原文一致"
                >断句已调整 · 标点按原文归一</span>
              </div>
              <div class="decision-actions">
                <button
                  class="decision-btn accept"
                  :class="{ active: decisionOf(item) === 'accepted' }"
                  :title="decisionOf(item) === 'accepted' ? '已接受 · 点击恢复待定' : '接受此修改：修订内容进入原文'"
                  @click.stop="toggleAccept(item)"
                >
                  <Check :size="12" :stroke-width="2.2" />
                </button>
                <button
                  class="decision-btn reject"
                  :class="{ active: decisionOf(item) === 'rejected' }"
                  :title="decisionOf(item) === 'rejected' ? '已拒绝 · 点击恢复待定' : '拒绝此修改：原文不动'"
                  @click.stop="toggleReject(item)"
                >
                  <X :size="12" :stroke-width="2.2" />
                </button>
              </div>
            </div>
            <div v-else class="card-changes kept">
              <span class="change-tag kept" v-if="!item.note">原文已符合自然表达，未作改动</span>
              <span class="change-tag kept note" v-else :title="item.note">{{ item.note }}</span>
            </div>
          </div>
        </div>

        <div class="processing-footer">
          <button class="secondary-btn" @click="goBack">
            <ArrowLeft :size="16" :stroke-width="1.7" />
            返回原文
          </button>
          <button v-if="state === 'processing'" class="stop-btn" @click="stopProcessing">
            <Square :size="14" :stroke-width="2" />
            停止处理
          </button>
          <button v-else class="copy-btn" @click="copyFinalText">
            <Copy :size="16" :stroke-width="1.7" />
            复制最终文本
          </button>
        </div>
      </template>
    </main>

    <aside class="refine-stats">
      <div class="stats-section">
        <div class="stats-title">本次处理</div>
        <div class="stats-row">
          <span class="stats-label">原文字数</span>
          <span class="stats-value">{{ charCount }}</span>
        </div>
        <div class="stats-row">
          <span class="stats-label">识别句子</span>
          <span class="stats-value">{{ sentenceCount }}</span>
        </div>
        <div class="stats-row">
          <span class="stats-label">已调整</span>
          <span class="stats-value">{{ adjustedCount }}</span>
        </div>
      </div>

      <div class="stats-divider"></div>

      <div class="stats-section">
        <div class="stats-title">修订尺度</div>
        <ul class="scale-list">
          <li>默认动手改，每组至少改一半</li>
          <li>照抄过多时自动补修一轮</li>
          <li>优先改字词语序，其次动句式</li>
          <li>禁止扩写，控制目标句字数</li>
          <li>标点写法与句末标点按原文</li>
        </ul>
      </div>

      <div class="stats-divider"></div>

      <div class="stats-section">
        <div class="stats-title">修订率</div>
        <div class="stats-row">
          <span class="stats-label">实质改写</span>
          <span class="stats-value">{{ reviseRateLabel }}</span>
        </div>
        <div class="stats-row">
          <span class="stats-label">原样保留</span>
          <span class="stats-value">{{ processedSentences.length - adjustedCount }}</span>
        </div>
      </div>

      <div class="stats-divider"></div>

      <div class="stats-section final-text-section">
        <div class="stats-title">最终文本</div>
        <div class="final-text-stats">
          <span class="final-stat">字数 <strong>{{ finalCharCount }}</strong></span>
          <span class="final-stat">消耗 Tokens <strong>{{ usedTokensFormatted() }}</strong></span>
        </div>
        <div class="final-text-preview">{{ finalText || '处理完成后显示最终文本...' }}</div>
      </div>

      <div class="stats-footer">
        <div class="group-control">
          <div class="group-info">
            <div class="group-title">并行分组数</div>
            <div class="group-desc">全文均匀分组，每句前后各附带 2 句上下文</div>
          </div>
          <div class="group-stepper">
            <button class="stepper-btn" @click="decreaseGroups">-</button>
            <span class="stepper-value">{{ parallelGroups }}</span>
            <button class="stepper-btn" @click="increaseGroups">+</button>
          </div>
        </div>
      </div>
    </aside>

    <Teleport to="body">
      <div v-if="historyOpen" class="history-overlay" @click.self="historyOpen = false">
        <aside class="history-drawer">
          <div class="history-header">
            <div class="history-header-title">
              <Clock :size="16" :stroke-width="1.8" />
              历史版本记录
            </div>
            <button class="close-btn" title="关闭" @click="historyOpen = false">
              <X :size="18" :stroke-width="1.8" />
            </button>
          </div>

          <div class="history-body">
            <div v-if="historyVersions.length === 0" class="history-empty">
              暂无历史版本，完成一次全文修订后会自动记录。
            </div>

            <div v-for="version in historyVersions" :key="version.id" class="history-card">
              <div class="history-card-header">
                <div class="history-card-title">
                  <History :size="13" :stroke-width="1.8" />
                  {{ version.title }}
                </div>
                <div class="history-card-actions">
                  <button class="compare-btn" @click="openCompare(version)">
                    对比
                  </button>
                  <button
                    class="history-delete-btn"
                    title="删除该版本"
                    @click="deleteHistoryVersion(version.id)"
                  >
                    <Trash2 :size="13" :stroke-width="1.8" />
                  </button>
                </div>
              </div>
              <div class="history-card-meta">{{ version.time }} · {{ version.chars }} 字 · 调整 {{ version.adjusted ?? 0 }} 句 · {{ version.tokens ?? 0 }} Tokens</div>
              <div class="history-card-content">{{ version.content }}</div>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="compareVersion" class="compare-overlay" @click.self="closeCompare">
        <div class="compare-modal">
          <div class="compare-header">
            <div class="compare-header-title">
              <History :size="16" :stroke-width="1.8" />
              版本对比 · {{ compareVersion.title }}
            </div>
            <button class="close-btn" title="关闭" @click="closeCompare">
              <X :size="18" :stroke-width="1.8" />
            </button>
          </div>

          <div class="compare-panels">
            <div class="compare-panel">
              <div class="compare-panel-header">
                <span class="compare-panel-label">原文</span>
                <span class="compare-panel-count">{{ versionCharCount(compareVersion.original) }} 字</span>
              </div>
              <div ref="leftPanelRef" class="compare-panel-body original" @scroll="onLeftScroll">
                <template v-for="(token, i) in compareDiff?.left ?? []" :key="i">
                  <span
                    v-if="token.type === 'removed'"
                    class="diff-removed"
                  >{{ token.text }}</span>
                  <template v-else>{{ token.text }}</template>
                </template>
              </div>
            </div>

            <div class="compare-panel">
              <div class="compare-panel-header">
                <span class="compare-panel-label">修改后</span>
                <span class="compare-panel-count">{{ versionCharCount(compareVersion.content) }} 字</span>
              </div>
              <div ref="rightPanelRef" class="compare-panel-body revised" @scroll="onRightScroll">
                <template v-for="(token, i) in compareDiff?.right ?? []" :key="i">
                  <span
                    v-if="token.type === 'added'"
                    class="diff-added"
                  >{{ token.text }}</span>
                  <template v-else>{{ token.text }}</template>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.refine-view {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  background: var(--surface-container-lowest);
}

.refine-sidebar {
  width: 230px;
  flex-shrink: 0;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  border-right: 1px solid var(--outline-variant);
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.flow-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  border: none;
  background: transparent;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s ease;
}

.flow-step.clickable:hover {
  background: var(--surface-container-low);
}

.flow-step.active {
  background: var(--surface-container-low);
}

.step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  flex-shrink: 0;
}

.flow-step.active .step-number,
.flow-step.completed .step-number {
  background: var(--primary);
  color: #fff;
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
}

.step-desc {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.refine-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  overflow-y: auto;
}

.main-header,
.processing-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.header-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
}

.header-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--on-surface);
}

.header-desc {
  margin: 0;
  font-size: 13px;
  color: var(--on-surface-variant);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease;
}

.action-btn:hover {
  background: var(--surface-container-high);
}

.action-history {
  position: relative;
}

.history-count-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

.text-input-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-bright);
  min-height: 400px;
}

.text-textarea {
  flex: 1;
  width: 100%;
  padding: 16px;
  border: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.text-textarea::placeholder {
  color: var(--on-surface-variant);
}

.text-footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--outline-variant);
  background: var(--surface-container-lowest);
}

.text-stats,
.text-limit {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.api-warning {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--error-container);
  color: var(--error);
  border-radius: 6px;
  font-size: 13px;
}

.bottom-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}

.bottom-left {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.bottom-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  transition: background 0.2s ease;
}

/* 模型选择器：与写作界面右侧面板底部的模型下拉同一套交互（按钮 + 分组下拉） */
.refine-model-picker {
  position: relative;
}

.refine-model-picker .model-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: inherit;
  background: transparent;
  color: var(--on-surface-variant);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  cursor: pointer;
  max-width: 220px;
}

.model-pill:hover {
  background: var(--surface-container-high);
}

.model-pill.open {
  border-color: var(--primary);
}

.model-pill .brain {
  flex-shrink: 0;
  color: var(--primary);
}

.model-pill-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chevron {
  flex-shrink: 0;
  pointer-events: none;
  color: var(--on-surface-variant);
}

.refine-model-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 236px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2, 0 6px 16px rgba(0, 0, 0, 0.15));
  padding: 6px;
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popover-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  padding: 4px 6px;
  border-bottom: 1px solid var(--outline-variant);
  margin-bottom: 2px;
}

.model-filter-input {
  width: 100%;
  padding: 5px 7px;
  margin-bottom: 2px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.model-filter-input:focus {
  border-color: var(--primary);
}

.model-options {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 280px;
  overflow-y: auto;
}

.model-empty {
  padding: 10px 8px;
  font-size: 12px;
  text-align: center;
  color: var(--on-surface-variant);
}

.model-group + .model-group {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--outline-variant);
}

.model-group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.model-group-head:hover {
  background: var(--surface-container-high);
}

.model-group-head svg {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.model-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-group-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
}

.model-group-count {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 10px;
  font-weight: 500;
}

.model-group-body {
  padding-left: 12px;
}

.model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease;
}

.model-option:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.model-option.selected {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 600;
}

.model-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 句子卡片的保留原因（区别于「AI 判定无需修改」） */
.change-tag.kept.note {
  border-style: dashed;
  color: inherit;
}

.start-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.start-btn:hover:not(:disabled) {
  background: var(--primary-container);
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-card {
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  padding: 16px;
  background: var(--surface-bright);
  margin-bottom: 20px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface);
}

.progress-percent {
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface);
}

.progress-bar {
  height: 6px;
  background: var(--surface-container);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: var(--on-surface-variant);
}

.sentences-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.sentence-card {
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-bright);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--outline-variant);
  background: var(--surface-container-lowest);
}

.sentence-number {
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--primary);
}

.status-badge.kept {
  color: var(--on-surface-variant);
}

.status-badge.accepted {
  color: #15803d;
}

.status-badge.rejected {
  color: #b91c1c;
}

.card-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--outline-variant);
}

.text-column {
  padding: 12px 14px;
  background: var(--surface-bright);
}

.column-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-bottom: 6px;
}

.column-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--on-surface);
}

.card-changes {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-top: 1px solid var(--outline-variant);
  background: var(--surface-container-lowest);
}

.change-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.decision-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.decision-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.decision-btn:active {
  transform: scale(0.92);
}

.decision-btn.accept:hover {
  background: rgb(22 163 74 / 0.12);
  border-color: #15803d;
  color: #15803d;
}

.decision-btn.accept.active {
  background: #15803d;
  border-color: #15803d;
  color: #fff;
}

.decision-btn.reject:hover {
  background: rgb(186 26 26 / 0.12);
  border-color: #b91c1c;
  color: #b91c1c;
}

.decision-btn.reject.active {
  background: #b91c1c;
  border-color: #b91c1c;
  color: #fff;
}

.change-tag {
  display: inline-block;
  padding: 2px 8px;
  background: var(--surface-container);
  border-radius: 4px;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.card-changes.kept {
  justify-content: flex-start;
}

.change-tag.kept {
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
}

.change-tag.del {
  background: rgb(186 26 26 / 0.12);
  color: #b91c1c;
}

.change-tag.add {
  background: rgb(22 163 74 / 0.14);
  color: #15803d;
}

.change-tag.rep {
  background: rgb(234 88 12 / 0.14);
  color: #c2410c;
}

/* 降级采纳（模型重排了断句）的告知标签，与增删改标签区分开。 */
.change-tag.relaxed {
  background: var(--surface-container-low);
  border: 1px dashed var(--outline);
  color: var(--on-surface-variant);
}

.processing-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--outline-variant);
}

.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.secondary-btn:hover {
  background: var(--surface-container-high);
}

.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--error);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--error);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.stop-btn:hover {
  background: var(--error-container);
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.copy-btn:hover {
  background: var(--primary-container);
}

.refine-stats {
  width: 230px;
  flex-shrink: 0;
  padding: 20px 16px;
  border-left: 1px solid var(--outline-variant);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.stats-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.final-text-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.final-text-section .final-text-preview {
  flex: 1;
  min-height: 80px;
}

.stats-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--outline-variant);
}

.stats-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stats-label {
  font-size: 13px;
  color: var(--on-surface-variant);
}

.stats-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
}

.stats-divider {
  height: 1px;
  background: var(--outline-variant);
}

.scale-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scale-list li {
  font-size: 13px;
  color: var(--on-surface-variant);
  padding-left: 12px;
  position: relative;
}

.scale-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--on-surface-variant);
}

.final-text-preview {
  font-size: 12px;
  line-height: 1.6;
  color: var(--on-surface-variant);
  overflow-y: auto;
}

.final-text-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--on-surface-variant);
}

.final-stat strong {
  font-weight: 600;
  color: var(--primary);
  margin-left: 2px;
}

.group-control {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.group-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.group-desc {
  font-size: 11px;
  color: var(--on-surface-variant);
  line-height: 1.4;
}

.group-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.stepper-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
}

.stepper-btn:hover {
  background: var(--surface-container-high);
}

.stepper-value {
  width: 32px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  padding: 4px 0;
}

.history-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.history-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.history-btn .history-count-badge {
  position: static;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}

.history-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgb(0 0 0 / 0.2);
}

.history-drawer {
  position: absolute;
  top: 0;
  right: 0;
  width: 360px;
  max-width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border-left: 1px solid var(--outline-variant);
  box-shadow: -12px 0 32px -8px rgb(0 0 0 / 0.2);
}

.history-header {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.history-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--on-surface);
}

.history-header-title svg {
  color: var(--primary);
}

.history-drawer .close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease;
}

.history-drawer .close-btn:hover {
  background: var(--surface-container-high);
}

.history-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 13px;
  line-height: 1.6;
}

.history-card {
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container-lowest);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.history-card:hover {
  border-color: var(--primary);
}

.history-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 4px;
}

.history-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.history-card-title svg {
  color: var(--primary);
}

.history-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.history-delete-btn:hover {
  background: var(--error-container);
  color: var(--error);
}

.history-card-meta {
  padding: 0 12px 8px;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.history-card-content {
  padding: 0 12px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.history-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.compare-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.compare-btn:hover {
  background: var(--primary);
  color: #fff;
}

.compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 1800;
  background: rgb(0 0 0 / 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.compare-modal {
  width: 900px;
  max-width: 100%;
  height: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 24px 60px -12px rgb(0 0 0 / 0.35);
  overflow: hidden;
}

.compare-header {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.compare-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--on-surface);
}

.compare-header-title svg {
  color: var(--primary);
}

.compare-modal .close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease;
}

.compare-modal .close-btn:hover {
  background: var(--surface-container-high);
}

.compare-panels {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--outline-variant);
}

.compare-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--surface-container-lowest);
}

.compare-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
}

.compare-panel-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.compare-panel-count {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.compare-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: scroll;
  padding: 16px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--on-surface);
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
  scrollbar-color: var(--primary, #43588c) transparent;
}

.compare-panel-body::-webkit-scrollbar {
  width: 8px;
}

.compare-panel-body::-webkit-scrollbar-track {
  background: var(--surface-container-low, #f1f5f9);
}

.compare-panel-body::-webkit-scrollbar-thumb {
  background: var(--primary-container, #5b74b1);
  border-radius: 4px;
}

.compare-panel-body::-webkit-scrollbar-thumb:hover {
  background: var(--primary, #43588c);
}

.compare-panel-body::-webkit-scrollbar {
  width: 6px;
}

.compare-panel-body::-webkit-scrollbar-track {
  background: transparent;
}

.compare-panel-body::-webkit-scrollbar-thumb {
  background: var(--outline-variant);
  border-radius: 3px;
}

.compare-panel-body::-webkit-scrollbar-thumb:hover {
  background: var(--on-surface-variant);
}

.diff-removed {
  background: rgb(186 26 26 / 0.14);
  color: #b91c1c;
  text-decoration: line-through;
  border-radius: 3px;
  padding: 0 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.diff-added {
  background: rgb(22 163 74 / 0.16);
  color: #15803d;
  border-radius: 3px;
  padding: 0 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>
