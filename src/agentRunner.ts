import type { ToolDefinition } from "./knowledgeTools";
import type { ApiType } from "./settings";

/**
 * Protocol-agnostic tool-calling agent loop.
 *
 * Four wire formats are supported, selected by `apiType` rather than by
 * provider name (a relay may speak OpenAI Completions while serving Claude):
 *
 *   openai-completions  POST {base}/chat/completions
 *   openai-responses    POST {base}/responses
 *   anthropic-messages  POST {base}/messages
 *   google-generative   POST {base}/models/{model}:generateContent
 *
 * Each is implemented in both streaming and single-shot mode with function
 * calling. Tool calls are executed locally and fed back to the model until it
 * produces a final text answer or `maxRounds` is exhausted.
 */

export type AgentRole = "user" | "assistant";

export interface AgentTurn {
  role: AgentRole;
  content: string;
}

export interface ToolInvocation {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentRunOptions {
  provider: string;
  /** Wire protocol. Defaults to openai-completions when omitted. */
  apiType?: ApiType;
  apiKey: string;
  url: string;
  model: string;
  systemPrompt: string;
  messages: AgentTurn[];
  tools?: ToolDefinition[];
  executeTool?: (name: string, args: Record<string, unknown>) => string | Promise<string>;
  maxRounds?: number;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /**
   * 正文被输出长度上限截断时，自动追加多少次「接着写」请求。
   *
   * 默认 0（关闭），精修、行内改写这些单轮场景保持原样。对话侧传入正数即可
   * 获得「一个回合内把正文写完」的保底：每次续写都把已写出的正文作为
   * assistant 轮回放，再补一条续写指令，模型因此能看到断点上下文。
   */
  autoContinue?: number;
  /**
   * 兜底判定：协议没报截断，但正文看起来还没写完（中转接口常常不回传
   * finish_reason）。返回 true 时同样会追加续写请求。
   */
  needsContinuation?: (text: string) => boolean;
  /** 自动续写时补给模型的那条 user 指令。留空用内置的通用续写指令。 */
  continueDirective?: string;
  /** 每次自动续写时通知调用方（用于界面提示「正在接着写」）。 */
  onAutoContinue?: (attempt: number) => void;
  onChunk?: (fullText: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (call: ToolInvocation) => void;
  onToolResult?: (call: ToolInvocation, result: string) => void;
}

export interface AgentRunResult {
  text: string;
  reasoning: string;
  tokens: number;
  rounds: number;
  toolCalls: number;
  /**
   * 本次回复是否因为「输出长度上限」被截断（正文没写完就停了）。
   *
   * 四种协议各有各的说法：OpenAI 的 finish_reason=length、Anthropic 的
   * stop_reason=max_tokens、Responses 的 status=incomplete、Gemini 的
   * finishReason=MAX_TOKENS。这里统一归一成一个布尔量，调用方据此决定
   * 是否自动接着写下去，而不是把半截正文当成完成品交出去。
   */
  truncated: boolean;
}

/* ---------------- endpoint resolution ---------------- */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Append `path` unless the configured base URL already ends with it. */
function joinApiPath(base: string, path: string): string {
  const clean = trimSlash(base);
  if (!clean) return path;
  if (clean.endsWith(path)) return clean;
  return `${clean}${path}`;
}

/** Base URL fallbacks, used when the user left the URL field blank. */
const DEFAULT_BASES: Record<string, string> = {
  OpenAI: "https://api.openai.com/v1",
  DeepSeek: "https://api.deepseek.com/v1",
  Anthropic: "https://api.anthropic.com/v1",
  Google: "https://generativelanguage.googleapis.com/v1beta",
};

export interface ResolvedEndpoint {
  apiUrl: string;
  headers: Record<string, string>;
}

/**
 * Build the request URL for a protocol.
 *
 * `model` is only needed by Google, whose model name is part of the path.
 * `stream` selects Google's streaming variant.
 */
export function resolveEndpoint(
  apiType: ApiType,
  provider: string,
  url: string,
  model = "",
  stream = false,
): ResolvedEndpoint | null {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const base = trimSlash(url) || DEFAULT_BASES[provider] || "";

  if (apiType === "openai-completions") {
    if (!base) return null;
    return { apiUrl: joinApiPath(base, "/chat/completions"), headers };
  }
  if (apiType === "openai-responses") {
    if (!base) return null;
    return { apiUrl: joinApiPath(base, "/responses"), headers };
  }
  if (apiType === "anthropic-messages") {
    if (!base) return null;
    return { apiUrl: joinApiPath(base, "/messages"), headers };
  }
  if (apiType === "google-generative") {
    if (!base || !model) return null;
    const verb = stream ? "streamGenerateContent" : "generateContent";
    const query = stream ? "?alt=sse" : "";
    return { apiUrl: `${base}/models/${encodeURIComponent(model)}:${verb}${query}`, headers };
  }
  return null;
}

function authHeaders(apiType: ApiType, apiKey: string): Record<string, string> {
  if (apiType === "anthropic-messages") {
    return {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      /* Required so the browser/WebView is allowed to talk to Anthropic. */
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  if (apiType === "google-generative") {
    /* Header form avoids leaking the key into URLs / logs. */
    return { "x-goog-api-key": apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

/* ---------------- payload shapes ---------------- */

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicBlock[] };

/* ---- OpenAI Responses ---- */

type ResponsesItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

/* ---- Google Generative AI ---- */

type GooglePart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: string } } };

type GoogleContent = { role: "user" | "model"; parts: GooglePart[] };

function toOpenAiTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Responses API flattens the function descriptor (no nested `function` key). */
function toResponsesTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/**
 * Gemini rejects JSON-Schema keywords it does not know, so the schema is
 * reduced to the subset it accepts.
 */
function sanitizeGoogleSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeGoogleSchema);

