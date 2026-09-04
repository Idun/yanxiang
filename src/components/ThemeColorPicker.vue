<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Pipette, RotateCcw, X } from "lucide-vue-next";
import {
  aiSettings,
  applyPrimaryColor,
  defaultTheme,
  deriveTheme,
  hexToHsl,
  hslToHex,
  normalizeHex,
  resetTheme,
} from "../settings";

/**
 * Free-form theme colour picker.
 *
 * Opened by clicking a theme swatch. Offers a hue/lightness palette, the OS
 * colour dialog, a hex field with explicit confirmation, and a reset button.
 * Nothing is committed until 应用 / 确认 so an accidental drag cannot wreck the
 * current theme — except the live preview, which is reverted on cancel.
 */

const props = defineProps<{
  /** Colour the picker opens with. */
  value: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "applied", hex: string): void;
}>();

/* Snapshot so 取消 can put the theme back exactly as it was. */
const originalTheme = { ...aiSettings.theme };

const draft = ref(normalizeHex(props.value) ?? defaultTheme.primary);
const hexInput = ref(draft.value);
const hexError = ref("");

watch(
  () => props.value,
  (v) => {
    const n = normalizeHex(v);
    if (n) {
      draft.value = n;
      hexInput.value = n;
    }
  },
);

/* ---- palette grid: 12 hues x 5 lightness steps ---- */

const HUES = Array.from({ length: 12 }, (_, i) => i * 30);
const LEVELS = [0.86, 0.72, 0.55, 0.42, 0.28];

const paletteRows = computed(() =>
  LEVELS.map((l) => HUES.map((h) => hslToHex(h, l > 0.7 ? 0.5 : 0.55, l))),
);

/** Neutral ramp so greys are reachable too. */
const neutralRow = computed(() =>
  [0.95, 0.82, 0.68, 0.54, 0.4, 0.3, 0.22, 0.14].map((l) => hslToHex(220, 0.1, l)),
);

const derived = computed(() => deriveTheme(draft.value));

function pick(hex: string) {
  const n = normalizeHex(hex);
  if (!n) return;
  draft.value = n;
  hexInput.value = n;
  hexError.value = "";
  /* Live preview so the choice can be judged in context. */
  applyPrimaryColor(n);
}

function onNativeInput(event: Event) {
  pick((event.target as HTMLInputElement).value);
}

/** Confirm a typed hex value. */
function commitHexInput() {
  const n = normalizeHex(hexInput.value);
  if (!n) {
    hexError.value = "请输入合法色值，如 #43588C 或 43588C";
    return;
  }
  hexError.value = "";
  pick(n);
}

function onReset() {
  resetTheme();
  draft.value = defaultTheme.primary;
  hexInput.value = defaultTheme.primary;
  hexError.value = "";
}

function confirm() {
  const n = normalizeHex(draft.value);
  if (!n) return;
  applyPrimaryColor(n);
  emit("applied", n);
  emit("close");
}

function cancel() {
  /* Roll the live preview back. */
  applyPrimaryColor(originalTheme.primary);
  emit("close");
}

const rootRef = ref<HTMLDivElement | null>(null);

function onDocumentPointerDown(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) cancel();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") cancel();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointerDown, true);
  document.removeEventListener("keydown", onDocumentKeydown);
});

const hsl = computed(() => hexToHsl(draft.value));
</script>

