from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
import hashlib
import hmac
import json
import logging
import os
import uuid

import httpx
import jwt
import razorpay
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from livekit import api as livekit_api
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="FreePress API")
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)
password_hash = PasswordHash.recommended()

INTEGRATION_HINTS = {
    "MUX_TOKEN_ID": "Media uploads",
    "MUX_TOKEN_SECRET": "Media uploads",
    "MUX_WEBHOOK_SECRET": "Media uploads",
    "LIVEKIT_URL": "Live streaming",
    "LIVEKIT_API_KEY": "Live streaming",
    "LIVEKIT_API_SECRET": "Live streaming",
    "RAZORPAY_KEY_ID": "₹7 support payments",
    "RAZORPAY_KEY_SECRET": "₹7 support payments",
    "RAZORPAY_WEBHOOK_SECRET": "₹7 support payments",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def jwt_secret() -> str:
    value = os.getenv("JWT_SECRET")
    if not value:
        raise HTTPException(503, "Authentication is not configured. Add JWT_SECRET to backend/.env")
    return value


def provider_required(*keys: str):
    missing = [key for key in keys if not os.getenv(key)]
    if missing:
        feature = INTEGRATION_HINTS.get(missing[0], "This feature")
        raise HTTPException(503, f"{feature} is coming soon — add {', '.join(missing)} to backend/.env")


class Register(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str
    password: str = Field(min_length=6, max_length=128)
    role: str = "client"


class Login(BaseModel):
    email: str
    password: str


class PostMedia(BaseModel):
    kind: str  # "image" | "video"
    playback_id: Optional[str] = None
    asset_id: Optional[str] = None
    url: Optional[str] = None
    upload_id: Optional[str] = None


class PostCreate(BaseModel):
    title: str
    body: str
    kind: str = "dispatch"
    location: str = "On the ground"
    media: list[PostMedia] = []


class SupportCreate(BaseModel):
    reporter_id: str
    amount: int = 7
    interval: str = "once"  # "once" | "monthly"


class ReportCreate(BaseModel):
    post_id: str
    reason: str
    note: str = ""


class LiveCreate(BaseModel):
    title: str
    room: Optional[str] = None


class UploadCreate(BaseModel):
    filename: str
    content_type: str


def public_user(user: dict) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "verified": user.get("verified", False)}


def token_for(user: dict) -> str:
    issued = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "role": user["role"], "iat": issued, "exp": issued + timedelta(days=7)}, jwt_secret(), algorithm="HS256")


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        claims = jwt.decode(credentials.credentials, jwt_secret(), algorithms=["HS256"])
        user = await db.users.find_one({"id": claims["sub"], "disabled": {"$ne": True}}, {"_id": 0, "password_hash": 0})
        if not user or user["role"] != claims.get("role"):
            raise ValueError("user changed")
        return user
    except HTTPException:
        raise
    except Exception as exc:
        logging.info("auth rejected: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


def require_roles(*roles: str):
    async def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user
    return dependency


async def seed_data():
    # Admin seed
    if not await db.users.find_one({"email": "admin@freepress.in"}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Platform Admin",
            "email": "admin@freepress.in",
            "role": "admin",
            "password_hash": password_hash.hash("admin123"),
            "verified": True,
            "created_at": now(),
            "disabled": False,
        })
    # Demo reporter seed (for the feed to have a real author)
    reporter = await db.users.find_one({"email": "rhea@freepress.in"})
    if not reporter:
        reporter_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": reporter_id,
            "name": "Rhea Iyer",
            "email": "rhea@freepress.in",
            "role": "reporter",
            "password_hash": password_hash.hash("reporter123"),
            "verified": True,
            "beat": "Climate & civic life",
            "location": "Bihar",
            "followers": 12400,
            "created_at": now(),
            "disabled": False,
        })
    else:
        reporter_id = reporter["id"]
    # Demo client seed
    if not await db.users.find_one({"email": "reader@freepress.in"}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Curious Reader",
            "email": "reader@freepress.in",
            "role": "client",
            "password_hash": password_hash.hash("reader123"),
            "verified": False,
            "created_at": now(),
            "disabled": False,
        })
    # Seed a few posts if none exist
    if await db.posts.count_documents({}) == 0:
        await db.posts.insert_many([
            {"id": str(uuid.uuid4()), "reporter_id": reporter_id, "reporter_name": "Rhea Iyer", "verified": True, "title": "The river is rising. The village is still waiting.", "body": "A field dispatch from the eastern floodplain, where residents are building their own warning network.", "kind": "field report", "location": "Kosi floodplain", "stats": "1.8k reads", "created_at": now()},
            {"id": str(uuid.uuid4()), "reporter_id": reporter_id, "reporter_name": "Rhea Iyer", "verified": True, "title": "Inside the last independent print room", "body": "A visual report on the people keeping local records alive, one page at a time.", "kind": "photo essay", "location": "Old Delhi", "stats": "842 reads", "created_at": now()},
        ])


