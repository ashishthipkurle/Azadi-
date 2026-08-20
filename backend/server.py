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
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from starlette.middleware.cors import CORSMiddleware

import database as db

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
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


class BookmarkCreate(BaseModel):
    post_id: str


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1200)
    parent_id: Optional[str] = None


def _strip_keys(row: dict | None, keys: list[str]) -> dict | None:
    """Remove unwanted keys from a dict (replaces Mongo projection {\"_id\": 0, \"password_hash\": 0})."""
    if row is None:
        return None
    return {k: v for k, v in row.items() if k not in keys}


def public_user(user: dict) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "verified": user.get("verified", False)}


async def notify(
    recipient_id: str,
    kind: str,
    actor: dict,
    message: str,
    subject_id: Optional[str] = None,
    subject_kind: Optional[str] = None,
):
    """Insert a single notification row. Silently no-ops if the caller is the
    recipient (people don't need to be pinged about their own actions)."""
    if recipient_id == actor.get("id"):
        return
    await db.insert_one("notifications", {
        "id": str(uuid.uuid4()),
        "recipient_id": recipient_id,
        "kind": kind,
        "actor_id": actor.get("id"),
        "actor_name": actor.get("name"),
        "subject_id": subject_id,
        "subject_kind": subject_kind,
        "message": message,
        "read": False,
        "created_at": now(),
    })


