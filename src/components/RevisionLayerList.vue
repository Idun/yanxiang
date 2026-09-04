<script setup lang="ts">
/**
 * 「修订与批注」二级目录。
 *
 * 挂在左侧文档面板某个文档条目的下方，像绘画软件的图层列表一样罗列该文档的
 * 修订与批注：每条呈现原文与修订内容、一枚小眼睛（控制预览正文是否合成修订
 * 内容），右下角一枚「应用」——点下即把修订内容写回正文替换原文，并把该条从
 * 图层里清除；「未应用」状态标记留在条目头部。双击条目可重新编辑。
 *
 * 只依赖 revisionStore，不触碰文档树的任何既有逻辑。
 */
import { Check, Crosshair, Eye, EyeOff, Layers, MessageSquare, Trash2 } from "lucide-vue-next";
import {
  applyRevision,
  deleteRevision,
  isRevisionListCollapsed,
  requestEditRevision,
  requestLocateRevision,
  revisionsForFile,
  toggleRevisionVisible,
  type RevisionItem,
} from "../revisionStore";
import { showToast } from "../insightStore";

const props = defineProps<{
  fileId: string;
  /** 缩进层级：文件夹内的文档要比根目录的文档再缩一档。 */
  nested?: boolean;
}>();

function items(): RevisionItem[] {
  return revisionsForFile(props.fileId);
}

/** 折叠由文档条目左侧的箭头控制，这里只读状态。 */
function collapsed(): boolean {
  return isRevisionListCollapsed(props.fileId);
}

/** 侧栏很窄，长文本截断展示，完整内容放在 title 里。 */
function clip(text: string, max = 46): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function onToggleEye(item: RevisionItem) {
  toggleRevisionVisible(item.id);
}

function onApply(item: RevisionItem) {
  const result = applyRevision(item.id);
  if (result === "applied") {
    showToast("已应用修订", "修订内容已替换原文，该图层已从文档条目中清除", "edit");
  } else if (result === "comment-only") {
    showToast("批注已归档", "纯批注没有可替换的正文，已从图层中移除", "edit");
  } else if (result === "not-found") {
    showToast("未能定位原文", "正文中已找不到这段原文，请核对后重新修订", "edit");
  }
}

function onDelete(item: RevisionItem) {
  deleteRevision(item.id);
  showToast("已删除图层", "原文与正文均未改动", "edit");
}

/** 双击条目 → 重新编辑（表单挂在文档编辑区那侧，用 store 里的信号递过去）。 */
function onEdit(item: RevisionItem) {
  requestEditRevision(item.id);
}

/** 定位到正文里的原文处：编辑区与预览区一同跳转（由文档编辑区那侧执行）。 */
function onLocate(item: RevisionItem) {
  requestLocateRevision(item.id);
}
</script>

