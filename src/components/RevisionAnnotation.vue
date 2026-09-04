<script setup lang="ts">
/**
 * 「修订与批注」录入表单。
 *
 * 选中正文里的一段文字后，从右键菜单或 Ctrl+Shift+M 呼出：表单左侧照抄原文，
 * 右侧写修订内容与批注。保存后不动正文，只在 revisionStore 里落一条图层，由
 * 左侧文档面板作为二级目录呈现。
 *
 * 双击左侧面板里已有的图层条目会走同一个表单的「编辑」模式：原文固定不动，
 * 只改修订内容与批注。
 *
 *   <RevisionAnnotation ref="revisionFormRef" :target="editorRef" :file-id="fileId" />
 *   revisionFormRef.value?.open()   // 右键菜单调用
 *
 * 与既有编辑器逻辑完全解耦：本组件只读 textarea 的选区，不写正文。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Layers, X } from "lucide-vue-next";
import {
  clearRevisionEdit,
  createRevision,
  revisionStore,
  updateRevision,
} from "../revisionStore";
import { showToast } from "../insightStore";

const props = withDefaults(
  defineProps<{
    /** 被读取选区的文本域。父级 v-if 切换时可为 null，本组件自动解绑。 */
    target: HTMLTextAreaElement | null;
    /** 当前文档条目 id；缺失时不允许建图层（图层必须挂在某篇文档下）。 */
    fileId: string | null;
    /** 关掉快捷键（例如嵌入式小编辑框里不需要）。 */
    enabled?: boolean;
  }>(),
  { enabled: true },
);

const emit = defineEmits<{
  (e: "opened"): void;
  (e: "closed"): void;
  (e: "created", id: string): void;
}>();

const open = ref(false);
/** 非空表示正在编辑已有图层，空串表示新建。 */
const editingId = ref("");
const original = ref("");
const anchor = ref(0);
const revised = ref("");
const comment = ref("");
const revisedRef = ref<HTMLTextAreaElement | null>(null);

let boundTarget: HTMLTextAreaElement | null = null;

const canSave = computed(() => revised.value.trim().length > 0 || comment.value.trim().length > 0);

const originalPreview = computed(() => original.value);

/** 只有真的改了字才算修订，其余情况按纯批注处理。 */
const kindLabel = computed(() => {
  const hasRevised = revised.value.trim().length > 0 && revised.value !== original.value;
  const hasComment = comment.value.trim().length > 0;
  if (hasRevised && hasComment) return "修订 + 批注";
  if (hasRevised) return "修订";
  if (hasComment) return "批注";
  return "尚未填写";
});

const titleLabel = computed(() => (editingId.value ? "编辑修订与批注" : "修订与批注"));
const saveLabel = computed(() => (editingId.value ? "保存修改" : "加入图层"));

/** 把光标放到修订框末尾，方便接着原文改。 */
function focusRevised() {
  nextTick(() => {
    const box = revisedRef.value;
    if (!box) return;
    box.focus();
    box.setSelectionRange(revised.value.length, revised.value.length);
  });
}

/** 呼出表单（新建）。没有选区就提示，不静默失败。 */
function openForm() {
  const el = props.target;
  if (!el) return;
  if (!props.fileId) {
    showToast("没有可挂载的文档", "请先在左侧文档面板选中一篇文档", "edit");
    return;
  }
  const start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
  const end = typeof el.selectionEnd === "number" ? el.selectionEnd : 0;
  const selected = el.value.slice(Math.min(start, end), Math.max(start, end));
  if (!selected.trim()) {
    showToast("请先选中一段原文", "选中要修订或批注的文字后再呼出表单", "edit");
    return;
  }

  editingId.value = "";
  original.value = selected;
  anchor.value = Math.min(start, end);
  revised.value = selected;
  comment.value = "";
  open.value = true;
  emit("opened");
  focusRevised();
}

