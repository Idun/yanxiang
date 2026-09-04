import { reactive } from "vue";
import { insightStore } from "./insightStore";
import { libraryStore } from "./libraryStore";
import { aiSettings } from "./settings";

export interface VectorChunk {
  id: string;
  category: "phrasing" | "paragraph" | "editing" | "history" | "avoided" | "card";
  title: string;
  content: string;
  vector?: number[];
}

export interface VectorStoreState {
  isIndexed: boolean;
  totalChunks: number;
  lastUpdated: string;
  chunks: VectorChunk[];
  statusText: string;
}

export const vectorStore = reactive<VectorStoreState>({
  isIndexed: false,
  totalChunks: 0,
  lastUpdated: "",
  chunks: [],
  statusText: "未构建",
});

/* Simple & fast character n-gram TF vectorizer + cosine similarity engine */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, "");
  const tokens: string[] = [];
  // Unigrams & Bigrams
  for (let i = 0; i < normalized.length; i++) {
    tokens.push(normalized[i]);
    if (i < normalized.length - 1) {
      tokens.push(normalized.slice(i, i + 2));
    }
  }
  return tokens;
}

function buildTermFreqMap(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  return tf;
}

function cosineSimilarityMap(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of a) {
    normA += freqA * freqA;
    const freqB = b.get(term);
    if (freqB) {
      dotProduct += freqA * freqB;
    }
  }

  for (const [, freqB] of b) {
    normB += freqB * freqB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function rebuildInsightVectorIndex() {
  const chunks: VectorChunk[] = [];

  // 1. Phrasing habits
  insightStore.habits.phrasing.forEach((h) => {
    chunks.push({
      id: h.id,
      category: "phrasing",
      title: h.title,
      content: `${h.title}：${h.desc}${h.examples.length ? `。实际样例：${h.examples.join("；")}` : ""}`,
    });
  });

  // 2. Paragraph habits
  insightStore.habits.paragraph.forEach((h) => {
    chunks.push({
      id: h.id,
      category: "paragraph",
      title: h.title,
      content: `${h.title}：${h.desc}`,
    });
  });

  // 3. Editing habits
  insightStore.habits.editing.forEach((h) => {
    chunks.push({
      id: h.id,
      category: "editing",
      title: h.title,
      content: `${h.title}：${h.desc}${h.examples.length ? `。修改示例：${h.examples.join("；")}` : ""}`,
    });
  });

  // 4. Avoided words
  if (insightStore.profile.avoided.length > 0) {
    const avoidedList = insightStore.profile.avoided.map((w) => w.word).join("、");
    chunks.push({
      id: "avoided_words",
      category: "avoided",
      title: "回避用词规避",
      content: `生成或润色时主动规避以下词汇：${avoidedList}`,
    });
  }

  // 5. Modification history examples (real before/after pairs only)
  insightStore.history.items.slice(0, 20).forEach((item) => {
    if (!item.before && !item.after) return;
    chunks.push({
      id: item.id,
      category: "history",
      title: `历史修改范例 (${item.typeLabel})`,
      content: item.after
        ? `原句：「${item.before}」 -> 修改后：「${item.after}」${item.note ? ` (${item.note})` : ""}`
        : `已删除的写法：「${item.before}」${item.note ? ` (${item.note})` : ""}`,
    });
  });

  // 6. Cards
  const seenCards = new Set<string>();
  libraryStore.cards.forEach((card) => {
    const snippet = card.content.trim();
    if (!snippet) return;
    /* 与文档重复的卡片正文只索引一次，避免一模一样的样本反复进入检索池。 */
    const key = snippet.replace(/\s+/g, "");
    if (seenCards.has(key)) return;
    seenCards.add(key);
    chunks.push({
      id: `card_${card.id}`,
      category: "card",
      title: `卡片: ${card.title}`,
      content: `${card.title} - ${snippet.slice(0, 200)}`,
    });
  });

  vectorStore.chunks = chunks;
  vectorStore.totalChunks = chunks.length;
  vectorStore.isIndexed = true;
  vectorStore.lastUpdated = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  vectorStore.statusText = chunks.length > 0 ? "已就绪" : "暂无数据";
}

/**
  Retrieves top-K relevant insight chunks for a user query via Cosine Vector Similarity.
  Significantly reduces prompt token size.
 */
export function searchInsightVectorStore(queryText: string, topK: number = 3): VectorChunk[] {
  if (!vectorStore.isIndexed) {
    rebuildInsightVectorIndex();
  }
  if (vectorStore.chunks.length === 0) return [];

  if (!queryText.trim()) {
    return vectorStore.chunks.slice(0, topK);
  }

  const queryTf = buildTermFreqMap(queryText);
  const scored = vectorStore.chunks.map((chunk) => {
    const chunkTf = buildTermFreqMap(`${chunk.title} ${chunk.content}`);
    const score = cosineSimilarityMap(queryTf, chunkTf);
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  /* Drop noise: a near-zero cosine means the chunk is irrelevant. */
  return scored.filter((s) => s.score > 0.02).slice(0, topK).map((s) => s.chunk);
}

/**
  Builds RAG retrieved prompt context using vector similarity matching.
 */
export function buildRAGInsightContext(queryText: string): string {
  if (!aiSettings.vectorEnabled) {
    return "";
  }
  const relevantChunks = searchInsightVectorStore(queryText, 4);
  if (relevantChunks.length === 0) return "";

  const lines = ["## RAG 检索相符的个人写作习惯与洞察样本："];
  relevantChunks.forEach((c) => {
    lines.push(`- [${c.title}] ${c.content}`);
  });
  return lines.join("\n");
}