  const allowed = new Set([
    "type",
    "format",
    "description",
    "nullable",
    "enum",
    "items",
    "properties",
    "required",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (key === "type" && typeof value === "string") {
      /* Gemini expects upper-case type names. */
      out.type = value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = sanitizeGoogleSchema(pv);
      }
      out.properties = props;
    } else if (key === "items") {
      out.items = sanitizeGoogleSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toGoogleTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeGoogleSchema(t.parameters),
      })),
    },
  ];
}

function parseArgs(raw: string): Record<string, unknown> {
  const text = raw?.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    /* Some models emit `{"name": "x"}{"name": "y"}` or trailing junk. */
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

function usageTokens(data: unknown): number {
  const record = data as Record<string, unknown> | null;
  const usage = (record?.usage ?? record?.usageMetadata) as Record<string, number> | undefined;
  if (!usage) return 0;
  if (typeof usage.total_tokens === "number") return usage.total_tokens;
  if (typeof usage.totalTokenCount === "number") return usage.totalTokenCount;
  const input = usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0;
  return input + output;
}

/* ---------------- SSE helper ---------------- */

async function readSse(
  response: Response,
  onEvent: (payload: unknown) => void,
): Promise<void> {
  if (!response.body) throw new Error("当前运行环境不支持流式读取");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        /* ignore malformed SSE frames */
      }
    }
  }
}

/* ---------------- one round ---------------- */

interface RoundResult {
  text: string;
  /** Model's chain-of-thought / reasoning, kept separate from the visible answer. */
  reasoning?: string;
  toolCalls: ToolInvocation[];
  tokens: number;
  /** 本轮是否因输出长度上限被截断（各协议的 length / max_tokens / incomplete）。 */
  truncated?: boolean;
  /** Raw assistant payload, replayed verbatim in the next request. */
  rawOpenAiToolCalls?: OpenAiToolCall[];
  rawAnthropicBlocks?: AnthropicBlock[];
  /** Function-call items to replay for the Responses protocol. */
  rawResponsesCalls?: Extract<ResponsesItem, { type: "function_call" }>[];
  /** Model parts to replay for Gemini. */
  rawGoogleParts?: GooglePart[];
}

/** 各协议表示「因长度上限而截断」的取值，统一归一成布尔量。 */
function isLengthStop(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  const r = reason.toLowerCase();
  return (
    r === "length" ||
    r === "max_tokens" ||
    r === "max_output_tokens" ||
    r === "maxtokens" ||
    r === "model_length" ||
    r.includes("max_tokens") ||
    r.includes("max_output")
  );
}

