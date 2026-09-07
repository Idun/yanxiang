from fastapi import APIRouter

from app.schemas import SettingsOut, SettingsUpdate
from app.services.settings import get_settings_out, health_check, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def read_settings():
    return get_settings_out()


@router.put("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate):
    return save_settings(payload)


@router.get("/health")
async def settings_health():
    return await health_check()
