from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="FreePress API")
api_router = APIRouter(prefix="/api")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostCreate(BaseModel):
    reporter_id: str = "rhea-iyer"
    reporter_name: str = "Rhea Iyer"
    title: str
    body: str
    kind: str = "dispatch"
    location: str = "On the ground"


class SupportCreate(BaseModel):
    reporter_id: str
    supporter_name: str = "Anonymous supporter"
    amount: int = 7


class ReportCreate(BaseModel):
    post_id: str
    reason: str
    note: str = ""


class LiveCreate(BaseModel):
    reporter_id: str = "rhea-iyer"
    title: str
    camera: str = "Back camera"
    microphone: str = "Phone microphone"


async def seed_data():
    if await db.posts.count_documents({}) == 0:
        await db.posts.insert_many([
            {"id": "post-1", "reporter_id": "rhea-iyer", "reporter_name": "Rhea Iyer", "verified": True,
             "title": "The river is rising. The village is still waiting.", "body": "A field dispatch from the eastern floodplain, where residents are building their own warning network.", "kind": "field report", "location": "Kosi floodplain · 18 min ago", "stats": "1.8k reads", "created_at": now()},
            {"id": "post-2", "reporter_id": "kabir-shah", "reporter_name": "Kabir Shah", "verified": True,
             "title": "Inside the last independent print room", "body": "A visual report on the people keeping local records alive, one page at a time.", "kind": "photo essay", "location": "Old Delhi · 1 hr ago", "stats": "842 reads", "created_at": now()},
            {"id": "post-3", "reporter_id": "meera-nair", "reporter_name": "Meera Nair", "verified": False,
             "title": "LIVE · The workers asking for a safer shift", "body": "A live conversation from the factory gate. Captions will follow after the stream.", "kind": "live now", "location": "Kochi · broadcasting", "stats": "312 watching", "created_at": now()},
        ])
    if await db.reporters.count_documents({}) == 0:
        await db.reporters.insert_many([
            {"id": "rhea-iyer", "name": "Rhea Iyer", "beat": "Climate & civic life", "location": "Bihar", "followers": "12.4k", "supported": False, "verified": True},
            {"id": "kabir-shah", "name": "Kabir Shah", "beat": "Culture & public records", "location": "Delhi", "followers": "8.1k", "supported": False, "verified": True},
            {"id": "meera-nair", "name": "Meera Nair", "beat": "Work & rights", "location": "Kerala", "followers": "5.7k", "supported": False, "verified": False},
        ])


@app.on_event("startup")
async def startup():
    await seed_data()


@api_router.get("/feed")
async def feed():
    return await db.posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api_router.get("/reporters")
async def reporters():
    return await db.reporters.find({}, {"_id": 0}).to_list(50)


@api_router.post("/posts")
async def create_post(payload: PostCreate):
    post = {"id": str(uuid.uuid4()), **payload.model_dump(), "verified": False, "stats": "New dispatch", "created_at": now()}
    await db.posts.insert_one(post)
    post.pop("_id", None)
    return post


@api_router.post("/support")
async def support_reporter(payload: SupportCreate):
    if payload.amount != 7:
        raise HTTPException(status_code=400, detail="Support amount must be ₹7")
    support = {"id": str(uuid.uuid4()), **payload.model_dump(), "status": "pending", "created_at": now()}
    await db.supports.insert_one(support)
    support.pop("_id", None)
    return {**support, "payment_note": "MOCKED payment flow — connect a payment provider to collect funds."}


@api_router.post("/reports")
async def report_post(payload: ReportCreate):
    item = {"id": str(uuid.uuid4()), **payload.model_dump(), "status": "open", "created_at": now()}
    await db.moderation.insert_one(item)
    item.pop("_id", None)
    return item


@api_router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: str):
    result = await db.moderation.update_one({"id": report_id, "status": "open"}, {"$set": {"status": "resolved", "resolved_at": now()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Open report not found")
    return {"id": report_id, "status": "resolved"}


@api_router.get("/admin/overview")
async def admin_overview():
    return {"users": await db.reporters.count_documents({}), "posts": await db.posts.count_documents({}),
            "open_reports": await db.moderation.count_documents({"status": "open"}),
            "live_now": await db.live_sessions.count_documents({"status": "live"}),
            "queue": await db.moderation.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(20)}


@api_router.post("/live-sessions")
async def create_live(payload: LiveCreate):
    session = {"id": str(uuid.uuid4()), **payload.model_dump(), "status": "live", "viewers": 0, "started_at": now()}
    await db.live_sessions.insert_one(session)
    session.pop("_id", None)
    return {**session, "stream_note": "MOCKED live transport — camera and mic controls are ready for a streaming provider."}


@api_router.get("/live-sessions")
async def live_sessions():
    return await db.live_sessions.find({}, {"_id": 0}).sort("started_at", -1).to_list(20)


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()