/** 呼出表单（编辑已有图层）。原文固定，只改修订内容与批注。 */
function openEdit(id: string) {
  const item = revisionStore.items.find((r) => r.id === id);
  if (!item) return;
  editingId.value = item.id;
  original.value = item.original;
  anchor.value = item.anchor;
  /* 之前只留了批注（修订为空）时，编辑框回填原文，方便直接改字。 */
  revised.value = item.revised || item.original;
  comment.value = item.comment;
  open.value = true;
  emit("opened");
  focusRevised();
}

function closeForm() {
  if (!open.value) return;
  open.value = false;
  editingId.value = "";
  original.value = "";
  revised.value = "";
  comment.value = "";
  anchor.value = 0;
  emit("closed");
}

function save() {
  if (!canSave.value) return;
  /* 修订内容与原文一字不差 → 视为没改，只留批注。 */
  const nextRevised = revised.value === original.value ? "" : revised.value;

  if (editingId.value) {
    if (!nextRevised && !comment.value.trim()) {
      showToast("未保存", "修订内容与批注都为空", "edit");
      return;
    }
    updateRevision(editingId.value, { revised: nextRevised, comment: comment.value });
    closeForm();
    showToast("已更新图层", "修订内容与批注已保存，正文仍是原文", "edit");
    return;
  }

  if (!props.fileId) return;
  const item = createRevision({
    fileId: props.fileId,
    original: original.value,
    revised: nextRevised,
    comment: comment.value,
    anchor: anchor.value,
  });
  if (!item) {
    showToast("未记录", "修订内容与批注都为空，或与原文完全一致", "edit");
    closeForm();
    return;
  }
  emit("created", item.id);
  closeForm();
  showToast(
    "已加入修订与批注",
    "已作为图层挂在左侧文档条目下方，小眼睛控制正文是否展示修订内容",
    "edit",
  );
}

/* ---------------- 快捷键 ---------------- */

function onTargetKeydown(event: KeyboardEvent) {
  if (!props.enabled) return;
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || !event.shiftKey || event.altKey) return;
  if (event.key.toLowerCase() !== "m") return;
  event.preventDefault();
  event.stopPropagation();
  if (open.value) closeForm();
  else openForm();
}

function onFormKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeForm();
    props.target?.focus();
    return;
  }
  /* Ctrl+Enter 保存：两个多行输入框里回车都留给换行。 */
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    save();
  }
}

watch(
  () => props.target,
  (el) => {
    boundTarget?.removeEventListener("keydown", onTargetKeydown, true);
    boundTarget = el;
    el?.addEventListener("keydown", onTargetKeydown, true);
    if (!el && open.value) closeForm();
  },
  { immediate: true },
);

/* 文档切换时表单里的原文已经失去归属，直接收起。 */
watch(
  () => props.fileId,
  () => {
    if (open.value) closeForm();
  },
);

/* 左侧面板双击图层 → 接手信号并立刻清空，分栏时另一个 pane 就不会重复弹窗。
   只有持有该图层所属文档的 pane 才响应。盯 editSeq 而不是 editingId：连续双击
   同一条图层时 id 不变，只盯 id 第二次就不会触发。 */
watch(
  () => revisionStore.editSeq,
  () => {
    const id = revisionStore.editingId;
    if (!id) return;
    const item = revisionStore.items.find((r) => r.id === id);
    if (!item || item.fileId !== props.fileId) return;
    clearRevisionEdit();
    openEdit(id);
  },
);

onBeforeUnmount(() => {
  boundTarget?.removeEventListener("keydown", onTargetKeydown, true);
});

