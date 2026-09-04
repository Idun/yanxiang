import { aiSettings } from "./settings";
import { BUNDLED_CHAT_KNOWLEDGE, IDENTITY_TEMPLATE_FILE } from "./prompts/knowledgeDefaults";

/**
 * 「对话」输入框的斜杠指令（/）。
 *
 * 设计要点：
 *  - 指令只是一层「显式开关」。用户不打斜杠时，对话完全走原来的常规问答路径，
 *    这个模块的任何内容都不会进入系统提示词，日常闲聊的表现与改造前一致。
 *  - 命中指令时，也不把知识项正文塞进提示词，而是让模型自己用 read_knowledge
 *    工具去读挂载的 .md —— 与 AI写作 / 审核员两个标签页的知识项机制保持同源。
 *  - 指令块只讲「怎么做」和「输出纪律」，模板正文由模型现读现用，
 *    所以后续改 src/prompts/md/身份模板.md 不需要动代码。
 */

export interface SlashCommand {
  id: string;
  /** 输入框里的触发词（含前导斜杠）。 */
  trigger: string;
  /** 菜单里的显示名。 */
  label: string;
  /** 菜单里的一句话说明。 */
  desc: string;
  /** 该指令要求模型阅读的知识项文件名。 */
  knowledgeFile: string;
  /** 除 trigger 之外还认的写法（全角斜杠、英文别名等）。 */
  aliases: string[];
}

/* ---------------- 指令表 ---------------- */

export const IDENTITY_TEMPLATE_COMMAND: SlashCommand = {
  id: "identity-template",
  trigger: "/身份模板",
  label: "身份模板",
  desc: "按身份模板深度分析需求并扮演身份直接产出正文",
  knowledgeFile: IDENTITY_TEMPLATE_FILE,
  aliases: ["／身份模板", "/identity", "/身份"],
};

export const SLASH_COMMANDS: SlashCommand[] = [IDENTITY_TEMPLATE_COMMAND];

/** 菜单里给用户看的触发提示。 */
export const SLASH_TRIGGER_HINT = "输入 / 或点此选择创作模式";

/* ---------------- 识别 ---------------- */

/** 一条指令认的全部写法，长的排前面，避免 "/身份" 抢掉 "/身份模板"。 */
function allTriggers(command: SlashCommand): string[] {
  return [command.trigger, ...command.aliases].sort((a, b) => b.length - a.length);
}

export interface SlashCommandHit {
  command: SlashCommand;
  /** 触发词后面剩下的用户需求正文。 */
  body: string;
  /** 用户实际打出来的那种写法，回显时按原样保留。 */
  matched: string;
}

/**
 * 识别一条消息是否以斜杠指令开头。
 *
 * 只认行首（允许前导空白），中途出现的 "/" 不算，免得正文里写个网址就被当成指令。
 */
export function detectSlashCommand(text: string): SlashCommandHit | null {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith("/") && !trimmed.startsWith("／")) return null;

  for (const command of SLASH_COMMANDS) {
    for (const trigger of allTriggers(command)) {
      if (!trimmed.toLowerCase().startsWith(trigger.toLowerCase())) continue;
      const rest = trimmed.slice(trigger.length);
      /* "/身份模板X" 不算命中，必须是独立的一个词。 */
      if (rest && !/^[\s：:，,、]/.test(rest)) continue;
      return {
        command,
        body: rest.replace(/^[\s：:，,、]+/, "").trim(),
        matched: trimmed.slice(0, trigger.length),
      };
    }
  }
  return null;
}

/** 把指令词从正文里摘掉，只留用户真正的需求描述。 */
export function stripSlashCommand(text: string): string {
  const hit = detectSlashCommand(text);
  return hit ? hit.body : text;
}

/**
 * 不经过文本解析，直接构造一次命中。
 *
 * 指令词现在以胶囊形式独立存在、不再拼进消息正文，所以发送时无法再靠
 * detectSlashCommand 从正文里"认"出指令 —— 由调用方把当前胶囊与需求正文
 * 交给这个函数即可，避免为了让后端识别而把指令词塞回正文（那正是「已发送
 * 消息里出现明文 /身份模板」的根因）。
 */
