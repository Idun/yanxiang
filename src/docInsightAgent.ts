/**
 * 「文档界面阅读辅助」的 AI 提取代理：
 * 用户点一次左侧「人物星图」标签，就用后端 AI 从当前章节正文一次性抽取出
 * 出场人物名单与点名出现的地点名称（严格 JSON 输出），结果交给 docInsightStore 落库。
 */

import { runAgent } from "./agentRunner";
import { aiSettings } from "./settings";
import { showToast } from "./insightStore";
import { hashText, setDocInsight } from "./docInsightStore";

export const INSIGHT_EXTRACT_SYSTEM_PROMPT = `你是网络小说「人物与地点识别器」。我会给你一段章节正文，请你只做一件事：

从正文中提取「出场人物名字」与「点名出现的地点名称」，然后**只输出一个 JSON 对象**，不要输出任何其它文字、解释或 Markdown 代码围栏。

输出格式严格如下：
{"characters":["人物1","人物2"],"places":["地点1","地点2"]}

规则：
1. 人物只给名字本身（中文名 2~4 字，如「王小明」「苏晚」；外国人名给中文译名或原文；侦探/角色等只取名字），不包含「说/道/问」等动词后缀，不包含头衔（如「大人」「将军」可去掉，除非它本身就是称呼名）。
2. 地点给出正文里点名出现的具体地名（如「青云山」「洛水城」「后院柴房」），不要普通名词。
3. 没有就空数组，不要臆造。

正文如下：`;

export interface InsightExtractResult {
  characters: string[];
  places: string[];
}

/** 从 JSON 文本里捞取 { characters, places }，容忍模型多给了 ``` 围栏或多余文字。 */
export function parseInsightJson(text: string): InsightExtractResult | null {
  const raw = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      characters?: unknown;
      places?: unknown;
    };
    const str = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];
    return { characters: str(parsed.characters), places: str(parsed.places) };
  } catch {
    return null;
  }
}

/** 用后端 AI 从正文一次性提取人物与地点；成功则写入 docInsightStore 并返回结果。 */
export async function extractInsightsFromChapter(
  fileId: string,
  chapterNum: number | null,
  chapterText: string,
): Promise<InsightExtractResult | null> {
  const trimmed = chapterText.trim().slice(0, 12000);
  if (!trimmed) return null;

  const result = await runAgent({
    provider: aiSettings.provider,
    url: aiSettings.url,
    apiKey: aiSettings.apiKey,
    model: aiSettings.model,
    apiType: aiSettings.apiType,
    systemPrompt: INSIGHT_EXTRACT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: trimmed }],
    stream: false,
    autoContinue: 0,
  });

  const out = parseInsightJson(result.text || "");
  if (!out) {
    showToast("提取失败", "AI 未返回可解析的人物/地点，请重试", "edit");
    return null;
  }
  setDocInsight(fileId, {
    chapterNum,
    contentHash: hashText(trimmed),
    characters: out.characters,
    places: out.places,
    updatedAt: Date.now(),
  });
  return out;
}