async function runOpenAiRound(
  opts: AgentRunOptions,
  apiUrl: string,
  headers: Record<string, string>,
  messages: OpenAiMessage[],
  baseText: string,
  baseReasoning: string,
): Promise<RoundResult> {
  const useStream = opts.stream !== false;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (useStream) body.stream = true;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = toOpenAiTools(opts.tools);
    body.tool_choice = "auto";
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    throw new Error(`API 错误 (${response.status}): ${await response.text()}`);
  }

  if (!useStream) {
    const data = await response.json();
    const choice = data?.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const rawCalls: OpenAiToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const text = typeof message.content === "string" ? message.content : "";
    const reasoning =
      (typeof message.reasoning_content === "string" ? message.reasoning_content : null) ??
      (typeof message.reasoning === "string" ? message.reasoning : null) ??
      "";
    if (text) opts.onChunk?.(baseText + text);
    if (reasoning) opts.onReasoning?.(baseReasoning + reasoning);
    return {
      text,
      reasoning,
      tokens: usageTokens(data),
      truncated: isLengthStop(choice.finish_reason ?? choice.finishReason),
      toolCalls: rawCalls.map((c) => ({
        id: c.id,
        name: c.function?.name ?? "",
        args: parseArgs(c.function?.arguments ?? ""),
      })),
      rawOpenAiToolCalls: rawCalls.length > 0 ? rawCalls : undefined,
    };
  }

  let text = "";
  let reasoning = "";
  let tokens = 0;
  let truncated = false;
  /* tool_calls arrive as indexed deltas that must be concatenated. */
  const acc = new Map<number, { id: string; name: string; args: string }>();

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    /* Some relays/Agent Router buffer the whole completion and reply with plain
       JSON even when `stream: true` was requested. Parse it like a non-stream. */
    const data = await response.json();
    const choice = data?.choices?.[0] ?? {};
    const message = choice.message ?? {};
    tokens = usageTokens(data);
    text = typeof message.content === "string" ? message.content : "";
    reasoning =
      (typeof message.reasoning_content === "string" ? message.reasoning_content : null) ??
      (typeof message.reasoning === "string" ? message.reasoning : null) ??
      "";
    if (text) opts.onChunk?.(baseText + text);
    if (reasoning) opts.onReasoning?.(baseReasoning + reasoning);
    truncated = isLengthStop(choice.finish_reason ?? choice.finishReason);
    for (const call of (Array.isArray(message.tool_calls) ? message.tool_calls : []) as OpenAiToolCall[]) {
      acc.set(acc.size, { id: call.id ?? "", name: call.function?.name ?? "", args: call.function?.arguments ?? "" });
    }
  } else {
  await readSse(response, (payload) => {
    const parsed = payload as {
      usage?: Record<string, number>;
      choices?: {
        finish_reason?: string | null;
        finishReason?: string | null;
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          thought?: string | null;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
        text?: string | null;
      }[];
    };

    if (parsed.usage) tokens = usageTokens(parsed);

    const choice = parsed.choices?.[0];
    if (!choice) return;

    /* 截断信号只在最后一帧出现，出现即记住（后续帧不会把它清掉）。 */
    if (isLengthStop(choice.finish_reason ?? choice.finishReason)) truncated = true;

    const delta = (choice.delta ?? choice.message ?? {}) as {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      thought?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };

    /* 正文：仅 content / choice.text；思考过程单独进入 reasoning。 */
    const contentChunk =
      (typeof delta?.content === "string" ? delta.content : null) ??
      (typeof choice.text === "string" ? choice.text : null);
    if (contentChunk && contentChunk.length > 0) {
      text += contentChunk;
      opts.onChunk?.(baseText + text);
    }

    const reasonChunk =
      (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : null) ??
      (typeof delta?.reasoning === "string" ? delta.reasoning : null) ??
      (typeof delta?.thought === "string" ? delta.thought : null);
    if (reasonChunk && reasonChunk.length > 0) {
      reasoning += reasonChunk;
      opts.onReasoning?.(baseReasoning + reasoning);
    }

    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const entry = acc.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.args += call.function.arguments;
      acc.set(index, entry);
    }
  });
  }

  const ordered = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const rawCalls: OpenAiToolCall[] = ordered.map((entry, i) => ({
    id: entry.id || `call_${Date.now()}_${i}`,
    type: "function",
    function: { name: entry.name, arguments: entry.args },
  }));

  return {
    text,
    reasoning,
    tokens,
    truncated,
    toolCalls: rawCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      args: parseArgs(c.function.arguments),
    })),
    rawOpenAiToolCalls: rawCalls.length > 0 ? rawCalls : undefined,
  };
}

