from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data"
SETTINGS_FILE = DATA_DIR / "settings.json"
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    database_url: str = f"sqlite:///{(DATA_DIR / 'nova.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )


def load_settings() -> Settings:
    import json

    base = Settings()
    if SETTINGS_FILE.exists():
        overlay = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        allowed = set(Settings.model_fields)
        return base.model_copy(
            update={k: v for k, v in overlay.items() if k in allowed and v is not None}
        )
    return base


settings = load_settings()
DATA_DIR.mkdir(parents=True, exist_ok=True)