<template>
  <div ref="rootRef" class="tcp" @click.stop>
    <div class="tcp-head">
      <span class="tcp-title">自定义主题色</span>
      <button class="tcp-icon-btn" title="关闭" @click="cancel">
        <X :size="14" :stroke-width="2" />
      </button>
    </div>

    <!-- 调色盘 -->
    <div class="tcp-palette">
      <div v-for="(row, ri) in paletteRows" :key="ri" class="tcp-row">
        <button
          v-for="c in row"
          :key="c"
          class="tcp-cell"
          :class="{ active: c === draft }"
          :style="{ background: c }"
          :title="c"
          @click="pick(c)"
        />
      </div>
      <div class="tcp-row tcp-row-neutral">
        <button
          v-for="c in neutralRow"
          :key="c"
          class="tcp-cell"
          :class="{ active: c === draft }"
          :style="{ background: c }"
          :title="c"
          @click="pick(c)"
        />
      </div>
    </div>

    <!-- 任意取色 + 色值输入 -->
    <div class="tcp-controls">
      <label class="tcp-native" :title="`系统取色器：${draft}`">
        <span class="tcp-native-swatch" :style="{ background: draft }"></span>
        <Pipette :size="13" :stroke-width="1.9" />
        <input type="color" :value="draft" @input="onNativeInput" />
      </label>

      <input
        v-model="hexInput"
        class="tcp-hex"
        spellcheck="false"
        placeholder="#43588C"
        @keydown.enter.prevent="commitHexInput"
      />
      <button class="tcp-confirm-hex" title="应用该色值" @click="commitHexInput">
        <Check :size="13" :stroke-width="2.2" />
      </button>
    </div>

    <p v-if="hexError" class="tcp-error">{{ hexError }}</p>
    <p v-else class="tcp-readout">
      {{ draft.toUpperCase() }}
      <span v-if="hsl" class="tcp-hsl">
        H {{ Math.round(hsl.h) }}° · S {{ Math.round(hsl.s * 100) }}% · L {{ Math.round(hsl.l * 100) }}%
      </span>
    </p>

    <!-- 派生色预览 -->
    <div class="tcp-derived">
      <span class="tcp-derived-label">联动色</span>
      <span class="tcp-chip" :style="{ background: derived.primary }" title="primary"></span>
      <span class="tcp-chip" :style="{ background: derived.primaryContainer }" title="primary-container"></span>
      <span class="tcp-chip" :style="{ background: derived.primaryFixedDim }" title="primary-fixed-dim"></span>
    </div>

    <div class="tcp-actions">
      <button class="tcp-btn ghost" @click="onReset">
        <RotateCcw :size="13" :stroke-width="1.9" />
        恢复默认
      </button>
      <button class="tcp-btn" @click="cancel">取消</button>
      <button class="tcp-btn primary" @click="confirm">
        <Check :size="13" :stroke-width="2.2" />
        应用
      </button>
    </div>
  </div>
</template>

<style scoped>
.tcp {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 80;
  width: 288px;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: 0 18px 40px rgb(15 23 42 / 0.22);
}

.tcp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.tcp-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--on-surface);
}

.tcp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
}

.tcp-icon-btn:hover {
  background: var(--surface-container-high);
}

/* ---- palette ---- */

.tcp-palette {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
}

.tcp-row {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 3px;
}

.tcp-row-neutral {
  grid-template-columns: repeat(8, 1fr);
  margin-top: 3px;
}

.tcp-cell {
  height: 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.08);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.tcp-cell:hover {
  transform: scale(1.14);
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.2);
}

.tcp-cell.active {
  box-shadow: 0 0 0 2px var(--on-surface), inset 0 0 0 1px rgb(255 255 255 / 0.7);
}

/* ---- controls ---- */

.tcp-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tcp-native {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container-lowest);
  color: var(--on-surface-variant);
  cursor: pointer;
}

.tcp-native:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.tcp-native-swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.15);
}

/* The real input covers the label so the OS dialog opens on click. */
.tcp-native input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  padding: 0;
  cursor: pointer;
}

.tcp-hex {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  text-transform: uppercase;
  outline: none;
}

.tcp-hex:focus {
  border-color: var(--primary);
}

.tcp-confirm-hex {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  cursor: pointer;
}

.tcp-confirm-hex:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.tcp-error {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--error);
}

.tcp-readout {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 7px 0 0;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  color: var(--on-surface);
}

.tcp-hsl {
  font-family: inherit;
  font-size: 10px;
  color: var(--on-surface-variant);
}

/* ---- derived ramp ---- */

.tcp-derived {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--outline-variant);
}

.tcp-derived-label {
  margin-right: 2px;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.tcp-chip {
  width: 22px;
  height: 14px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.12);
}

/* ---- actions ---- */

.tcp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 11px;
}

.tcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.tcp-btn:hover {
  background: var(--surface-container-high);
}

.tcp-btn.ghost {
  margin-right: auto;
}

.tcp-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

.tcp-btn.primary:hover {
  background: var(--primary-container);
  border-color: var(--primary-container);
}
</style>
