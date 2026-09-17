<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { Sparkles, Code, Search, X } from "lucide-vue-next";

export interface RegexExampleItem {
  id: string;
  name: string;
  category: string;
  source: string;
  target: string;
  description: string;
  example: string;
}

const REGEX_PRESET_EXAMPLES: RegexExampleItem[] = [
  {
    id: "brackets",
    name: "匹配中括号/方括号",
    category: "括号符号",
    source: "\\[(.*?)\\]",
    target: "【$1】",
    description: "将英文方括号 [xxx] 转换为中文【xxx】或去除",
    example: "[说明] -> 【说明】",
  },
  {
    id: "parentheses",
    name: "匹配英文小括号",
    category: "括号符号",
    source: "\\((.*?)\\)",
    target: "（$1）",
    description: "将英文小括号 (xxx) 规范化转换为中文全角括号（xxx）",
    example: "(备注) -> （备注）",
  },
  {
    id: "quotes",
    name: "匹配英文双引号",
    category: "括号符号",
    source: '"([^"]*)"',
    target: "“$1”",
    description: '将英文直引号 "xxx" 转换为中文弯引号 “xxx”',
    example: '"对话" -> “对话”',
  },
  {
    id: "duplicate_chars",
    name: "匹配连续重复汉字/标点",
    category: "重复词汇",
    source: "([\\u4e00-\\u9fa5，。！？])\\1+",
    target: "$1",
    description: "去除误打的连续重复字符或标点（如：的的 -> 的，！！ -> ！）",
    example: "看看看！！ -> 看！",
  },
  {
    id: "duplicate_words",
    name: "匹配连续双字重复词",
    category: "重复词汇",
    source: "([\\u4e00-\\u9fa5]{2})\\1",
    target: "$1",
    description: "去除误录入的连续双字重复词（如：非常非常 -> 非常）",
    example: "非常非常 -> 非常",
  },
  {
    id: "multi_empty_lines",
    name: "匹配连续多余空行",
    category: "空白排版",
    source: "\\n{3,}",
    target: "\\n\\n",
    description: "将3个及以上的超额连续空行收敛为标准双换行",
    example: "段落之间过多空白收敛",
  },
  {
    id: "line_edge_spaces",
    name: "匹配行首或行尾空格",
    category: "空白排版",
    source: "^[\\t ]+|[\\t ]+$",
    target: "",
    description: "清空每行首尾多余的无意义缩进与空格",
    example: "  文本内容   -> 文本内容",
  },
  {
    id: "multi_spaces",
    name: "匹配连续空格",
    category: "空白排版",
    source: "[ \\t]{2,}",
    target: " ",
    description: "将连续多个空格压缩为一个空格",
    example: "a    b -> a b",
  },
  {
    id: "punctuations",
    name: "匹配连续多余标点",
    category: "标点规范",
    source: "([，。！？、；：])\\1+",
    target: "$1",
    description: "压缩重复打出的标点符号为单标点",
    example: "好了？？？ -> 好了？",
  },
  {
    id: "ellipsis",
    name: "匹配非标准省略号",
    category: "标点规范",
    source: "(\\.{3,}|…{1,2}|。{3,})",
    target: "……",
    description: "将不规范的...或单一…统一替换为标准六点中文省略号",
    example: "等等... -> 等等……",
  },
  {
    id: "cjk_num_spacing",
    name: "中文字符与数字间空格",
    category: "标点规范",
    source: "([\\u4e00-\\u9fa5])(\\d+)",
    target: "$1 $2",
    description: "在中文字符与数字之间自动补齐优雅的半角间距",
    example: "共50篇 -> 共 50 篇",
  },
  {
    id: "html_tags",
    name: "匹配HTML/XML标签",
    category: "标签过滤",
    source: "<[^>]+>",
    target: "",
    description: "剔除文本中残留的 HTML/富文本标签，保留纯文本",
    example: "<b>加粗</b> -> 加粗",
  },
];

const categories = ["全部", "括号符号", "重复词汇", "空白排版", "标点规范", "标签过滤"];

const emit = defineEmits<{
  (e: "selectPreset", preset: { source: string; target: string; description: string }): void;
}>();

const isOpen = ref(false);
const search = ref("");
const activeCategory = ref("全部");
const rootRef = ref<HTMLDivElement | null>(null);

function handleClickOutside(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleClickOutside);
});

const filteredExamples = computed(() => {
  const kw = search.value.trim().toLowerCase();
  return REGEX_PRESET_EXAMPLES.filter((item) => {
    const matchCategory = activeCategory.value === "全部" || item.category === activeCategory.value;
    const matchSearch =
      !kw ||
      item.name.toLowerCase().includes(kw) ||
      item.description.toLowerCase().includes(kw) ||
      item.source.toLowerCase().includes(kw);
    return matchCategory && matchSearch;
  });
});