export function makeSlashHit(command: SlashCommand, body: string): SlashCommandHit {
  return { command, body: body.trim(), matched: command.trigger };
}

/**
 * 往输入框现有内容前面插一条指令。
 *
 * 已经带着同一条指令时只把写法规范成 canonical 的触发词（用户手打的 `/身份`
 * 这类别名会被补全成 `/身份模板`），不会出现 "/身份模板 /身份模板"。
 */
export function withSlashCommand(text: string, command: SlashCommand): string {
  const hit = detectSlashCommand(text);
  if (hit && hit.command.id === command.id && hit.matched === command.trigger) return text;
  const body = hit ? hit.body : text.replace(/^\s+/, "");
  return body ? `${command.trigger} ${body}` : `${command.trigger} `;
}

/* ---------------- 续写（接上一回合） ---------------- */

/**
 * 用户这句话是不是「接着上一回写下去」。
 *
 * 判定从严：先把空白与标点全剔掉，再要求整句就是一条续写指令。这样
 * 「继续」「接着写」「继续写完」会命中，而「继续讲讲这个话题」「继续帮我改
 * 第三段」不会命中（那些是新需求，不该走续写分支）。
 */
export function isContinueRequest(text: string): boolean {
  const bare = text.replace(/[\s\p{P}\p{S}]/gu, "");
  if (!bare || bare.length > 18) return false;
  return /^(?:请|你|您|麻烦|帮我|帮忙|那|就|再|然后)*(?:继续|接着写|接着说|接着输出|接下去写|接下来写|往下写|写下去|接上文|接上面|接着上文|续写|再写|继续写|继续输出|继续上文|没写完|还没写完|被截断了?|断了|中断了|go?on|continue|keep(?:on)?going|proceed)(?:一下|下去|下来|吧|呀|啊|哦|嘛|完|写完|输出|正文|它|他)*$/i.test(
    bare,
  );
}

export interface ContinuationContext {
  /** 上一回合已经写出来的正文（过长时只取尾部）。 */
  tail: string;
  /** tail 是否只是尾部截取（true 表示前面还有更多已写内容）。 */
  tailOnly: boolean;
  /** 上一回合用户的需求原文（已摘掉指令词）。 */
  request: string;
  /** 上一回合的正文是否已被明确判定为「没写完」（被截断 / 被中止）。 */
  truncated: boolean;
}

/** 续写块：所有分支共用的「怎么接」硬性约定。 */
function continuationRules(ctx: ContinuationContext): string[] {
  const lines: string[] = [
    "",
    "【本轮是续写 · 最高优先级】上一条回复的正文没有写完就断了，用户这句话的意思只有一个：接着上一回写下去。",
    ctx.truncated
      ? "  · 已确认上一条是被中断 / 被输出长度上限截断的半截正文，不是完成品。"
      : "  · 用户明确要求接着写，按「上一条是半截正文」处理。",
    "  · 从上一条正文的最后一个字往下接。断在半句、半个词甚至半个标点里，就从那个位置补完，不要另起一句。",
    "  · 不要重写开头、不要复述或概括前面已经写过的内容、不要换个说法把前文重讲一遍。",
    "  · 不要出现「继续」「接上文」「好的」「抱歉」这类交代话，不要加分隔线、小标题、序号或任何括注。",
    "  · 身份、口吻、人称、时态、格式、情绪基调、字数目标与前半段完全一致，当成同一次落笔的后半段。",
    "  · 字数按整篇算：前半段已经写掉的字数计入总量，本轮只补足剩下的部分，不要把整篇的字数重新写一遍。",
    "  · 正文写到该收的地方就自然收尾，写完即停；这一篇没写完就不要停。",
  ];

  if (ctx.request) {
    lines.push(
      "",
      "上一回合用户的需求原文（本轮继续为它服务，约束一字不变）：",
      ctx.request,
    );
  }

  if (ctx.tail) {
    lines.push(
      "",
      ctx.tailOnly
        ? "上一条正文的结尾片段（前面还有已写好的部分，都在对话历史里；请从下面这段的最后一个字接着写）："
        : "上一条已经写出来的正文（请从它的最后一个字接着写）：",
      "  ---",
      ctx.tail,
      "  ---",
    );
  }

  return lines;
}

