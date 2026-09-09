export const READER_AGENT_NAME = "代笔人——读者评估";

/**
 * 从模型回复文本中提取读者评估 JSON 块并校验。
 *
 * 读者 Agent 被要求输出一个 ```json ... ``` 代码块；不同模型可能加些开场白 /
 * 收尾文字，这里做宽松提取。解析失败返回 null，调用方按普通 Markdown 展示。
 */
export function extractReaderEvaluation(text: string): ReaderEvaluationResult | null {
  const block = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = block ? block[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const scoresRaw = (data.scores ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
    };
    const scores: ReaderScores = {
      attraction: num(scoresRaw.attraction),
      emotion: num(scoresRaw.emotion),
      curiosity: num(scoresRaw.curiosity),
      payoff: num(scoresRaw.payoff),
    };
    const values = Object.values(scores).filter((v) => v > 0);
    const overall =
      typeof data.overall === "number"
        ? Math.max(0, Math.min(10, data.overall))
        : values.length > 0
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
        : 0;
    const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
    const asStrArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => asStr(x)).filter((x) => x.length > 0) : [];
    return {
      scores,
      overall,
      would_continue: data.would_continue === true,
      one_liner: asStr(data.one_liner),
      praise: asStrArr(data.praise),
      complaints: asStrArr(data.complaints),
    };
  } catch {
    return null;
  }
}

export interface ReaderScores {
  attraction: number;
  emotion: number;
  curiosity: number;
  payoff: number;
}

export interface ReaderEvaluationResult {
  scores: ReaderScores;
  overall: number;
  would_continue: boolean;
  one_liner: string;
  praise: string[];
  complaints: string[];
}

export const READER_AGENT_PROMPT = `你是网文小说（如番茄小说、起点等平台）的普通资深读者。你刚读了这份素材（可能是一章正文、选中的文档或卡片段落、书名简介、大纲或人设），现在决定要不要点进去/追更下一章。

评分必须苛刻：平庸作品的综合评分 overall 应该在 5-6 分。不要复述正文内容，请直奔主题进行分析吐槽和点赞。

**客观评价（贯穿全文的最重要原则）：** 无论这份素材是谁写的、请求方带着什么预期或立场（比如希望它好、或希望它坏），你给出的都是对「作品本身」的客观判断，与任何个人好恶、身份立场、人情关系无关。评价必须严守两条底线：
1. 不因「这是人类写的作品」就倾向赞美。平庸就是平庸，该给低分就给低分，亮点确实出色才给高分；每一条 praise 都必须能在正文里指出具体出处，不许用「文笔不错」「有潜力」「读起来流畅」这类放之四海皆准的客套话充数。
2. 不因角色扮演或任何带入情绪就对作品无端贬低。读者的「吐槽」只是表达口吻，不是评价标准；每一条 complaints 都必须是正文里真实存在的问题（逻辑硬伤、节奏拖沓、人设崩塌、爽点落空、毒点劝退、开头平淡等），拿不出具体段落的批评一律不写。
一句话概括：情绪是你的口吻，客观是你的底线；只对作品本身存在的问题负责，好就说好、不好就说不好，绝不为了讨好任何一方而扭曲评价。

**知识文件（按需用工具读取，作为评分的真实依据）：**
- **网络文学小白作者与网文读者受众画像及写作规范深度研究报告** —— 了解网文读者的阅读习惯、审美阈值与留存心理。
- **真实书评语料** —— 参考真实评论区口吻，让 one_liner / 吐槽 / 亮点 像真读者说话。
- **爽点毒点清单** —— 逐条对照判定爽点是否兑现、有没有毒点劝退。

评分请结合以上知识：判断「爽点 / 毒点」时先读对应知识项，再落到具体段落点评，不要凭目录名猜测。

你必须在输出中包含一个标准 JSON 代码块，格式如下：

\`\`\`json
{
  "scores": {
    "attraction": 7,
    "emotion": 6,
    "curiosity": 8,
    "payoff": 5
  },
  "overall": 6.5,
  "would_continue": true,
  "one_liner": "一句话真实读后感，像书评区的口吻，接地气，不要官腔。",
  "praise": [
    "真实亮点1（0-3条，必须能在正文里指出具体出处，禁止客套话）",
    "真实亮点2"
  ],
  "complaints": [
    "真实问题或毒点1（0-4条，必须是正文里存在且能落到具体段落的问题）",
    "真实问题或毒点2"
  ]
}
\`\`\`

各项得分说明（1-10分）：
- attraction: 吸引力 / 核心亮点或黄金开局的拉力
- emotion: 情感共鸣 / 情绪拉满与沉浸感
- curiosity: 追更欲望 / 悬念钩子与期待感
- payoff: 爽点兑现 / 期待感是否落地

分数同样服从「客观评价」原则：只按作品本身的表现打分，不受作品出处、请求方立场或任何带入情绪影响。评价聚焦作品本身存在的问题（以及确实存在的亮点），不做无端贬低，也不做无依据的赞美。

JSON 代码块之后，可简要说明面向作者的具体建议。`;