async function runAnthropicRound(
  opts: AgentRunOptions,
  apiUrl: string,
  headers: Record<string, string>,
  messages: AnthropicMessage[],
  baseText: string,
  baseReasoning: string,
): Promise<RoundResult> {
  const useStream = opts.stream !== false;
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt,
    messages,
  };
  if (useStream) body.stream = true;
  if (opts.tools && opts.tools.length > 0) body.tools = toAnthropicTools(opts.tools);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    throw new Error(`API 错误 (${response.status}): ${await response.text()}`);
  }

  if (!useStream) {
    const data = await response.json();
    const blocks: AnthropicBlock[] = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    const reasoning = blocks
      .filter((b): b is { type: "thinking"; thinking: string } => b.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking)
      .join("");
    if (text) opts.onChunk?.(baseText + text);
    if (reasoning) opts.onReasoning?.(baseReasoning + reasoning);
    const toolUses = blocks.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use",
    );
    return {
      text,
      reasoning,
      tokens: usageTokens(data),
      truncated: isLengthStop(data?.stop_reason),
      toolCalls: toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
      rawAnthropicBlocks: blocks.length > 0 ? blocks : undefined,
    };
  }

  let text = "";
  let reasoning = "";
  let tokens = 0;
  let truncated = false;
  const blocks: AnthropicBlock[] = [];
  /* index -> partial tool_use json */
  const pendingJson = new Map<number, string>();

  await readSse(response, (payload) => {
    const evt = payload as {
      type?: string;
      index?: number;
      usage?: Record<string, number>;
      message?: { usage?: Record<string, number>; stop_reason?: string | null };
      content_block?: { type?: string; id?: string; name?: string; text?: string };
      delta?: {
        type?: string;
        text?: string;
        partial_json?: string;
        thinking?: string;
        stop_reason?: string | null;
      };
    };

    if (evt.type === "message_start" && evt.message?.usage) {
      tokens += usageTokens(evt.message);
    }
    if (evt.type === "message_delta" && evt.usage) {
      tokens += usageTokens(evt);
    }
    /* Anthropic 把终止原因放在 message_delta.delta.stop_reason。 */
    if (isLengthStop(evt.delta?.stop_reason) || isLengthStop(evt.message?.stop_reason)) {
      truncated = true;
    }

    if (evt.type === "content_block_start" && evt.content_block) {
      const index = evt.index ?? blocks.length;
      if (evt.content_block.type === "text") {
        blocks[index] = { type: "text", text: evt.content_block.text ?? "" };
      } else if (evt.content_block.type === "tool_use") {
        blocks[index] = {
          type: "tool_use",
          id: evt.content_block.id ?? `toolu_${Date.now()}_${index}`,
          name: evt.content_block.name ?? "",
          input: {},
        };
        pendingJson.set(index, "");
      }
      return;
    }

    if (evt.type === "content_block_delta") {
      const index = evt.index ?? 0;
      if (evt.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
        text += evt.delta.text;
        const block = blocks[index];
        if (block && block.type === "text") block.text += evt.delta.text;
        opts.onChunk?.(baseText + text);
      } else if (evt.delta?.type === "thinking_delta" && typeof evt.delta.thinking === "string") {
        reasoning += evt.delta.thinking;
        opts.onReasoning?.(baseReasoning + reasoning);
      } else if (evt.delta?.type === "input_json_delta" && typeof evt.delta.partial_json === "string") {
        pendingJson.set(index, (pendingJson.get(index) ?? "") + evt.delta.partial_json);
      }
      return;
    }

    if (evt.type === "content_block_stop") {
      const index = evt.index ?? 0;
      const block = blocks[index];
      if (block && block.type === "tool_use") {
        block.input = parseArgs(pendingJson.get(index) ?? "");
      }
    }
  });

  const compact = blocks.filter(Boolean);
  const toolUses = compact.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      b.type === "tool_use",
  );

  return {
    text,
    reasoning,
    tokens,
    truncated,
    toolCalls: toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
    rawAnthropicBlocks: compact.length > 0 ? compact : undefined,
  };
}

/* ---------------- OpenAI Responses ---------------- */