/* ---------------- 系统提示词注入 ---------------- */

/** 身份模板是否还挂在「对话」知识项里（用户可能把它移除或关掉了自动加载）。
    导出给界面用：挂载与否决定模板走「工具现读」还是「内置副本兜底」，
    这件事值得在告知条上如实呈现。 */
export function identityTemplateMounted(): boolean {
  const bare = IDENTITY_TEMPLATE_FILE.replace(/\.md$/i, "");
  return aiSettings.chatKnowledge.some(
    (f) => f.name === IDENTITY_TEMPLATE_FILE || f.name.replace(/\.md$/i, "") === bare,
  );
}

/** 知识项被摘掉时的兜底：直接拿内置的那份模板正文顶上。 */
function identityTemplateText(): string {
  return BUNDLED_CHAT_KNOWLEDGE.find((k) => k.name === IDENTITY_TEMPLATE_FILE)?.content ?? "";
}

/**
 * 新「联动」块：用户同时选了素材库 / 叙事定制 / 故事定制时，把这些定制项
 * 嵌入「自主研判」，让 AI 在分析身份槽位时就把它们一并考虑进去。
 *
 * 保证「不破坏现有流程」：
 *  - 只选身份模板（integration 为空）→ 不加这块，走原流程；
 *  - 只选素材库/叙事/故事、不选身份模板 → 根本不进这里，走既有注入；
 *  - 两者都选 → 身份模板 + 联动定制一起思考分析。
 */
function identityTemplateIntegration(
  hit: SlashCommandHit,
  integration: string,
  body = hit.body,
): string[] {
  if (!integration.trim() || !body) return [];
  return [
    "",
    "【本轮联动定制 · 用户还选中了下面这些项，必须与身份模板结合分析】",
    integration,
    "  联动规则：素材库提供正文的内容与细节来源（化用吸收，不得整段照搬原文）；",
    "  叙事定制、故事定制是表达方式与人物/情节设定的硬性约束。上面的「自主研判」要把它们一并纳入——",
    "  槽位研判时把这些定制项当作已经确定的输入来对齐，创作时按定制项定下的语气、节奏、视角与设定来写。",
    "  下面的输出纪律不因联动而放宽。",
  ];
}

