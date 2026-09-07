from __future__ import annotations

import inspect
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from openai import AsyncOpenAI

from app.config import load_settings

THINKING_OFF = {"thinking": {"type": "disabled"}}
THINKING_ON = {"thinking": {"type": "enabled"}}

_EFFORT_MAP = {
    "low": "low",
    "medium": "high",
    "high": "high",
    "xhigh": "high",
    "max": "max",
}

OnReasoning = Callable[[str], Any | Awaitable[Any]]


class DeepSeekError(RuntimeError):
    pass


def get_client() -> AsyncOpenAI:
    cfg = load_settings()
    if not cfg.deepseek_api_key.strip():
        raise DeepSeekError("尚未配置 DeepSeek API Key，请到设置页填写。")
    return AsyncOpenAI(api_key=cfg.deepseek_api_key.strip(), base_url=cfg.deepseek_base_url)


def default_model() -> str:
    return load_settings().deepseek_model or "deepseek-v4-flash"


def normalize_effort(effort: str | None) -> str:
    return _EFFORT_MAP.get((effort or "high").strip().lower(), "high")


def thinking_kwargs(thinking: bool, effort: str | None = None) -> dict[str, Any]:
    """OpenAI Chat Completions：思考模式走 extra_body.thinking + reasoning_effort。"""
    if not thinking:
        return {"extra_body": dict(THINKING_OFF)}
    return {
        "reasoning_effort": normalize_effort(effort),
        "extra_body": dict(THINKING_ON),
    }


def apply_thinking(kwargs: dict[str, Any], *, thinking: bool, effort: str | None = None) -> dict[str, Any]:
    payload = dict(kwargs)
    payload.update(thinking_kwargs(thinking, effort))
    if thinking:
        for key in ("temperature", "top_p", "presence_penalty", "frequency_penalty"):
            payload.pop(key, None)
    return payload


def reasoning_of(msg: Any) -> str:
    text = getattr(msg, "reasoning_content", None)
    if text:
        return str(text)
    extra = getattr(msg, "model_extra", None) or {}
    if isinstance(extra, dict) and extra.get("reasoning_content"):
        return str(extra["reasoning_content"])
    if hasattr(msg, "model_dump"):
        dumped = msg.model_dump()
        if dumped.get("reasoning_content"):
            return str(dumped["reasoning_content"])
    return ""


def delta_reasoning(delta: Any) -> str:
    text = getattr(delta, "reasoning_content", None)
    if text:
        return str(text)
    extra = getattr(delta, "model_extra", None) or {}
    if isinstance(extra, dict) and extra.get("reasoning_content"):
        return str(extra["reasoning_content"])
    return ""


def assistant_message_dict(msg: Any, *, thinking: bool) -> dict[str, Any]:
    """拼回 API 的 assistant 消息。有工具调用时必须带上 reasoning_content。"""
    data: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
    tool_calls = msg.tool_calls or []
    if tool_calls:
        data["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments or "{}",
                },
            }
            for tc in tool_calls
        ]
    if thinking:
        reason = reasoning_of(msg)
        if reason:
            data["reasoning_content"] = reason
    return data


async def emit_reasoning(on_reasoning: OnReasoning | None, text: str) -> None:
    if not on_reasoning or not (text or "").strip():
        return
    result = on_reasoning(text)
    if inspect.isawaitable(result):
        await result


async def chat_json(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    thinking: bool = False,
) -> dict:
    client = get_client()
    kwargs: dict[str, Any] = {
        "model": model or default_model(),
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    resp = await client.chat.completions.create(**apply_thinking(kwargs, thinking=thinking))
    content = resp.choices[0].message.content or "{}"
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise DeepSeekError(f"模型未返回合法 JSON：{content[:200]}") from exc


async def chat_text(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.4,
    thinking: bool = False,
) -> str:
    client = get_client()
    kwargs: dict[str, Any] = {
        "model": model or default_model(),
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    resp = await client.chat.completions.create(**apply_thinking(kwargs, thinking=thinking))
    return (resp.choices[0].message.content or "").strip()


async def chat_stream(
    *,
    system: str,
    user: str = "",
    messages: list[dict] | None = None,
    model: str | None = None,
    temperature: float = 0.85,
    max_tokens: int = 8192,
    thinking: bool = False,
    on_reasoning: OnReasoning | None = None,
) -> AsyncIterator[str]:
    client = get_client()
    payload: list[dict] = [{"role": "system", "content": system}]
    if messages:
        payload.extend(messages)
    else:
        payload.append({"role": "user", "content": user})
    kwargs: dict[str, Any] = {
        "model": model or default_model(),
        "temperature": temperature,
        "stream": True,
        "max_tokens": max_tokens,
        "messages": payload,
    }
    stream = await client.chat.completions.create(**apply_thinking(kwargs, thinking=thinking))
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        reason = delta_reasoning(delta)
        if reason:
            await emit_reasoning(on_reasoning, reason)
        if delta.content:
            yield delta.content