defineExpose({ open: openForm, close: closeForm });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="rev-layer">
      <div class="rev-shell" role="dialog" aria-label="修订与批注" @keydown="onFormKeydown">
        <div class="rev-header">
          <span class="rev-title">
            <Layers :size="15" :stroke-width="1.8" aria-hidden="true" />
            {{ titleLabel }}
          </span>
          <span class="rev-kind">{{ kindLabel }}</span>
          <button class="rev-close" title="关闭（Esc）" aria-label="关闭" @click="closeForm">
            <X :size="15" :stroke-width="1.9" />
          </button>
        </div>

        <div class="rev-body">
          <div class="rev-col">
            <label class="rev-label">原文</label>
            <div class="rev-original" aria-readonly="true">{{ originalPreview }}</div>
            <span class="rev-hint">原文保持不动，图层只作叠加</span>
          </div>

          <div class="rev-col">
            <label class="rev-label" for="rev-revised">修订内容</label>
            <textarea
              id="rev-revised"
              ref="revisedRef"
              v-model="revised"
              v-auto-pair
              class="rev-input revised"
              spellcheck="false"
              placeholder="对着左边的原文写下修订后的文字…"
            ></textarea>

            <label class="rev-label" for="rev-comment">批注</label>
            <textarea
              id="rev-comment"
              v-model="comment"
              v-auto-pair
              class="rev-input comment"
              spellcheck="false"
              placeholder="写下批注（可只写批注，不改动文字）…"
            ></textarea>
          </div>
        </div>

        <div class="rev-footer">
          <span class="rev-foot-hint">Ctrl+Enter 保存 · Esc 取消</span>
          <div class="rev-actions">
            <button class="rev-btn" @click="closeForm">取消</button>
            <button class="rev-btn primary" :disabled="!canSave" @click="save">{{ saveLabel }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 不加遮罩：修订与批注常常要一边对照正文一边写，压一层暗底反而挡视线。
   本层只负责居中摆放面板，自身不吃点击（面板之外的操作照常可用）。
   层级压在行内 AI 浮层（3500）之上：两者不会同时出现，但呼出顺序不该决定谁可见。 */
.rev-layer {
  position: fixed;
  inset: 0;
  z-index: 3600;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.rev-layer > * {
  pointer-events: auto;
}

.rev-shell {
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  /* 没有遮罩托底，投影要更实一档才能与正文分层。 */
  box-shadow: 0 24px 60px -12px rgb(15 23 42 / 0.34), 0 6px 16px -4px rgb(15 23 42 / 0.16);
  overflow: hidden;
}

.rev-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
}

.rev-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--on-surface);
}

.rev-title svg {
  color: var(--primary);
}

.rev-kind {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--on-surface-variant);
}

.rev-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--on-surface-variant);
}

.rev-close:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.rev-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 14px;
  overflow-y: auto;
}

.rev-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.rev-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--on-surface-variant);
}

.rev-original {
  flex: 1;
  min-height: 150px;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--reading-border);
  border-left: 3px solid var(--reading-text-faint);
  border-radius: 6px;
  background: var(--reading-surface);
  color: var(--reading-text);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.rev-hint {
  font-size: 11px;
  color: var(--reading-text-faint);
}

.rev-input {
  min-height: 92px;
  padding: 9px 11px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-family: var(--app-font);
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  outline: none;
}

.rev-input.revised {
  min-height: 150px;
  border-left: 3px solid var(--primary);
}

.rev-input.comment {
  min-height: 74px;
  border-left: 3px solid var(--secondary);
}

.rev-input:focus {
  border-color: var(--primary);
}

.rev-input::placeholder {
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.rev-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
}

.rev-foot-hint {
  font-size: 11px;
  color: var(--reading-text-faint);
}

.rev-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rev-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 12.5px;
}

.rev-btn:hover {
  background: var(--surface-container-high);
}

.rev-btn.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.rev-btn.primary:hover:not(:disabled) {
  background: var(--primary-container);
  border-color: var(--primary-container);
}

.rev-btn.primary:disabled {
  opacity: 0.45;
  cursor: default;
}

@media (max-width: 720px) {
  .rev-body {
    grid-template-columns: 1fr;
  }
}
</style>