def token_for(user: dict) -> str:
    issued = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "role": user["role"], "iat": issued, "exp": issued + timedelta(days=7)}, jwt_secret(), algorithm="HS256")


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        claims = jwt.decode(credentials.credentials, jwt_secret(), algorithms=["HS256"])
        user = await db.find_one("users", {"id": claims["sub"], "disabled": False})
        if not user or user["role"] != claims.get("role"):
            raise ValueError("user changed")
        user = _strip_keys(user, ["password_hash"])
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
    if not await db.find_one("users", {"email": "admin@freepress.in"}):
        await db.insert_one("users", {
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
    reporter = await db.find_one("users", {"email": "rhea@freepress.in"})
    if not reporter:
        reporter_id = str(uuid.uuid4())
        await db.insert_one("users", {
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
    if not await db.find_one("users", {"email": "reader@freepress.in"}):
        await db.insert_one("users", {
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
    post_count = await db.count("posts")
    if post_count == 0:
        await db.insert_many("posts", [
            {"id": str(uuid.uuid4()), "reporter_id": reporter_id, "reporter_name": "Rhea Iyer", "verified": True, "title": "The river is rising. The village is still waiting.", "body": "A field dispatch from the eastern floodplain, where residents are building their own warning network.", "kind": "field report", "location": "Kosi floodplain", "stats": "1.8k reads", "created_at": now()},
            {"id": str(uuid.uuid4()), "reporter_id": reporter_id, "reporter_name": "Rhea Iyer", "verified": True, "title": "Inside the last independent print room", "body": "A visual report on the people keeping local records alive, one page at a time.", "kind": "photo essay", "location": "Old Delhi", "stats": "842 reads", "created_at": now()},
        ])


@app.on_event("startup")
async def startup():
    await db.init_db()
    await seed_data()


@api_router.get("/health")
async def health():
    return {"status": "ok", "time": now()}


@api_router.post("/auth/register")
async def register(payload: Register):
    role = payload.role if payload.role in {"client", "reporter"} else "client"
    email = payload.email.strip().lower()
    if await db.find_one("users", {"email": email}):
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
    await db.insert_one("users", user)
    return {"access_token": token_for(user), "token_type": "bearer", "user": public_user(user)}


@api_router.post("/auth/login")
async def login(payload: Login):
    user = await db.find_one("users", {"email": payload.email.strip().lower()})
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
    return await db.find_many("posts", order_by="created_at", desc=True, limit=50)


@api_router.get("/feed/following")
async def feed_following(user: dict = Depends(current_user)):
    follows = await db.find_many("follows", {"supporter_id": user["id"]})
    ids = [row["reporter_id"] for row in follows]
    if not ids:
        return []
    return await db.find_many(
        "posts",
        {"reporter_id": {"$in": ids}},
        order_by="created_at",
        desc=True,
        limit=100,
    )


@api_router.get("/feed/trending")
async def feed_trending():
    """Rank posts by (reads + supports*3) in the past 24 hours.
    Support counts more than a read because it's a stronger signal, but we
    don't allow paid promotion to influence ranking beyond genuine reader
    interest."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    # Read counts via RPC
    read_counts: dict[str, int] = {}
    read_rows = await db.rpc("read_counts_since", {"cutoff": cutoff})
    for row in read_rows:
        read_counts[row["post_id"]] = row["count"]

    # Support counts via RPC
    support_counts: dict[str, int] = {}
    support_rows = await db.rpc("support_counts_since", {"cutoff": cutoff})
    for row in support_rows:
        support_counts[row["reporter_id"]] = row["count"]

    posts = await db.find_many("posts", {"created_at": {"$gte": cutoff}}, limit=200)
    # Include any older post that got engagement in the window too.
    if read_counts:
        engaged_ids = list(read_counts.keys())
        older = await db.find_many(
            "posts",
            {"id": {"$in": engaged_ids}, "created_at": {"$lt": cutoff}},
            limit=200,
        )
        seen = {p["id"] for p in posts}
        for p in older:
            if p["id"] not in seen:
                posts.append(p)

    def score(post: dict) -> int:
        return read_counts.get(post["id"], 0) + support_counts.get(post["reporter_id"], 0) * 3

    ranked = sorted(posts, key=lambda p: (score(p), p["created_at"]), reverse=True)
    return [{**p, "trending_score": score(p), "reads_24h": read_counts.get(p["id"], 0)} for p in ranked[:40]]


@api_router.post("/posts/{post_id}/read")
async def mark_read(post_id: str, user: dict = Depends(current_user)):
    """Record a read for trending. De-duped per (viewer, post, day) so refresh
    spam doesn't skew the ranking."""
    if not await db.find_one("posts", {"id": post_id}):
        raise HTTPException(404, "Post not found")
    day = datetime.now(timezone.utc).date().isoformat()
    key = f"{post_id}:{user['id']}:{day}"
    existing = await db.find_one("reads", {"key": key})
    if existing:
        return {"ok": True, "new": False}
    await db.insert_one("reads", {
        "key": key,
        "post_id": post_id,
        "viewer_id": user["id"],
        "created_at": now(),
    })
    return {"ok": True, "new": True}


@api_router.post("/bookmarks")
async def create_bookmark(payload: BookmarkCreate, user: dict = Depends(current_user)):
    if not await db.find_one("posts", {"id": payload.post_id}):
        raise HTTPException(404, "Post not found")
    await db.upsert_one("bookmarks", {
        "user_id": user["id"],
        "post_id": payload.post_id,
        "created_at": now(),
    }, on_conflict="user_id,post_id")
    return {"ok": True, "bookmarked": True}


@api_router.delete("/bookmarks/{post_id}")
async def delete_bookmark(post_id: str, user: dict = Depends(current_user)):
    await db.delete_one("bookmarks", {"user_id": user["id"], "post_id": post_id})
    return {"ok": True, "bookmarked": False}


@api_router.get("/bookmarks")
async def list_bookmarks(user: dict = Depends(current_user)):
    rows = await db.find_many("bookmarks", {"user_id": user["id"]}, order_by="created_at", desc=True, limit=200)
    if not rows:
        return {"post_ids": [], "posts": []}
    post_ids = [r["post_id"] for r in rows]
    posts = await db.find_many("posts", {"id": {"$in": post_ids}}, limit=200)
    order = {pid: idx for idx, pid in enumerate(post_ids)}
    posts.sort(key=lambda p: order.get(p["id"], 9999))
    return {"post_ids": post_ids, "posts": posts}


async def _support_totals(reporter_ids: list[str]) -> dict[str, int]:
    if not reporter_ids:
        return {}
    rows = await db.rpc("support_totals", {"reporter_ids": reporter_ids})
    return {row["reporter_id"]: row["total"] for row in rows}


async def _follower_count(reporter_id: str) -> int:
    return await db.count("follows", {"reporter_id": reporter_id})


@api_router.get("/reporters")
async def list_reporters():
    users = await db.find_many(
        "users",
        {"role": "reporter", "disabled": False},
        limit=50,
    )
    users = [_strip_keys(u, ["password_hash"]) for u in users]
    ids = [u["id"] for u in users]
    totals = await _support_totals(ids)
    follower_counts_map: dict[str, int] = {}
    fc_rows = await db.rpc("follower_counts", {"reporter_ids": ids})
    for row in fc_rows:
        follower_counts_map[row["reporter_id"]] = row["count"]
    return [
        {
            "id": u["id"],
            "name": u["name"],
            "beat": u.get("beat", "Independent reporting"),
            "location": u.get("location", "India"),
            "followers": follower_counts_map.get(u["id"], 0),
            "support_total": totals.get(u["id"], 0),
            "verified": u.get("verified", False),
        }
        for u in users
    ]


@api_router.get("/reporters/{reporter_id}")
async def get_reporter(reporter_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    user = await db.find_one("users", {"id": reporter_id, "role": "reporter"})
    if not user:
        raise HTTPException(404, "Reporter not found")
    user = _strip_keys(user, ["password_hash"])
    posts = await db.find_many("posts", {"reporter_id": reporter_id}, order_by="created_at", desc=True, limit=50)
    totals = await _support_totals([reporter_id])
    followers = await _follower_count(reporter_id)
    is_following = False
    viewer = None
    if credentials:
        try:
            claims = jwt.decode(credentials.credentials, jwt_secret(), algorithms=["HS256"])
            viewer = claims.get("sub")
            follow_row = await db.find_one("follows", {"reporter_id": reporter_id, "supporter_id": viewer})
            is_following = follow_row is not None
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
    if not await db.find_one("users", {"id": reporter_id, "role": "reporter"}):
        raise HTTPException(404, "Reporter not found")
    # Check if already following
    existing = await db.find_one("follows", {"reporter_id": reporter_id, "supporter_id": user["id"]})
    is_new = existing is None
    if is_new:
        await db.insert_one("follows", {
            "reporter_id": reporter_id,
            "supporter_id": user["id"],
            "created_at": now(),
        })
        await notify(
            reporter_id,
            "follow",
            user,
            f"{user['name']} started following you.",
            subject_id=user["id"],
            subject_kind="reader",
        )
    return {"ok": True, "following": True, "followers": await _follower_count(reporter_id)}


@api_router.delete("/reporters/{reporter_id}/follow")
async def unfollow_reporter(reporter_id: str, user: dict = Depends(current_user)):
    await db.delete_one("follows", {"reporter_id": reporter_id, "supporter_id": user["id"]})
    return {"ok": True, "following": False, "followers": await _follower_count(reporter_id)}


@api_router.post("/posts")
async def create_post(payload: PostCreate, user: dict = Depends(require_roles("reporter", "admin"))):
    media_data = [m.model_dump() for m in payload.media] if payload.media else []
    post = {
        "id": str(uuid.uuid4()),
        "reporter_id": user["id"],
        "reporter_name": user["name"],
        "title": payload.title,
        "body": payload.body,
        "kind": payload.kind,
        "location": payload.location,
        "media": json.dumps(media_data),
        "verified": user.get("verified", False),
        "stats": "New dispatch",
        "created_at": now(),
    }
    result = await db.insert_one("posts", post)
    # Return media as parsed JSON, not a string
    result["media"] = media_data
    return result


@api_router.get("/posts/mine")
async def my_posts(user: dict = Depends(require_roles("reporter", "admin"))):
    return await db.find_many("posts", {"reporter_id": user["id"]}, order_by="created_at", desc=True, limit=100)


@api_router.get("/reporter/earnings")
async def reporter_earnings(user: dict = Depends(require_roles("reporter", "admin"))):
    """Lifetime earnings breakdown for the signed-in reporter."""
    reporter_id = user["id"]
    # Lifetime verified totals
    totals_rows = await db.rpc("support_totals", {"reporter_ids": [reporter_id]})
    lifetime = 0
    verified_count = 0
    for row in totals_rows:
        if row["reporter_id"] == reporter_id:
            lifetime = row["total"]
            verified_count = row["count"]
    # Pending / created (not yet captured)
    pending_supports = await db.find_many(
        "supports",
        {"reporter_id": reporter_id, "status": {"$in": ["created", "pending"]}},
    )
    pending_amount = sum(s.get("amount", 0) for s in pending_supports)
    pending_count = len(pending_supports)
    # Active monthly pledges
    monthly_pledges = await db.count("supports", {
        "reporter_id": reporter_id,
        "interval": "monthly",
        "status": {"$in": ["verified", "pending"]},
    })
    # Top supporters
    top_rows = await db.rpc("top_supporters", {"target_reporter_id": reporter_id, "max_results": 5})
    top_supporters: list[dict] = []
    for row in top_rows:
        supporter = await db.find_one("users", {"id": row["supporter_id"]})
        top_supporters.append({
            "supporter_id": row["supporter_id"],
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
    post = await db.find_one("posts", {"id": post_id})
    if not post:
        raise HTTPException(404, "Post not found")
    if user["role"] != "admin" and post["reporter_id"] != user["id"]:
        raise HTTPException(403, "You can only delete your own posts")
    await db.delete_one("posts", {"id": post_id})
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
    await db.insert_one("media", {
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
    record = await db.find_one("media", {"upload_id": upload_id})
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
            return {**record, "status": "waiting"}
        asset_res = await http.get(f"https://api.mux.com/video/v1/assets/{asset_id}", auth=auth)
        if asset_res.status_code >= 400:
            raise HTTPException(502, "Mux could not read the asset")
        asset = asset_res.json().get("data", {})
    playback_ids = asset.get("playback_ids") or []
    playback_id = playback_ids[0]["id"] if playback_ids else None
    await db.update_one(
        "media",
        {"upload_id": upload_id},
        {"status": asset.get("status", "processing"), "asset_id": asset_id, "playback_id": playback_id},
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
        playback_ids = data.get("playback_ids") or [{}]
        await db.update_one(
            "media",
            {"upload_id": data.get("upload_id") or data.get("id")},
            {"status": "ready", "asset_id": data.get("id"), "playback_id": playback_ids[0].get("id")},
        )
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
    await db.insert_one("live_sessions", {
        "id": str(uuid.uuid4()),
        "room": room_name,
        "reporter_id": user["id"],
        "reporter_name": user["name"],
        "title": payload.title,
        "status": "live",
        "started_at": now(),
    })
    return {"token": token.to_jwt(), "url": os.environ["LIVEKIT_URL"], "room": room_name}


@api_router.get("/live/sessions")
async def live_sessions():
    return await db.find_many("live_sessions", {"status": "live"}, order_by="started_at", desc=True, limit=50)


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
    session = await db.find_one("live_sessions", {"id": session_id})
    if not session:
        raise HTTPException(404, "Session not found")
    if user["role"] != "admin" and session["reporter_id"] != user["id"]:
        raise HTTPException(403, "You cannot end this session")
    await db.update_one("live_sessions", {"id": session_id}, {"status": "ended", "ended_at": now()})
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
        await db.insert_one("supports", {
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
    await db.insert_one("supports", {
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
    await db.update_one(
        "supports",
        query,
        {"payment_id": payment_id, "status": "verified", "verified_at": now()},
    )
    updated = await db.find_one("supports", query)
    if updated:
        await notify(
            updated["reporter_id"],
            "support",
            user,
            f"{user['name']} sent you ₹{updated['amount']}"
            + (" (monthly pledge)." if updated.get("interval") == "monthly" else "."),
            subject_id=updated["id"],
            subject_kind="support",
        )
    return {"ok": True, "status": "verified"}


@api_router.get("/support/pledges")
async def list_pledges(user: dict = Depends(current_user)):
    """Return the caller's monthly support pledges, one row per subscription."""
    rows = await db.find_many(
        "supports",
        {
            "supporter_id": user["id"],
            "interval": "monthly",
            "status": {"$in": ["pending", "verified", "active"]},
        },
        order_by="created_at",
        desc=True,
        limit=50,
    )
    reporter_ids = list({r["reporter_id"] for r in rows})
    reporters: dict[str, dict] = {}
    if reporter_ids:
        reporter_rows = await db.find_many("users", {"id": {"$in": reporter_ids}})
        for u in reporter_rows:
            reporters[u["id"]] = {"id": u["id"], "name": u["name"], "verified": u.get("verified", False)}
    return [
        {
            "id": r["id"],
            "subscription_id": r.get("subscription_id"),
            "reporter": reporters.get(r["reporter_id"]) or {"id": r["reporter_id"], "name": "Unknown"},
            "amount": r["amount"],
            "status": r["status"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@api_router.post("/support/pledges/{pledge_id}/cancel")
async def cancel_pledge(pledge_id: str, user: dict = Depends(current_user)):
    pledge = await db.find_one("supports", {"id": pledge_id, "supporter_id": user["id"]})
    if not pledge:
        raise HTTPException(404, "Pledge not found")
    if pledge.get("interval") != "monthly":
        raise HTTPException(400, "Only monthly pledges can be cancelled")
    if pledge.get("status") == "cancelled":
        return {"ok": True, "status": "cancelled"}
    subscription_id = pledge.get("subscription_id")
    # If the pledge was created against Razorpay, tell them to stop billing.
    if subscription_id:
        provider_required("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET")
        gateway = razorpay.Client(auth=(os.environ["RAZORPAY_KEY_ID"], os.environ["RAZORPAY_KEY_SECRET"]))
        try:
            gateway.subscription.cancel(subscription_id, {"cancel_at_cycle_end": 0})
        except Exception:
            raise HTTPException(502, "Razorpay could not cancel this subscription")
    await db.update_one(
        "supports",
        {"id": pledge_id},
        {"status": "cancelled", "cancelled_at": now()},
    )
    return {"ok": True, "status": "cancelled"}


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
    if await db.find_one("webhook_events", {"id": event_id}):
        return {"ok": True, "duplicate": True}
    await db.insert_one("webhook_events", {"id": event_id, "event": event.get("event"), "created_at": now()})
    payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    if event.get("event") in {"payment.captured", "order.paid"} and payment.get("order_id"):
        await db.update_one(
            "supports",
            {"order_id": payment["order_id"]},
            {"status": "verified", "payment_id": payment.get("id"), "verified_at": now()},
        )
    return {"ok": True}


@api_router.post("/reports")
async def report_post(payload: ReportCreate, user: dict = Depends(current_user)):
    item = {
        "id": str(uuid.uuid4()),
        "reporter_id": user["id"],
        "reporter_name": user["name"],
        "post_id": payload.post_id,
        "reason": payload.reason,
        "note": payload.note,
        "status": "open",
        "created_at": now(),
    }
    await db.insert_one("moderation", item)
    return item


@api_router.get("/admin/overview")
async def admin_overview(user: dict = Depends(require_roles("admin"))):
    return {
        "users": await db.count("users", {"disabled": False}),
        "reporters": await db.count("users", {"role": "reporter", "disabled": False}),
        "posts": await db.count("posts"),
        "open_reports": await db.count("moderation", {"status": "open"}),
        "live_now": await db.count("live_sessions", {"status": "live"}),
        "queue": await db.find_many("moderation", {"status": "open"}, order_by="created_at", desc=True, limit=20),
    }


@api_router.get("/admin/users")
async def admin_users(user: dict = Depends(require_roles("admin"))):
    users = await db.find_many("users", order_by="created_at", desc=True, limit=200)
    return [_strip_keys(u, ["password_hash"]) for u in users]


@api_router.post("/admin/users/{user_id}/disable")
async def disable_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(400, "You cannot disable your own account")
    result = await db.update_one("users", {"id": user_id}, {"disabled": True, "disabled_at": now()})
    if result is None:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/enable")
async def enable_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.update_one("users", {"id": user_id}, {"disabled": False, "disabled_at": None})
    if result is None:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/verify")
async def verify_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.update_one("users", {"id": user_id}, {"verified": True})
    if result is None:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@api_router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.update_one(
        "moderation",
        {"id": report_id, "status": "open"},
        {"status": "resolved", "resolved_by": user["id"], "resolved_at": now()},
    )
    if result is None:
        raise HTTPException(404, "Open report not found")
    return {"id": report_id, "status": "resolved"}


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)


@app.on_event("shutdown")
async def shutdown_db_client():
    await db.close_db()
