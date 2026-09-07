import json

from app.config import SETTINGS_FILE, load_settings
from app.llm.deepseek import DeepSeekError, get_client
from app.schemas import SettingsOut, SettingsUpdate


def mask_key(key: str) -> str:
    key = key.strip()
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "****" + key[-4:]


def get_settings_out() -> SettingsOut:
    cfg = load_settings()
    key = cfg.deepseek_api_key.strip()
    return SettingsOut(
        has_api_key=bool(key),
        api_key_masked=mask_key(key),
        deepseek_model=cfg.deepseek_model,
        deepseek_base_url=cfg.deepseek_base_url,
    )


def save_settings(payload: SettingsUpdate) -> SettingsOut:
    current = {}
    if SETTINGS_FILE.exists():
        current = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    data = payload.model_dump(exclude_unset=True)
    if data.get("deepseek_api_key") == "":
        data["deepseek_api_key"] = ""
    current.update({k: v for k, v in data.items() if v is not None})
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return get_settings_out()


async def health_check() -> dict:
    cfg = load_settings()
    if not cfg.deepseek_api_key.strip():
        return {"ok": False, "message": "尚未填写 API Key"}
    try:
        client = get_client()
        models = await client.models.list()
        ids = [m.id for m in models.data]
        return {"ok": True, "message": "连接正常", "models": ids[:20]}
    except DeepSeekError as exc:
        return {"ok": False, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"探测失败：{exc}"}
