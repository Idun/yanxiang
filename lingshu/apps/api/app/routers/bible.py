from typing import Any, Type

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Character, Event, Item, Location, Relationship, Storyline
from app.schemas import (
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
    EventCreate,
    EventOut,
    ItemCreate,
    ItemOut,
    LocationCreate,
    LocationOut,
    RelationshipCreate,
    RelationshipOut,
    StorylineCreate,
    StorylineOut,
)
from app.services import novels as novel_svc

router = APIRouter(prefix="/api/novels/{novel_id}", tags=["bible"])


def _ensure_novel(session: Session, novel_id: int):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    return novel


def _list(model: Type[SQLModel], session: Session, novel_id: int) -> list[Any]:
    _ensure_novel(session, novel_id)
    return list(session.exec(select(model).where(model.novel_id == novel_id)).all())


def _create(model: Type[SQLModel], session: Session, novel_id: int, payload: Any):
    _ensure_novel(session, novel_id)
    row = model(novel_id=novel_id, **payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _delete(model: Type[SQLModel], session: Session, novel_id: int, row_id: int):
    _ensure_novel(session, novel_id)
    row = session.get(model, row_id)
    if not row or getattr(row, "novel_id", None) != novel_id:
        raise HTTPException(status_code=404, detail="记录不存在")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/characters", response_model=list[CharacterOut])
def list_characters(novel_id: int, session: Session = Depends(get_session)):
    return _list(Character, session, novel_id)


@router.post("/characters", response_model=CharacterOut)
def create_character(novel_id: int, payload: CharacterCreate, session: Session = Depends(get_session)):
    return _create(Character, session, novel_id, payload)


@router.patch("/characters/{row_id}", response_model=CharacterOut)
def update_character(novel_id: int, row_id: int, payload: CharacterUpdate, session: Session = Depends(get_session)):
    _ensure_novel(session, novel_id)
    row = session.get(Character, row_id)
    if not row or row.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="角色不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/characters/{row_id}")
def delete_character(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Character, session, novel_id, row_id)


@router.post("/characters/keep-protagonist")
def keep_protagonist_only(novel_id: int, session: Session = Depends(get_session)):
    """角色表只留男主/主角，清掉其余人（写章不再被旧配角名单卡住）。"""
    from app.services import planning as plan_svc

    _ensure_novel(session, novel_id)
    return plan_svc.prune_non_protagonist_characters(session, novel_id)


@router.get("/relationships", response_model=list[RelationshipOut])
def list_relationships(novel_id: int, session: Session = Depends(get_session)):
    return _list(Relationship, session, novel_id)


@router.post("/relationships", response_model=RelationshipOut)
def create_relationship(novel_id: int, payload: RelationshipCreate, session: Session = Depends(get_session)):
    return _create(Relationship, session, novel_id, payload)


@router.delete("/relationships/{row_id}")
def delete_relationship(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Relationship, session, novel_id, row_id)


@router.post("/relationships/sync")
async def sync_relationships(novel_id: int, session: Session = Depends(get_session)):
    """根据最近有正文的章节，自动维护人物关系。"""
    from app.models import Chapter
    from app.services.pipeline import sync_relationships_from_chapter

    _ensure_novel(session, novel_id)
    chapters = list(
        session.exec(
            select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.number.desc())
        ).all()
    )
    body = ""
    for ch in chapters:
        if (ch.content or "").strip():
            body = ch.content or ""
            break
    if not body.strip():
        raise HTTPException(status_code=400, detail="还没有章节正文，无法抽取关系")
    try:
        result = await sync_relationships_from_chapter(novel_id=novel_id, chapter_content=body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"关系同步失败：{exc}") from exc
    return result


@router.get("/items", response_model=list[ItemOut])
def list_items(novel_id: int, session: Session = Depends(get_session)):
    return _list(Item, session, novel_id)


@router.post("/items", response_model=ItemOut)
def create_item(novel_id: int, payload: ItemCreate, session: Session = Depends(get_session)):
    return _create(Item, session, novel_id, payload)


@router.delete("/items/{row_id}")
def delete_item(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Item, session, novel_id, row_id)


@router.get("/locations", response_model=list[LocationOut])
def list_locations(novel_id: int, session: Session = Depends(get_session)):
    return _list(Location, session, novel_id)


@router.post("/locations", response_model=LocationOut)
def create_location(novel_id: int, payload: LocationCreate, session: Session = Depends(get_session)):
    return _create(Location, session, novel_id, payload)


@router.delete("/locations/{row_id}")
def delete_location(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Location, session, novel_id, row_id)


@router.get("/events", response_model=list[EventOut])
def list_events(novel_id: int, session: Session = Depends(get_session)):
    return _list(Event, session, novel_id)


@router.post("/events", response_model=EventOut)
def create_event(novel_id: int, payload: EventCreate, session: Session = Depends(get_session)):
    return _create(Event, session, novel_id, payload)


@router.delete("/events/{row_id}")
def delete_event(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Event, session, novel_id, row_id)


@router.get("/storylines", response_model=list[StorylineOut])
def list_storylines(novel_id: int, session: Session = Depends(get_session)):
    return _list(Storyline, session, novel_id)


@router.post("/storylines", response_model=StorylineOut)
def create_storyline(novel_id: int, payload: StorylineCreate, session: Session = Depends(get_session)):
    return _create(Storyline, session, novel_id, payload)


@router.delete("/storylines/{row_id}")
def delete_storyline(novel_id: int, row_id: int, session: Session = Depends(get_session)):
    return _delete(Storyline, session, novel_id, row_id)