/** 身份模板模式：让模型先读模板，再扮演身份，最后只交正文。 */
function identityTemplateDirective(
  hit: SlashCommandHit,
  integration = "",
  continuation?: ContinuationContext,
): string {
  const file = hit.command.knowledgeFile;
  /* 续写回合里，用户这句话只是「继续」，真正的需求在上一回合。 */
  const body = continuation ? continuation.request || hit.body : hit.body;

  /* 知识项在 → 让模型自己用工具去读（省 token、改 md 不用改代码）；
     知识项被用户摘了 → 就地把内置模板贴进提示词，功能照样成立。 */
  const readStep = identityTemplateMounted()
    ? [
        "第一步 · 读模板",
        `  1. 先调用 read_knowledge 读取知识项「${file}」，把 7 条填空和「注意事项」两节完整看完。`,
        "  2. 若该知识项确实读不到，再退回按你已知的身份模板结构推断，不要因此中止创作，也不要向用户报错。",
        "  3. 若本轮会话前面已经读过它，直接沿用上下文里的记忆，不要重复调用工具。",
      ]
    : [
        "第一步 · 读模板",
        "  当前会话没有挂载该知识项，模板正文直接给你贴在下面。它只是你的工作依据，一个字都不许出现在回复里。",
        "  ---",
        identityTemplateText(),
        "  ---",
      ];

  const lines = [
    continuation
      ? "【创作模式：身份模板 · 接着上一回写】本轮仍在身份模板创作状态里，用户要的是把上一回没写完的正文接着写完，本轮不是闲聊、也不是重新开一篇。请严格按下面的流程走。"
      : "【创作模式：身份模板】用户本轮用 `/身份模板` 指令显式进入了写作状态，本轮不是闲聊。请严格按下面的流程走。",
    "",
    ...readStep,
    "",
    "第二步 · 自主研判并补全身份（关键前提）",
    continuation
      ? "  0. 【续写回合】身份槽位在上一回合已经研判定好了，本轮不要重新推一遍、也不要换设定：直接沿用上下文里那一套说话者身份 / 接受者身份 / 语气 / 情绪基调 / 体裁。下面这几条是当时的研判依据，仅供你对齐，不要输出。"
      : "  0. 【先记住这条】用户只给少量信息才是常态，绝大多数人只会丢一句需求（例如「纯萌新刚写5万字，男主给女主送早餐的校园场景，帮我写300字贼甜的互动」，或者「小红书发新款相机，150字，亮点如下……」）。信息少不构成任何障碍，也不是错误：模板的价值在于让你**自己把空缺推满**，而不是让用户去填表。所以——",
    "     · 绝不因为信息少就拒绝、就降级、就敷衍；",
    "     · 绝不反问用户、绝不列「待确认项」、绝不写「建议你补充…」；",
    "     · 绝不把推断结果摆出来跟用户对账，推断只在你心里完成。",
    "  1. 把用户这段话里的信息逐条对齐到模板的各个槽位：说话者身份 / 社会角色 / 文化背景 / 性格特质 / 专业视角 / 价值观取向 / 接受者身份 / 表达目的 / 时间背景 / 经验等级 / 语境场景 / 内容类型。",
    "  2. 空着的槽位由你研判补齐，依据是用户已经透露的线索，按「最可能、最贴合」的那一种定下来，一次定死，不要在正文里保留多种可能。可用的推断线索举例：",
    "     · 平台 / 载体 → 接受者身份、语气、篇幅节奏（小红书=年轻消费者、口语、短句多段；追更粉丝=网文读者、要爽点要钩子；朋友圈=熟人、随手感）；",
    "     · 题材与场景 → 说话者身份、文化背景（校园甜宠=学生视角；测评=用过实物的普通用户视角）；",
    "     · 「萌新 / 刚写5万字 / 老手」→ 经验等级，进而决定用词的老练度与技法密度；",
    "     · 「贼甜 / 虐 / 燃 / 治愈」→ 情绪与价值观取向；",
    "     · 没有任何线索时，就取该体裁下最主流的那一档设定，别往冷门里钻。",
    "  3. 重点抓住第 7 条那「三件宝」——场景、字数、情绪。字数按用户给的数目控制在 ±10% 以内；情绪基调贯穿全篇；场景里的物件、动作、时间感都要落到实处。字数没给就按体裁常规长度自己定（如小红书 150～300 字、网文片段 300～800 字）。",
    "  4. 站在「接受者身份」的位置反推：他为什么会读下去、哪一句是他的爽点、哪一句会让他划走。按这个来排段落顺序和信息密度。",
    "  5. 模板不限体裁。小说片段、种草文案、朋友圈、演讲稿、私信、公告都照这套走，「内容类型」跟着用户的需求变，不要一律往小说上套。",
    "",
    "第三步 · 套用身份扮演创作",
    "  1. 完全成为那个身份说话：他的口头习惯、知识边界、在意的东西、看不上的东西，都要在字里行间显出来。不要用旁观者的口气去描述这个身份。",
    "  2. 照做模板「注意事项」里的三条：加入适量人味噪点（轻微犹豫、自我修正、吐槽、感叹、不完全对称的句式）；允许鲜明的个人立场与情绪色彩，但不攻击、不极端、不失真；打散一切八股结构，句长错落，按真实说话与阅读的节奏走，不要「总—分—总」、不要并列三项、不要空洞的排比收尾。",
    "  3. 事实要站得住，人名数字不许编。虚构故事里的人物与场景细节不受此限。",
    "",
    ...identityTemplateIntegration(hit, integration, body),
    "第四步 · 输出纪律（最重要，违反即算本轮失败）",
    "  1. 只输出成品正文，一个字的多余内容都不要。",
    "  2. 绝对禁止输出：身份模板的任何原文或改写、槽位对照表、你的分析推理过程、创作思路说明、「以下是……」之类的开场话、标题、前言、后记、字数统计、修改建议、请用户确认的问句、任何括号里的注释。",
    "  3. 不要用 Markdown 标题、加粗、列表把正文包装起来——除非用户要的本来就是列表体裁。正文该是什么样就是什么样。",
    "  4. 结尾不做总结、不升华、不喊口号，写完最后一句就停。",
    "  5. 正文必须一次写完整：不许写到一半自己停下来问「要不要继续」，也不许留「（未完待续）」「后续……」之类的占位。万一确实被外部长度上限截断了，系统会自动让你接着写，你到时候只需从断点续上，不要重开头。",
  ];

  if (continuation) {
    lines.push(...continuationRules(continuation));
    return lines.join("\n");
  }

  if (!body) {
    lines.push(
      "",
      "第五步 · 本轮特殊情况",
      "  用户只打了指令、连一句需求都没写，没有任何可供研判的线索。这种情况下不要凭空开写，也不要把模板原文贴给用户；只用一句自然的话，请他说一下「写什么场景 / 大概多少字 / 什么情绪」，然后停下等他回话。（注意：只要用户给了任意一点点信息，就不走这一步，直接按第二步自行研判补齐并开写。）",
    );
  } else {
    lines.push(
      "",
      "本轮用户的需求原文（已摘掉指令词）：",
      body,
      "",
      "这段需求里没写到的身份信息，一律按第二步自行研判定下来，然后直接交正文。不要因为它「不完整」而追问或降级。",
    );
  }

  return lines.join("\n");
}