async function runResponsesRound(
  opts: AgentRunOptions,
  apiUrl: string,
  headers: Record<string, string>,
  input: ResponsesItem[],
  baseText: string,
  baseReasoning: string,
): Promise<RoundResult> {
  const useStream = opts.stream !== false;
  const body: Record<string, unknown> = {
    model: opts.model,
    /* Responses takes the system prompt as a top-level instruction. */
    instructions: opts.systemPrompt,
    input,
    temperature: opts.temperature ?? 0.7,
  };
  if (useStream) body.stream = true;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = toResponsesTools(opts.tools);
    body.tool_choice = "auto";
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    throw new Error(`API 错误 (${response.status}): ${await response.text()}`);
  }

  type FnCall = Extract<ResponsesItem, { type: "function_call" }>;

  /** Pull text / reasoning / function calls out of a completed `response.output`. */
  function harvest(output: unknown[]): { text: string; reasoning: string; calls: FnCall[] } {
    let text = "";
    let reasoning = "";
    const calls: FnCall[] = [];
    for (const item of output) {
      const it = item as Record<string, unknown>;
      if (it.type === "message" && Array.isArray(it.content)) {
        for (const part of it.content as Record<string, unknown>[]) {
          if (typeof part.text === "string") text += part.text;
        }
      } else if (it.type === "output_text" && typeof it.text === "string") {
        text += it.text;
      } else if (it.type === "reasoning" && Array.isArray(it.summary)) {
        for (const seg of it.summary as Record<string, unknown>[]) {
          if (typeof seg.text === "string") reasoning += seg.text;
        }
      } else if (it.type === "function_call") {
        calls.push({
          type: "function_call",
          call_id: String(it.call_id ?? it.id ?? ""),
          name: String(it.name ?? ""),
          arguments: String(it.arguments ?? ""),
        });
      }
    }
    return { text, reasoning, calls };
  }

  /** Responses 的截断信号：status=incomplete + incomplete_details.reason。 */
  function responsesTruncated(payload: unknown): boolean {
    const r = payload as
      | { status?: string; incomplete_details?: { reason?: string } | null }
      | null
      | undefined;
    if (!r) return false;
    if (isLengthStop(r.incomplete_details?.reason)) return true;
    return r.status === "incomplete";
  }

  if (!useStream) {
    const data = await response.json();
    const output: unknown[] = Array.isArray(data?.output) ? data.output : [];
    const { text, reasoning, calls } = harvest(output);
    if (text) opts.onChunk?.(baseText + text);
    if (reasoning) opts.onReasoning?.(baseReasoning + reasoning);
    return {
      text,
      reasoning,
      tokens: usageTokens(data),
      truncated: responsesTruncated(data),
      toolCalls: calls.map((c) => ({ id: c.call_id, name: c.name, args: parseArgs(c.arguments) })),
      rawResponsesCalls: calls.length > 0 ? calls : undefined,
    };
  }

  let text = "";
  let reasoning = "";
  let tokens = 0;
  let truncated = false;
  /* output_index -> partial function call */
  const acc = new Map<number, { callId: string; name: string; args: string }>();
  let finalOutput: unknown[] | null = null;

  await readSse(response, (payload) => {
    const evt = payload as {
      type?: string;
      delta?: string;
      output_index?: number;
      item?: Record<string, unknown>;
      response?: {
        output?: unknown[];
        usage?: Record<string, number>;
        status?: string;
        incomplete_details?: { reason?: string } | null;
      };
    };

    if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
      text += evt.delta;
      opts.onChunk?.(baseText + text);
      return;
    }

    if (evt.type === "response.reasoning_summary_text.delta" && typeof evt.delta === "string") {
      reasoning += evt.delta;
      opts.onReasoning?.(baseReasoning + reasoning);
      return;
    }

    if (evt.type === "response.output_item.added" && evt.item?.type === "function_call") {
      acc.set(evt.output_index ?? acc.size, {
        callId: String(evt.item.call_id ?? evt.item.id ?? ""),
        name: String(evt.item.name ?? ""),
        args: "",
      });
      return;
    }

    if (evt.type === "response.function_call_arguments.delta" && typeof evt.delta === "string") {
      const index = evt.output_index ?? 0;
      const entry = acc.get(index) ?? { callId: "", name: "", args: "" };
      entry.args += evt.delta;
      acc.set(index, entry);
      return;
    }

    if (evt.type === "response.completed" || evt.type === "response.incomplete") {
      if (evt.response?.usage) tokens = usageTokens(evt.response);
      if (Array.isArray(evt.response?.output)) finalOutput = evt.response.output;
      if (evt.type === "response.incomplete" || responsesTruncated(evt.response)) truncated = true;
    }
  });

  /* Prefer the authoritative final payload; fall back to the streamed deltas. */
  if (finalOutput) {
    const { text: finalText, reasoning: finalReasoning, calls } = harvest(finalOutput);
    if (finalText && !text) {
      text = finalText;
      opts.onChunk?.(baseText + text);
    }
    if (finalReasoning && !reasoning) {
      reasoning = finalReasoning;
      opts.onReasoning?.(baseReasoning + reasoning);
    }
    if (calls.length > 0) {
      return {
        text,
        reasoning,
        tokens,
        truncated,
        toolCalls: calls.map((c) => ({ id: c.call_id, name: c.name, args: parseArgs(c.arguments) })),
        rawResponsesCalls: calls,
      };
    }
  }

  const calls: FnCall[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      type: "function_call" as const,
      call_id: v.callId || `call_${Date.now()}_${i}`,
      name: v.name,
      arguments: v.args,
    }))
    .filter((c) => c.name);

  return {
    text,
    reasoning,
    tokens,
    truncated,
    toolCalls: calls.map((c) => ({ id: c.call_id, name: c.name, args: parseArgs(c.arguments) })),
    rawResponsesCalls: calls.length > 0 ? calls : undefined,
  };
}

/* ---------------- Google Generative AI ---------------- */