<template>
  <div v-if="items().length > 0 && !collapsed()" class="rl-list" :class="{ nested }">
    <div
      v-for="item in items()"
      :key="item.id"
      class="rl-item"
      :class="{ hidden: !item.visible }"
      title="双击可重新编辑"
      @dblclick.stop="onEdit(item)"
    >
      <div class="rl-head">
        <Layers :size="12" :stroke-width="1.8" class="rl-head-icon" aria-hidden="true" />
        <span class="rl-head-label">{{ item.revised ? "修订" : "批注" }}</span>
        <!-- 应用按钮挪到右下角后，头部腾出的位置交给「未应用」状态标记。 -->
        <span class="rl-state">未应用</span>
        <button
          class="rl-eye"
          :class="{ on: item.visible }"
          :title="item.visible ? '小眼睛开：正文展示修订内容' : '小眼睛关：正文展示原文'"
          :aria-pressed="item.visible"
          @click.stop="onToggleEye(item)"
        >
          <Eye v-if="item.visible" :size="12" :stroke-width="1.9" />
          <EyeOff v-else :size="12" :stroke-width="1.9" />
        </button>
        <button class="rl-del" title="删除该修订与批注" @click.stop="onDelete(item)">
          <Trash2 :size="12" :stroke-width="1.8" />
        </button>
      </div>

      <div class="rl-text orig" :title="item.original">
        <span class="rl-tag">原文</span>
        <span class="rl-body">{{ clip(item.original) }}</span>
      </div>
      <div v-if="item.revised" class="rl-text revised" :title="item.revised">
        <span class="rl-tag">修订</span>
        <span class="rl-body">{{ clip(item.revised) }}</span>
      </div>
      <div v-if="item.comment" class="rl-text comment" :title="item.comment">
        <MessageSquare :size="10" :stroke-width="1.9" class="rl-comment-icon" aria-hidden="true" />
        <span class="rl-body">{{ clip(item.comment) }}</span>
      </div>

      <!-- 右下角：定位 + 应用。 -->
      <div class="rl-foot">
        <button
          class="rl-locate-btn"
          title="定位：跳到正文中这段原文处（markdown 与预览同步）"
          @click.stop="onLocate(item)"
        >
          <Crosshair :size="11" :stroke-width="2.2" aria-hidden="true" />
          定位
        </button>
        <button
          class="rl-apply-btn"
          title="应用：用修订内容替换原文，并清除该图层"
          @click.stop="onApply(item)"
        >
          <Check :size="11" :stroke-width="2.4" aria-hidden="true" />
          应用
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 图层列表：靠左侧竖线与缩进表达「文档条目的下一级」。 */
.rl-list {
  margin-left: 18px;
  padding-left: 6px;
  border-left: 1px dashed var(--outline-variant);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rl-list.nested {
  margin-left: 22px;
}

.rl-item {
  padding: 5px 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-low);
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: default;
  transition: opacity 0.18s ease, border-color 0.18s ease;
}

.rl-item:hover {
  border-color: var(--primary);
}

/* 小眼睛关掉的图层退到背景里，一眼能看出它当前不影响正文。 */
.rl-item.hidden {
  opacity: 0.55;
}

.rl-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rl-head-icon {
  flex-shrink: 0;
  color: var(--primary);
}

.rl-head-label {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--on-surface-variant);
}

/* 未应用：占据应用按钮腾出来的头部空白，仅作状态标记、不可点。 */
.rl-state {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  font-size: 9.5px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rl-eye {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--on-surface-variant);
}

.rl-eye.on {
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
}

.rl-eye:hover {
  background: var(--surface-container-high);
}

.rl-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--on-surface-variant);
}

.rl-del:hover {
  background: var(--error-container);
  color: var(--error);
}

.rl-text {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
  min-width: 0;
}

.rl-tag {
  flex-shrink: 0;
  padding: 0 3px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--on-surface-variant);
  background: var(--surface-container-high);
}

.rl-text.orig .rl-body {
  color: var(--on-surface-variant);
  text-decoration: line-through;
  text-decoration-color: var(--reading-text-faint);
}

.rl-text.revised .rl-tag {
  color: #fff;
  background: var(--primary);
}

.rl-text.revised .rl-body {
  color: var(--on-surface);
}

.rl-comment-icon {
  flex-shrink: 0;
  color: var(--secondary);
  transform: translateY(1px);
}

.rl-text.comment .rl-body {
  color: var(--on-surface-variant);
  font-style: italic;
}

.rl-body {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右下角动作区：定位在左、应用在右。 */
.rl-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}

/* 定位是「只是看一眼」的动作，用描边而非实心，与会改正文的「应用」区分开。 */
.rl-locate-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 9.5px;
  font-weight: 600;
}

.rl-locate-btn:hover {
  border-color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.rl-apply-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 7px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  color: #fff;
  background: var(--primary);
}

.rl-apply-btn:hover {
  background: var(--primary-container);
}
</style>