@app.on_event("startup")
async def startup():
    await seed_data()


@api_router.get("/health")
async def health():
    return {"status": "ok", "time": now()}


@api_router.post("/auth/register")
async def register(payload: Register):
    role = payload.role if payload.role in {"client", "reporter"} else "client"
    email = payload.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists")
    user = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "email": email,
        "role": role,
        "password_hash": password_hash.hash(payload.password),
        "verified": False,
        "created_at": now(),
        "disabled": False,
    }
    await db.users.insert_one(user)
    return {"access_token": token_for(user), "token_type": "bearer", "user": public_user(user)}


@api_router.post("/auth/login")
async def login(payload: Login):
    user = await db.users.find_one({"email": payload.email.strip().lower()}, {"_id": 0})
    if not user or not password_hash.verify(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if user.get("disabled"):
        raise HTTPException(403, "This account has been disabled by an admin")
    return {"access_token": token_for(user), "token_type": "bearer", "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api_router.get("/feed")
async def feed():
    return await db.posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api_router.get("/feed/following")
async def feed_following(user: dict = Depends(current_user)):
    follows = await db.follows.find({"supporter_id": user["id"]}, {"_id": 0, "reporter_id": 1}).to_list(500)
    ids = [row["reporter_id"] for row in follows]
    if not ids:
        return []
    return await db.posts.find({"reporter_id": {"$in": ids}}, {"_id": 0}).sort("created_at", -1).to_list(100)


async def _support_totals(reporter_ids: list[str]) -> dict[str, int]:
    if not reporter_ids:
        return {}
    pipeline = [
        {"$match": {"reporter_id": {"$in": reporter_ids}, "status": "verified"}},
        {"$group": {"_id": "$reporter_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    out: dict[str, int] = {}
    async for row in db.supports.aggregate(pipeline):
        out[row["_id"]] = row["total"]
    return out


async def _follower_count(reporter_id: str) -> int:
    return await db.follows.count_documents({"reporter_id": reporter_id})


@api_router.get("/reporters")
async def list_reporters():
    users = await db.users.find({"role": "reporter", "disabled": {"$ne": True}}, {"_id": 0, "password_hash": 0}).to_list(50)
    ids = [u["id"] for u in users]
    totals = await _support_totals(ids)
    follower_counts: dict[str, int] = {}
    async for row in db.follows.aggregate([
        {"$match": {"reporter_id": {"$in": ids}}},
        {"$group": {"_id": "$reporter_id", "count": {"$sum": 1}}},
    ]):
        follower_counts[row["_id"]] = row["count"]
    return [
        {
            "id": u["id"],
            "name": u["name"],
            "beat": u.get("beat", "Independent reporting"),
            "location": u.get("location", "India"),
            "followers": follower_counts.get(u["id"], 0),
            "support_total": totals.get(u["id"], 0),
            "verified": u.get("verified", False),
        }
        for u in users
    ]


@api_router.get("/reporters/{reporter_id}")
async def get_reporter(reporter_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    user = await db.users.find_one({"id": reporter_id, "role": "reporter"}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "Reporter not found")
    posts = await db.posts.find({"reporter_id": reporter_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    totals = await _support_totals([reporter_id])
    followers = await _follower_count(reporter_id)
    is_following = False
    viewer = None
    if credentials:
        try:
            claims = jwt.decode(credentials.credentials, jwt_secret(), algorithms=["HS256"])
            viewer = claims.get("sub")
            is_following = bool(await db.follows.find_one({"reporter_id": reporter_id, "supporter_id": viewer}))
        except Exception:
            viewer = None
    return {
        "reporter": public_user(user) | {
            "beat": user.get("beat"),
            "location": user.get("location"),
            "followers": followers,
            "support_total": totals.get(reporter_id, 0),
            "is_following": is_following,
        },
        "posts": posts,
    }


@api_router.post("/reporters/{reporter_id}/follow")
async def follow_reporter(reporter_id: str, user: dict = Depends(current_user)):
    if user["id"] == reporter_id:
        raise HTTPException(400, "You cannot follow yourself")
    if not await db.users.find_one({"id": reporter_id, "role": "reporter"}):
        raise HTTPException(404, "Reporter not found")
    await db.follows.update_one(
        {"reporter_id": reporter_id, "supporter_id": user["id"]},
        {"$setOnInsert": {"reporter_id": reporter_id, "supporter_id": user["id"], "created_at": now()}},
        upsert=True,
    )
    return {"ok": True, "following": True, "followers": await _follower_count(reporter_id)}


@api_router.delete("/reporters/{reporter_id}/follow")
async def unfollow_reporter(reporter_id: str, user: dict = Depends(current_user)):
    await db.follows.delete_one({"reporter_id": reporter_id, "supporter_id": user["id"]})
    return {"ok": True, "following": False, "followers": await _follower_count(reporter_id)}


@api_router.post("/posts")
async def create_post(payload: PostCreate, user: dict = Depends(require_roles("reporter", "admin"))):
    post = {
        "id": str(uuid.uuid4()),
        "reporter_id": user["id"],
        "reporter_name": user["name"],
        **payload.model_dump(),
        "verified": user.get("verified", False),
        "stats": "New dispatch",
        "created_at": now(),
    }
    await db.posts.insert_one(post)
    post.pop("_id", None)
    return post


@api_router.get("/posts/mine")
async def my_posts(user: dict = Depends(require_roles("reporter", "admin"))):
    return await db.posts.find({"reporter_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api_router.get("/reporter/earnings")
async def reporter_earnings(user: dict = Depends(require_roles("reporter", "admin"))):
    """Lifetime earnings breakdown for the signed-in reporter."""
    reporter_id = user["id"]
    # Lifetime verified totals
    lifetime = 0
    verified_count = 0
    async for row in db.supports.aggregate([
        {"$match": {"reporter_id": reporter_id, "status": "verified"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]):
        lifetime = row["total"]
        verified_count = row["count"]
    # Pending / created (not yet captured)
    pending_amount = 0
    pending_count = 0
    async for row in db.supports.aggregate([
        {"$match": {"reporter_id": reporter_id, "status": {"$in": ["created", "pending"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]):
        pending_amount = row["total"]
        pending_count = row["count"]
    # Active monthly pledges
    monthly_pledges = await db.supports.count_documents({
        "reporter_id": reporter_id,
        "interval": "monthly",
        "status": {"$in": ["verified", "pending"]},
    })
    # Top supporters
    top_supporters: list[dict] = []
    async for row in db.supports.aggregate([
        {"$match": {"reporter_id": reporter_id, "status": "verified"}},
        {"$group": {"_id": "$supporter_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"total": -1}},
        {"$limit": 5},
    ]):
        supporter = await db.users.find_one({"id": row["_id"]}, {"_id": 0, "name": 1})
        top_supporters.append({
            "supporter_id": row["_id"],
            "name": supporter["name"] if supporter else "Anonymous reader",
            "total": row["total"],
            "count": row["count"],
        })
    return {
        "lifetime": lifetime,
        "verified_count": verified_count,
        "pending_amount": pending_amount,
        "pending_count": pending_count,
        "monthly_pledges": monthly_pledges,
        "top_supporters": top_supporters,
    }


@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str, user: dict = Depends(current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    if user["role"] != "admin" and post["reporter_id"] != user["id"]:
        raise HTTPException(403, "You can only delete your own posts")
    await db.posts.delete_one({"id": post_id})
    return {"ok": True}


@api_router.post("/media/upload-url")
async def create_upload(payload: UploadCreate, user: dict = Depends(require_roles("reporter", "admin"))):
    provider_required("MUX_TOKEN_ID", "MUX_TOKEN_SECRET")
    auth = (os.environ["MUX_TOKEN_ID"], os.environ["MUX_TOKEN_SECRET"])
    body = {
        "cors_origin": "*",
        "new_asset_settings": {"playback_policies": ["public"], "passthrough": user["id"]},
    }
    async with httpx.AsyncClient(timeout=20) as http:
        response = await http.post("https://api.mux.com/video/v1/uploads", auth=auth, json=body)
    if response.status_code >= 400:
        raise HTTPException(502, "Mux could not create an upload URL")
    data = response.json()["data"]
    await db.media.insert_one({
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "upload_id": data["id"],
        "filename": payload.filename,
        "content_type": payload.content_type,
        "status": "waiting",
        "created_at": now(),
    })
    return {"upload_url": data["url"], "upload_id": data["id"]}


@api_router.get("/media/{upload_id}")
async def media_status(upload_id: str, user: dict = Depends(current_user)):
    """Poll Mux for the asset backing an upload_id and cache the playback_id.
    Used by the frontend after a direct upload finishes when the webhook is not
    wired in dev."""
    provider_required("MUX_TOKEN_ID", "MUX_TOKEN_SECRET")
    record = await db.media.find_one({"upload_id": upload_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Upload not found")
    if record.get("playback_id"):
        return record
    auth = (os.environ["MUX_TOKEN_ID"], os.environ["MUX_TOKEN_SECRET"])
    async with httpx.AsyncClient(timeout=20) as http:
        up_res = await http.get(f"https://api.mux.com/video/v1/uploads/{upload_id}", auth=auth)
        if up_res.status_code >= 400:
            raise HTTPException(502, "Mux could not read the upload status")
        asset_id = (up_res.json().get("data") or {}).get("asset_id")
        if not asset_id:
            return record | {"status": "waiting"}
        asset_res = await http.get(f"https://api.mux.com/video/v1/assets/{asset_id}", auth=auth)
        if asset_res.status_code >= 400:
            raise HTTPException(502, "Mux could not read the asset")
        asset = asset_res.json().get("data", {})
    playback_ids = asset.get("playback_ids") or []
    playback_id = playback_ids[0]["id"] if playback_ids else None
    await db.media.update_one(
        {"upload_id": upload_id},
        {"$set": {"status": asset.get("status", "processing"), "asset_id": asset_id, "playback_id": playback_id}},
    )
    return {**record, "status": asset.get("status", "processing"), "asset_id": asset_id, "playback_id": playback_id}


@api_router.post("/webhooks/mux")
async def mux_webhook(request: Request):
    provider_required("MUX_WEBHOOK_SECRET")
    raw = await request.body()
    signature = request.headers.get("mux-signature", "")
    expected = hmac.new(os.environ["MUX_WEBHOOK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "Invalid Mux signature")
    event = json.loads(raw)
    data = event.get("data", {})
    if event.get("type") == "video.asset.ready":
        await db.media.update_one({"upload_id": data.get("upload_id") or data.get("id")}, {"$set": {"status": "ready", "asset_id": data.get("id"), "playback_id": (data.get("playback_ids") or [{}])[0].get("id")}})
    return {"ok": True}


@api_router.post("/live/token")
async def live_token(payload: LiveCreate, user: dict = Depends(require_roles("reporter", "admin"))):
    provider_required("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
    room_name = payload.room or f"freepress-{uuid.uuid4().hex[:12]}"
    token = (
        livekit_api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(user["id"])
        .with_name(user["name"])
        .with_grants(livekit_api.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True, can_publish_data=True))
    )
    await db.live_sessions.insert_one({"id": str(uuid.uuid4()), "room": room_name, "reporter_id": user["id"], "reporter_name": user["name"], "title": payload.title, "status": "live", "started_at": now()})
    return {"token": token.to_jwt(), "url": os.environ["LIVEKIT_URL"], "room": room_name}


@api_router.get("/live/sessions")
async def live_sessions():
    return await db.live_sessions.find({"status": "live"}, {"_id": 0}).sort("started_at", -1).to_list(50)


@api_router.post("/live/viewer-token")
async def live_viewer_token(payload: dict, user: dict = Depends(current_user)):
    provider_required("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
    room_name = payload.get("room")
    if not room_name:
        raise HTTPException(400, "room is required")
    token = (
        livekit_api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(user["id"])
        .with_name(user["name"])
        .with_grants(livekit_api.VideoGrants(room_join=True, room=room_name, can_publish=False, can_subscribe=True))
    )
    return {"token": token.to_jwt(), "url": os.environ["LIVEKIT_URL"], "room": room_name}


@api_router.post("/live/{session_id}/end")
async def end_live(session_id: str, user: dict = Depends(current_user)):
    session = await db.live_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    if user["role"] != "admin" and session["reporter_id"] != user["id"]:
        raise HTTPException(403, "You cannot end this session")
    await db.live_sessions.update_one({"id": session_id}, {"$set": {"status": "ended", "ended_at": now()}})
    return {"ok": True}


@api_router.post("/support")
async def support_reporter(payload: SupportCreate, user: dict = Depends(require_roles("client"))):
    if payload.amount != 7:
        raise HTTPException(400, "Support amount must be ₹7")
    if payload.interval not in {"once", "monthly"}:
        raise HTTPException(400, "interval must be 'once' or 'monthly'")
    provider_required("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET")
    gateway = razorpay.Client(auth=(os.environ["RAZORPAY_KEY_ID"], os.environ["RAZORPAY_KEY_SECRET"]))
    if payload.interval == "monthly":
        plan_id = os.getenv("RAZORPAY_MONTHLY_PLAN_ID")
        if not plan_id:
            raise HTTPException(
                503,
                "Monthly support is coming soon — add RAZORPAY_MONTHLY_PLAN_ID (a ₹7 monthly plan created in Razorpay) to backend/.env",
            )
        subscription = gateway.subscription.create({
            "plan_id": plan_id,
            "total_count": 24,  # 2 years by default
            "customer_notify": 1,
            "notes": {"supporter_id": user["id"], "reporter_id": payload.reporter_id},
        })
        await db.supports.insert_one({
            "id": str(uuid.uuid4()),
            "supporter_id": user["id"],
            "reporter_id": payload.reporter_id,
            "amount": 7,
            "interval": "monthly",
            "subscription_id": subscription["id"],
            "status": "pending",
            "created_at": now(),
        })
        return {
            "interval": "monthly",
            "subscription_id": subscription["id"],
            "amount": 700,
            "currency": "INR",
            "key_id": os.environ["RAZORPAY_KEY_ID"],
        }
    order = gateway.order.create({
        "amount": 700,
        "currency": "INR",
        "receipt": f"support-{uuid.uuid4().hex[:16]}",
        "notes": {"supporter_id": user["id"], "reporter_id": payload.reporter_id},
    })
    await db.supports.insert_one({
        "id": str(uuid.uuid4()),
        "supporter_id": user["id"],
        "reporter_id": payload.reporter_id,
        "amount": 7,
        "interval": "once",
        "order_id": order["id"],
        "status": "created",
        "created_at": now(),
    })
    return {
        "interval": "once",
        "order_id": order["id"],
        "amount": 700,
        "currency": "INR",
        "key_id": os.environ["RAZORPAY_KEY_ID"],
    }


@api_router.post("/support/verify")
async def verify_support(payload: dict, user: dict = Depends(require_roles("client"))):
    provider_required("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET")
    payment_id = payload.get("razorpay_payment_id")
    signature = payload.get("razorpay_signature")
    subscription_id = payload.get("razorpay_subscription_id")
    order_id = payload.get("razorpay_order_id")
    if not payment_id or not signature or (not subscription_id and not order_id):
        raise HTTPException(400, "Missing payment identifiers")
    gateway = razorpay.Client(auth=(os.environ["RAZORPAY_KEY_ID"], os.environ["RAZORPAY_KEY_SECRET"]))
    try:
        if subscription_id:
            gateway.utility.verify_payment_signature({
                "razorpay_subscription_id": subscription_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            })
        else:
            gateway.utility.verify_payment_signature({
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            })
    except Exception:
        raise HTTPException(400, "Invalid payment signature")
    query = (
        {"subscription_id": subscription_id, "supporter_id": user["id"]}
        if subscription_id
        else {"order_id": order_id, "supporter_id": user["id"]}
    )
    await db.supports.update_one(
        query,
        {"$set": {"payment_id": payment_id, "status": "verified", "verified_at": now()}},
    )
    return {"ok": True, "status": "verified"}


@api_router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    provider_required("RAZORPAY_WEBHOOK_SECRET")
    raw = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(os.environ["RAZORPAY_WEBHOOK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "Invalid Razorpay signature")
    event = json.loads(raw)
    event_id = request.headers.get("x-razorpay-event-id") or hashlib.sha256(raw).hexdigest()
    if await db.webhook_events.find_one({"id": event_id}):
        return {"ok": True, "duplicate": True}
    await db.webhook_events.insert_one({"id": event_id, "event": event.get("event"), "created_at": now()})
    payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    if event.get("event") in {"payment.captured", "order.paid"} and payment.get("order_id"):
        await db.supports.update_one(
            {"order_id": payment["order_id"]},
            {"$set": {"status": "verified", "payment_id": payment.get("id"), "verified_at": now()}},
        )
    return {"ok": True}


@api_router.post("/reports")
async def report_post(payload: ReportCreate, user: dict = Depends(current_user)):
    item = {"id": str(uuid.uuid4()), "reporter_id": user["id"], "reporter_name": user["name"], **payload.model_dump(), "status": "open", "created_at": now()}
    await db.moderation.insert_one(item)
    item.pop("_id", None)
    return item


@api_router.get("/admin/overview")
async def admin_overview(user: dict = Depends(require_roles("admin"))):
    return {
        "users": await db.users.count_documents({"disabled": {"$ne": True}}),
        "reporters": await db.users.count_documents({"role": "reporter", "disabled": {"$ne": True}}),
        "posts": await db.posts.count_documents({}),
        "open_reports": await db.moderation.count_documents({"status": "open"}),
        "live_now": await db.live_sessions.count_documents({"status": "live"}),
        "queue": await db.moderation.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(20),
    }


@api_router.get("/admin/users")
async def admin_users(user: dict = Depends(require_roles("admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(200)
    return users


@api_router.post("/admin/users/{user_id}/disable")
async def disable_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(400, "You cannot disable your own account")
    result = await db.users.update_one({"id": user_id}, {"$set": {"disabled": True, "disabled_at": now()}})
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/enable")
async def enable_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.users.update_one({"id": user_id}, {"$set": {"disabled": False}, "$unset": {"disabled_at": ""}})
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/verify")
async def verify_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.users.update_one({"id": user_id}, {"$set": {"verified": True}})
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.moderation.update_one(
        {"id": report_id, "status": "open"},
        {"$set": {"status": "resolved", "resolved_by": user["id"], "resolved_at": now()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Open report not found")
    return {"id": report_id, "status": "resolved"}


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
