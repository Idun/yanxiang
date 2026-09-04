<script setup lang="ts">
/**
 * 设置面板 ·「对话」选项卡
 *
 * 表单结构与「AI写作」选项卡保持一致：提示词（可一键恢复默认）+ 知识项列表
 * （自动加载开关 / 导入 / 移除）+ 保存配置。
 *
 * 单独成文件的原因：对话模式后续要按创作指令逐条扩展（身份模板只是第一条），
 * 放在这里改动不会牵连 AiSettingsPanel 里其它选项卡。
 */
import { FileText, Plus, RotateCcw, Trash2 } from "lucide-vue-next";
import { aiSettings, setKnowledgeAutoLoad, type KnowledgeFile } from "../settings";
import { CHAT_AGENT_PROMPT } from "../prompts/chatAgent";
import { SLASH_COMMANDS } from "../chatSlashCommands";

const emit = defineEmits<{
  (e: "save"): void;
  (e: "status", message: string, type: "ok" | "error"): void;
}>();

function restorePrompt() {
  aiSettings.chatPrompt = CHAT_AGENT_PROMPT;
}

function onAutoLoadChange(event: Event) {
  setKnowledgeAutoLoad("chat", (event.target as HTMLInputElement).checked);
}

function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

function addKnowledgeFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".txt,.md,.pdf,.docx,.doc,.rtf";
  input.onchange = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        const content = await readFileContent(file);
        const newFile: KnowledgeFile = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
          name: file.name,
          content,
          path: file.webkitRelativePath || undefined,
        };
        aiSettings.chatKnowledge.push(newFile);
      } catch (error) {
        console.error("读取文件失败:", error);
        emit("status", `读取文件 ${file.name} 失败`, "error");
      }
    }
  };
  input.click();
}

function removeKnowledgeFile(id: string) {
  const index = aiSettings.chatKnowledge.findIndex((f) => f.id === id);
  if (index !== -1) aiSettings.chatKnowledge.splice(index, 1);
}
</script>

<template>
  <div class="prompt-header">
    <label class="field-label" for="chatPrompt">提示词</label>
    <button class="restore-prompt-btn" title="恢复默认提示词" @click="restorePrompt">
      <RotateCcw :size="13" :stroke-width="1.8" />
      恢复默认
    </button>
  </div>
  <textarea
    id="chatPrompt"
    v-model="aiSettings.chatPrompt"
    class="prompt-textarea"
    rows="12"
    placeholder="请输入日常对话的提示词..."
  ></textarea>
  <p class="field-hint">
    这份提示词只管日常对话。用户在对话输入框左下角点「/」选择创作模式后，对应指令会在本轮追加到提示词后面，用完即走，不会污染日常问答。
  </p>

  <div class="knowledge-section">
    <div class="knowledge-header">
      <label class="field-label">知识</label>
      <div class="knowledge-header-actions">
        <label class="auto-load-control" title="自动加载内置默认知识素材（身份模板）">
          <span class="auto-load-text">自动加载</span>
          <span class="toggle-switch">
            <input type="checkbox" :checked="aiSettings.chatKnowledgeAutoLoad" @change="onAutoLoadChange" />
            <span class="toggle-slider"></span>
          </span>
        </label>
        <button class="knowledge-add-btn" title="添加知识文件" @click="addKnowledgeFile">
          <Plus :size="16" :stroke-width="1.8" />
        </button>
      </div>
    </div>
    <div class="knowledge-list">
      <div v-if="aiSettings.chatKnowledge.length === 0" class="knowledge-empty">
        暂无知识文件，点击 + 添加
      </div>
      <div v-for="file in aiSettings.chatKnowledge" :key="file.id" class="knowledge-item">
        <div class="knowledge-file-info">
          <FileText :size="14" :stroke-width="1.8" />
          <span class="knowledge-file-name">{{ file.name }}</span>
        </div>
        <button class="knowledge-remove-btn" title="移除文件" @click="removeKnowledgeFile(file.id)">
          <Trash2 :size="14" :stroke-width="1.8" />
        </button>
      </div>
    </div>
  </div>

  <div class="slash-section">
    <div class="knowledge-header">
      <label class="field-label">创作指令（对话输入框「/」菜单）</label>
    </div>
    <div class="slash-list">
      <div v-for="cmd in SLASH_COMMANDS" :key="cmd.id" class="slash-item">
        <code class="slash-trigger">{{ cmd.trigger }}</code>
        <div class="slash-text">
          <span class="slash-label">{{ cmd.label }}</span>
          <span class="slash-desc">{{ cmd.desc }}</span>
          <span class="slash-file">读取知识项：{{ cmd.knowledgeFile }}</span>
        </div>
      </div>
    </div>
  </div>

  <button class="save-btn" @click="emit('save')">保存配置</button>
</template>

<style scoped>
/* 与 AiSettingsPanel 的「AI写作」选项卡同源的表单样式。scoped 样式不跨组件，
   因此这里保留一份，改样式时两处同步。 */

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-top: 8px;
}

.field-hint {
  margin: -2px 0 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.prompt-header .field-label {
  margin-bottom: 0;
}

.restore-prompt-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.restore-prompt-btn:hover {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.prompt-textarea {
  width: 100%;
  min-height: 200px;
  padding: 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 13px;
  line-height: 1.5;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.prompt-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.1);
}

.knowledge-section,
.slash-section {
  margin-top: 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
}

.knowledge-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
}

.knowledge-header .field-label {
  margin: 0;
}

.knowledge-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.auto-load-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.auto-load-text {
  font-size: 12px;
  color: var(--on-surface-variant);
  user-select: none;
}

.knowledge-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.knowledge-add-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.knowledge-list {
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.knowledge-empty {
  padding: 16px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.knowledge-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background 0.2s ease;
}

.knowledge-item:hover {
  background: var(--surface-container-low);
}

.knowledge-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.knowledge-file-info svg {
  flex-shrink: 0;
  color: var(--primary);
}

.knowledge-file-name {
  font-size: 13px;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-remove-btn {
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
  flex-shrink: 0;
  transition: background 0.2s ease, color 0.2s ease;
}

.knowledge-remove-btn:hover {
  background: var(--error-container);
  color: var(--error);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--outline-variant);
  transition: 0.2s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #10b981;
}

input:checked + .toggle-slider:before {
  transform: translateX(18px);
}

/* ---- 创作指令一览（只读说明，不参与保存） ---- */

.slash-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slash-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background 0.2s ease;
}

.slash-item:hover {
  background: var(--surface-container-low);
}

.slash-trigger {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 5px;
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
}

.slash-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.slash-label {
  font-size: 13px;
  color: var(--on-surface);
}

.slash-desc,
.slash-file {
  font-size: 11px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.save-btn {
  margin-top: auto;
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.save-btn:hover {
  background: var(--primary-container);
}
</style>