/** 命中的指令要追加到系统提示词里的内容。未命中返回空串。
    integration：素材库 / 叙事定制 / 故事定制等本轮联动项的可读清单，可留空。
    continuation：本轮是「接着上一回写」时的断点上下文，可留空。 */
export function slashCommandDirective(
  hit: SlashCommandHit | null,
  integration = "",
  continuation?: ContinuationContext,
): string {
  if (!hit) return "";
  if (hit.command.id === IDENTITY_TEMPLATE_COMMAND.id) {
    return identityTemplateDirective(hit, integration, continuation);
  }
  return "";
}

/**
 * 没走创作指令、但用户要求「接着上一回写」时的注入块。
 *
 * 与 CHAT_CASUAL_GUARD 互斥：日常对话里 AI 也会被长度上限截断，这时候仍要
 * 保证「接着写」能接上，而不是被日常对话守则按住重新组织一段话。
 */
export function chatContinuationDirective(ctx: ContinuationContext): string {
  return [
    "【当前为续写模式】用户本轮没有使用 / 创作指令，但明确要求接着上一条没写完的回复继续。请照下面的规则接上去，不要把它当成一个新问题重新作答。",
    ...continuationRules(ctx),
  ].join("\n");
}

/**
 * 没命中任何指令时的兜底说明。
 *
 * 「对话」标签页挂了知识项之后，模型会看到知识项目录；这行字负责把它按住，
 * 让日常闲聊仍旧是日常闲聊，不会动不动就去翻知识项。
 */
export const CHAT_CASUAL_GUARD =
  "【当前为日常对话模式】用户本轮没有使用任何 / 创作指令。请按常规智能助手的方式把话答清楚：不要调用知识项工具去翻阅写作规范，不要自行进入长篇创作或身份扮演状态，也不要提及有哪些创作指令可用（除非用户主动问起）。";
