from typing import Protocol


class HarnessSidecar(Protocol):
    async def run_tool_task(self, prompt: str, session_id: str) -> str: ...


class NoopHarness:
    """Placeholder. Novel agents do not go through DeepSeek Harness."""

    async def run_tool_task(self, prompt: str, session_id: str) -> str:
        return ""


harness: HarnessSidecar = NoopHarness()