async function runGoogleRound(
  opts: AgentRunOptions,
  apiUrl: string,
  headers: Record<string, string>,
  contents: GoogleContent[],
  baseText: string,
  baseReasoning: string,
): Promise<RoundResult> {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 4096,
    },
  };
  if (opts.systemPrompt) {
    body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = toGoogleTools(opts.tools);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    throw new Error(`API 错误 (${response.status}): ${await response.text()}`);
  }

  const useStream = opts.stream !== false;
  let text = "";
  let reasoning = "";
  let tokens = 0;
  let truncated = false;
  const parts: GooglePart[] = [];

  function absorb(payloadParts: unknown[]) {
    for (const raw of payloadParts) {
      const part = raw as Record<string, unknown>;
      /* Gemini marks chain-of-thought chunks with `thought: true`. */
      if (typeof part.text === "string" && part.text.length > 0) {
        if (part.thought === true) {
          reasoning += part.text;
          opts.onReasoning?.(baseReasoning + reasoning);
        } else {
          text += part.text;
          parts.push({ text: part.text });
          opts.onChunk?.(baseText + text);
        }
      } else if (part.functionCall && typeof part.functionCall === "object") {
        const fc = part.functionCall as { name?: string; args?: Record<string, unknown> };
        parts.push({ functionCall: { name: fc.name ?? "", args: fc.args ?? {} } });
      }
    }
  }

  if (!useStream) {
    const data = await response.json();
    tokens = usageTokens(data);
    if (isLengthStop(data?.candidates?.[0]?.finishReason)) truncated = true;
    const candidateParts = data?.candidates?.[0]?.content?.parts;
    if (Array.isArray(candidateParts)) absorb(candidateParts);
  } else {
    await readSse(response, (payload) => {
      const evt = payload as {
        candidates?: { content?: { parts?: unknown[] }; finishReason?: string | null }[];
        usageMetadata?: Record<string, number>;
      };
      if (evt.usageMetadata) tokens = usageTokens(evt);
      if (isLengthStop(evt.candidates?.[0]?.finishReason)) truncated = true;
      const candidateParts = evt.candidates?.[0]?.content?.parts;
      if (Array.isArray(candidateParts)) absorb(candidateParts);
    });
  }

  const calls = parts
    .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p)
    .map((p, i) => ({
      /* Gemini has no call ids; synthesise one for our own bookkeeping. */
      id: `${p.functionCall.name}_${i}`,
      name: p.functionCall.name,
      args: p.functionCall.args ?? {},
    }));

  return {
    text,
    reasoning,
    tokens,
    truncated,
    toolCalls: calls,
    rawGoogleParts: parts.length > 0 ? parts : undefined,
  };
}

/* ---------------- public entry point ---------------- */

/**
 * 自动续写时补给模型的默认指令。
 *
 * 关键是三件事：说清「上一条是被长度上限截断的半截正文」、要求「从断点的下一个
 * 字接着写」、明令「不要重开头、不要复述、不要道歉」。否则模型极容易从头再来
 * 或者插一段「好的，我继续」。
 */
const DEFAULT_CONTINUE_DIRECTIVE =
  "【接着写 · 系统自动触发】你上一条回复是正文写到中途被输出长度上限硬性截断的，不是写完了。请紧接着那句话的最后一个字继续往下写，把这一篇正文完整写完。\n" +
  "  · 从断点无缝续上：上一条末尾若断在半句、半个词甚至半个标点里，就从那个位置接着补完，不要另起一句。\n" +
  "  · 不要重写开头、不要复述或总结前面已经写过的内容、不要换个说法把前文再讲一遍。\n" +
  "  · 不要出现「继续」「接上文」「好的」「抱歉」这类交代话，也不要加分隔线、小标题、序号或任何括注。\n" +
  "  · 本轮的身份、语气、人称、时态、格式、字数目标与前面完全一致，当成同一次落笔的后半段。\n" +
  "  · 正文写到该收的地方就自然收尾，写完即停。";

/** 模型续写时常见的交代性开场，出现在开头就整行剔掉。 */
const CONTINUE_FILLER_RE =
  /^\s*(?:(?:好的|好|okay|ok|sure)?[，,、。.:：]?\s*)?(?:我?(?:们)?(?:这就|马上|来)?(?:继续|接着(?:写|说)?|续写|接上文|承上|下面继续)[^\n]{0,12}?)[：:，,。.!！]?\s*(?:\n+|$)/i;

/**
 * 拼接续写片段：去掉模型重复的搭接文字与交代性开场。
 *
 * 模型在续写时很容易把断点前的最后一句再抄一遍（有时抄一整段）。这里取
 * 「前文尾部」与「续写开头」的最长重叠并剪掉，避免正文里出现重复句。
 * 重叠下限取 3 个字：中文里「续写开头恰好重复前文末尾 3 个字」几乎只可能是
 * 搭接重抄，且即便是刻意的顶针修辞，剪掉后读起来也比重复两遍更通顺。
 *
 * 导出仅为便于单测；正文流程只在 runAgent 内部调用。
 */
export function joinContinuation(prev: string, next: string): string {
  let tail = next.replace(/^\s+/, "");
  const filler = tail.match(CONTINUE_FILLER_RE);
  /* 只在它确实是「交代话 + 换行」时才剔除，避免误吃正文首句。 */
  if (filler && filler[0].length < tail.length) tail = tail.slice(filler[0].length);
  if (!prev) return tail;

  const limit = Math.min(400, prev.length, tail.length);
  for (let k = limit; k >= 3; k--) {
    if (prev.slice(prev.length - k) === tail.slice(0, k)) return prev + tail.slice(k);
  }
  return prev + tail;
}