function handleApply(item: RegexExampleItem) {
  emit("selectPreset", {
    source: item.source,
    target: item.target,
    description: item.description,
  });
  isOpen.value = false;
}
</script>

<template>
  <div ref="rootRef" class="regex-helper">
    <button
      type="button"
      class="regex-trigger"
      :class="{ on: isOpen }"
      title="打开常用正则表达式提示助手与模板"
      @click="isOpen = !isOpen"
    >
      <Sparkles :size="12" :stroke-width="1.9" />
      <span>正则提示助手</span>
    </button>

    <div v-if="isOpen" class="regex-panel" @mousedown.stop>
      <div class="regex-panel-head">
        <span class="regex-panel-title">
          <Code :size="13" :stroke-width="1.9" />
          常用正则速查与构建助手
        </span>
        <button type="button" class="regex-icon-btn" title="关闭" @click="isOpen = false">
          <X :size="13" :stroke-width="1.9" />
        </button>
      </div>

      <div class="regex-search">
        <Search :size="13" :stroke-width="1.9" class="regex-search-icon" />
        <input
          v-model="search"
          type="text"
          placeholder="搜索正则示例（括号 / 重复 / 空行 …）"
          class="regex-search-input"
        />
      </div>

      <div class="regex-cats">
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="regex-cat"
          :class="{ on: activeCategory === cat }"
          @click="activeCategory = cat"
        >
          {{ cat }}
        </button>
      </div>

      <div class="regex-list">
        <p v-if="filteredExamples.length === 0" class="regex-empty">未找到相关正则表达式示例</p>
        <button
          v-for="item in filteredExamples"
          v-else
          :key="item.id"
          type="button"
          class="regex-item"
          @click="handleApply(item)"
        >
          <span class="regex-item-head">
            <span class="regex-item-name">{{ item.name }}</span>
            <span class="regex-item-tag">填入规则</span>
          </span>
          <span class="regex-item-desc">{{ item.description }}</span>
          <span class="regex-item-code">
            <span class="regex-code-row">
              <span class="regex-code-label">表达式</span>
              <code class="regex-code-src">{{ item.source }}</code>
            </span>
            <span class="regex-code-row">
              <span class="regex-code-label">替换为</span>
              <code class="regex-code-dst">{{ item.target || "(删除匹配内容)" }}</code>
            </span>
          </span>
          <span v-if="item.example" class="regex-item-example">示例：{{ item.example }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.regex-helper {
  position: relative;
  display: inline-flex;
}

.regex-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #a7d8c4;
  border-radius: 6px;
  background: #ecfbf4;
  color: #0f7a5a;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.regex-trigger:hover,
.regex-trigger.on {
  background: #d8f5e8;
  border-color: #6fc7a5;
}

.regex-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 340px;
  padding: 10px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 16px 36px -12px rgba(15, 23, 42, 0.3);
  animation: regexPop 0.14s ease-out;
}

@keyframes regexPop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.regex-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--outline-variant);
}

.regex-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.regex-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
}

.regex-icon-btn:hover {
  background: var(--surface-container-high);
}

.regex-search {
  position: relative;
  margin: 8px 0;
}

.regex-search-icon {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  color: var(--outline);
  pointer-events: none;
}

.regex-search-input {
  width: 100%;
  height: 28px;
  padding: 0 10px 0 26px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-low);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
}

.regex-search-input:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--surface-bright);
}

.regex-cats {
  display: flex;
  gap: 4px;
  padding-bottom: 8px;
  margin-bottom: 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--outline-variant);
  scrollbar-width: none;
}

.regex-cats::-webkit-scrollbar {
  display: none;
}

.regex-cat {
  flex-shrink: 0;
  padding: 2px 8px;
  border: none;
  border-radius: 999px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.regex-cat:hover {
  background: var(--surface-container-high);
}

.regex-cat.on {
  background: #0f7a5a;
  color: #fff;
}

.regex-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 2px;
}

.regex-empty {
  margin: 0;
  padding: 22px 0;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.regex-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-bright);
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.regex-item:hover {
  background: #f2fbf7;
  border-color: #8fd4b8;
}

.regex-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.regex-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.regex-item-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: #d8f5e8;
  color: #0f7a5a;
  font-size: 10px;
  font-weight: 600;
}

.regex-item-desc {
  color: var(--on-surface-variant);
  font-size: 11px;
  line-height: 1.5;
}

.regex-item-code {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-container-low);
}

.regex-code-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.regex-code-label {
  flex-shrink: 0;
  color: var(--outline);
  font-size: 10px;
  user-select: none;
}

.regex-code-src,
.regex-code-dst {
  overflow: hidden;
  font-family: var(--code-font);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.regex-code-src {
  color: #b42318;
}

.regex-code-dst {
  color: #0f7a5a;
}

.regex-item-example {
  color: var(--outline);
  font-size: 10px;
}
</style>
