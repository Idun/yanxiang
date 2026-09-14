<script setup lang="ts">
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  Scissors,
  Trash2,
} from "lucide-vue-next";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  hasSelection: boolean;
  canEdit: boolean;
}

interface Props {
  customContextMenu: ContextMenuState;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "cut"): void;
  (e: "copy"): void;
  (e: "paste"): void;
  (e: "delete"): void;
  (e: "selectAll"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.customContextMenu.visible"
      class="custom-context-menu"
      :style="{ left: props.customContextMenu.x + 'px', top: props.customContextMenu.y + 'px' }"
      @mousedown.stop
      @contextmenu.prevent
    >
      <button
        class="context-menu-item"
        :class="{ disabled: !props.customContextMenu.hasSelection || !props.customContextMenu.canEdit }"
        :disabled="!props.customContextMenu.hasSelection || !props.customContextMenu.canEdit"
        type="button"
        @click="emit('cut')"
      >
        <div class="menu-item-left">
          <Scissors :size="13" class="menu-item-icon" />
          <span>剪切</span>
        </div>
        <span class="menu-item-shortcut">Ctrl+X</span>
      </button>

      <button
        class="context-menu-item"
        :class="{ disabled: !props.customContextMenu.hasSelection }"
        :disabled="!props.customContextMenu.hasSelection"
        type="button"
        @click="emit('copy')"
      >
        <div class="menu-item-left">
          <Copy :size="13" class="menu-item-icon" />
          <span>复制</span>
        </div>
        <span class="menu-item-shortcut">Ctrl+C</span>
      </button>

      <button
        class="context-menu-item"
        :class="{ disabled: !props.customContextMenu.canEdit }"
        :disabled="!props.customContextMenu.canEdit"
        type="button"
        @click="emit('paste')"
      >
        <div class="menu-item-left">
          <ClipboardPaste :size="13" class="menu-item-icon" />
          <span>粘贴</span>
        </div>
        <span class="menu-item-shortcut">Ctrl+V</span>
      </button>

      <button
        class="context-menu-item danger-item"
        :class="{ disabled: !props.customContextMenu.hasSelection || !props.customContextMenu.canEdit }"
        :disabled="!props.customContextMenu.hasSelection || !props.customContextMenu.canEdit"
        type="button"
        @click="emit('delete')"
      >
        <div class="menu-item-left">
          <Trash2 :size="13" class="menu-item-icon" />
          <span>删除</span>
        </div>
        <span class="menu-item-shortcut">Del</span>
      </button>

      <div class="context-menu-divider"></div>

      <button
        class="context-menu-item"
        type="button"
        @click="emit('selectAll')"
      >
        <div class="menu-item-left">
          <CheckSquare :size="13" class="menu-item-icon" />
          <span>全选</span>
        </div>
        <span class="menu-item-shortcut">Ctrl+A</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 170px;
  background: var(--surface-container-low);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  user-select: none;
  animation: contextMenuPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes contextMenuPop {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  text-align: left;
}

.context-menu-item:hover:not(:disabled):not(.disabled) {
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.context-menu-item.danger-item:hover:not(:disabled):not(.disabled) {
  background: rgba(220, 53, 69, 0.12);
  color: #dc3545;
}

.context-menu-item:disabled,
.context-menu-item.disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.menu-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-item-icon {
  flex-shrink: 0;
  color: inherit;
  opacity: 0.85;
}

.menu-item-shortcut {
  font-size: 0.72rem;
  color: var(--on-surface-variant);
  opacity: 0.65;
  font-family: inherit;
  margin-left: 14px;
}

.context-menu-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 3px 0;
}
</style>