/**
 * 正文是否看起来「话没说完」。
 *
 * 中转接口经常不回传 finish_reason，因此除了协议信号还需要这层形态判断。
 * 判定从严，避免把「写完了只是没打句号」误当成截断：
 *  - 短回复（提问、致歉、简短答复）一律不算；截断只会发生在输出长度上限处，
 *    那时正文必然已经很长，所以门槛取得比较高；
 *  - 以句末标点、右引号 / 右括号、破折号、代码符号、表情收尾的，算写完了；
 *  - 以话题标签（#秋日穿搭 这类小红书结尾）收尾的，算写完了；
 *  - 只有以正文字符或句中标点（逗号、顿号、分号、冒号）收尾时，才算断在半句里。
 */
const FINISHED_TAIL_RE = /[。．.！!？?…⋯”"』」）)\]】》〉>~～\-—*`_|]/u;

export function looksUnfinished(text: string): boolean {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length < 120) return false;
  /* 话题标签结尾：#xxx #yyy 是正常收尾，不是断句。 */
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  if (/#[^\s#]+$/.test(lastLine)) return false;
  const last = trimmed[trimmed.length - 1];
  if (FINISHED_TAIL_RE.test(last)) return false;
  return /[\p{L}\p{N}，,、；;：:]/u.test(last);
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const apiType: ApiType = opts.apiType ?? "openai-completions";
  const useStream = opts.stream !== false;
  const endpoint = resolveEndpoint(apiType, opts.provider, opts.url, opts.model, useStream);
  if (!endpoint) {
    throw new Error(
      apiType === "google-generative" && !opts.model
        ? "Google Generative AI 需要先选择模型。"
        : "请先在设置中填写接口 URL（AI接口设置 → URL）。",
    );
  }

  const headers = { ...endpoint.headers, ...authHeaders(apiType, opts.apiKey) };
  const maxRounds = Math.max(1, opts.maxRounds ?? 6);
  const hasTools = !!(opts.tools && opts.tools.length > 0 && opts.executeTool);

  /* Each protocol keeps its own conversation accumulator; only the active one
     is populated so tool results are replayed in the right shape. */
  const openAiMessages: OpenAiMessage[] =
    apiType === "openai-completions"
      ? [
          { role: "system", content: opts.systemPrompt },
          ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
        ]
      : [];
  const responsesInput: ResponsesItem[] =
    apiType === "openai-responses"
      ? opts.messages.map((m) => ({ type: "message" as const, role: m.role, content: m.content }))
      : [];
  const anthropicMessages: AnthropicMessage[] =
    apiType === "anthropic-messages"
      ? opts.messages.map((m) => ({ role: m.role, content: m.content }))
      : [];
  const googleContents: GoogleContent[] =
    apiType === "google-generative"
      ? opts.messages.map((m) => ({
          role: m.role === "assistant" ? ("model" as const) : ("user" as const),
          parts: [{ text: m.content }],
        }))
      : [];

  let text = "";
  let reasoning = "";
  let tokens = 0;
  let toolCallCount = 0;
  let rounds = 0;

  const autoContinueMax = Math.max(0, opts.autoContinue ?? 0);
  const continueDirective = opts.continueDirective?.trim() || DEFAULT_CONTINUE_DIRECTIVE;
  let stillTruncated = false;

  /* 外层 = 一个「回合」。第 0 个回合是正常请求（含工具循环）；若正文被输出长度
     上限截断（或形态上明显没写完），再追加续写回合，直到写完或用满 autoContinue
     次数。这样「一个对话回合」交付的是完整正文，而不是半截稿。 */
  for (let attempt = 0; ; attempt++) {
    const continuing = attempt > 0;
    /* 续写回合不再挂工具：此时要的只是把正文接着写完，避免模型又去翻知识项。 */
    const toolsThisTurn = hasTools && !continuing;
    const turnRounds = continuing ? 1 : maxRounds;
    let lastRoundText = "";
    let truncated = false;

    for (let round = 0; round < turnRounds; round++) {
      rounds++;
      /* Last round: drop the tools so the model is forced to answer. */
      const roundOpts: AgentRunOptions = continuing
        ? { ...opts, tools: undefined }
        : hasTools && round === maxRounds - 1
        ? { ...opts, tools: undefined }
        : opts;

      let result: RoundResult;
      if (apiType === "anthropic-messages") {
        result = await runAnthropicRound(roundOpts, endpoint.apiUrl, headers, anthropicMessages, text, reasoning);
      } else if (apiType === "openai-responses") {
        result = await runResponsesRound(roundOpts, endpoint.apiUrl, headers, responsesInput, text, reasoning);
      } else if (apiType === "google-generative") {
        result = await runGoogleRound(roundOpts, endpoint.apiUrl, headers, googleContents, text, reasoning);
      } else {
        result = await runOpenAiRound(roundOpts, endpoint.apiUrl, headers, openAiMessages, text, reasoning);
      }

      tokens += result.tokens;
      lastRoundText = result.text ?? "";
      truncated = !!result.truncated;
      if (result.text) {
        if (continuing && round === 0) {
          /* 续写片段要和断点无缝拼上：剪掉模型重复抄写的搭接句与「好的，我继续」。
             流式期间界面上已经按「原样追加」画过一遍，这里补发一次校正后的全文。 */
          const joined = joinContinuation(text, result.text);
          const changed = joined !== text + result.text;
          text = joined;
          if (changed) opts.onChunk?.(text);
        } else {
          text += result.text;
        }
      }
      if (result.reasoning) reasoning += result.reasoning;

      if (!toolsThisTurn || result.toolCalls.length === 0) {
        break;
      }

      /* Record the assistant turn (with its tool calls) before answering them. */
      if (apiType === "anthropic-messages") {
        anthropicMessages.push({
          role: "assistant",
          content: result.rawAnthropicBlocks ?? [{ type: "text", text: result.text }],
        });
      } else if (apiType === "openai-responses") {
        if (result.text) {
          responsesInput.push({ type: "message", role: "assistant", content: result.text });
        }
        for (const call of result.rawResponsesCalls ?? []) responsesInput.push(call);
      } else if (apiType === "google-generative") {
        googleContents.push({
          role: "model",
          parts: result.rawGoogleParts ?? [{ text: result.text }],
        });
      } else {
        openAiMessages.push({
          role: "assistant",
          content: result.text || null,
          tool_calls: result.rawOpenAiToolCalls,
        });
      }

      const anthropicResults: AnthropicBlock[] = [];
      const googleResults: GooglePart[] = [];

      for (const call of result.toolCalls) {
        toolCallCount++;
        opts.onToolCall?.(call);
        let output: string;
        try {
          output = await opts.executeTool!(call.name, call.args);
        } catch (error) {
          output = `工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
        }
        opts.onToolResult?.(call, output);

        if (apiType === "anthropic-messages") {
          anthropicResults.push({ type: "tool_result", tool_use_id: call.id, content: output });
        } else if (apiType === "openai-responses") {
          responsesInput.push({ type: "function_call_output", call_id: call.id, output });
        } else if (apiType === "google-generative") {
          googleResults.push({ functionResponse: { name: call.name, response: { result: output } } });
        } else {
          openAiMessages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
      }

      if (anthropicResults.length > 0) {
        anthropicMessages.push({ role: "user", content: anthropicResults });
      }
      if (googleResults.length > 0) {
        googleContents.push({ role: "user", parts: googleResults });
      }

      /* Separate the pre-tool prose from what comes next. */
      if (text && !text.endsWith("\n")) text += "\n";
    }

    /* 还需要接着写吗？协议信号优先，其次交给调用方的形态兜底判断。 */
    const needMore = truncated || (!!opts.needsContinuation && opts.needsContinuation(text));
    stillTruncated = needMore;
    if (!needMore) break;
    if (attempt >= autoContinueMax) break;
    if (!text.trim()) break;
    /* 续写回合一个字都没吐出来：再问下去也是空转，就此收手。 */
    if (continuing && !lastRoundText.trim()) break;

    /* 把这半截正文作为 assistant 轮回放（前面工具轮已经各自入过账，这里只补
       收尾那一轮），再补一条续写指令，让模型看得见断点上下文。 */
    const replay = lastRoundText.trim() ? lastRoundText : text;
    if (apiType === "anthropic-messages") {
      anthropicMessages.push({ role: "assistant", content: replay });
      anthropicMessages.push({ role: "user", content: continueDirective });
    } else if (apiType === "openai-responses") {
      responsesInput.push({ type: "message", role: "assistant", content: replay });
      responsesInput.push({ type: "message", role: "user", content: continueDirective });
    } else if (apiType === "google-generative") {
      googleContents.push({ role: "model", parts: [{ text: replay }] });
      googleContents.push({ role: "user", parts: [{ text: continueDirective }] });
    } else {
      openAiMessages.push({ role: "assistant", content: replay });
      openAiMessages.push({ role: "user", content: continueDirective });
    }

    opts.onAutoContinue?.(attempt + 1);
  }

  return { text, reasoning, tokens, rounds, toolCalls: toolCallCount, truncated: stillTruncated };
}
