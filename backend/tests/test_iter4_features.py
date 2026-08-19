"""FreePress iteration-4 backend tests.

Covers the four new/extended features:
- POST /api/live/viewer-token (auth-gated, 400 on empty room, 503 without LIVEKIT keys)
- GET  /api/media/{upload_id} (503 friendly without MUX keys)
- GET  /api/reporters (support_total field per reporter)
- GET  /api/reporters/{id} (extended shape + is_following)
- POST/DELETE /api/reporters/{id}/follow (idempotent, self/unknown guards)
- POST /api/posts with media list (survives on /feed)
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@freepress.in", "password": "admin123"}
REPORTER = {"email": "rhea@freepress.in", "password": "reporter123"}
READER = {"email": "reader@freepress.in", "password": "reader123"}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(**ADMIN)


@pytest.fixture(scope="module")
def reporter_token() -> str:
    return _login(**REPORTER)


@pytest.fixture(scope="module")
def reader_token() -> str:
    return _login(**READER)


@pytest.fixture(scope="module")
def reporter_id(reporter_token) -> str:
    r = requests.get(f"{API}/auth/me", headers=_auth(reporter_token), timeout=15)
    return r.json()["id"]


@pytest.fixture(scope="module")
def reader_id(reader_token) -> str:
    r = requests.get(f"{API}/auth/me", headers=_auth(reader_token), timeout=15)
    return r.json()["id"]


# -------------------- Live viewer-token --------------------

class TestLiveViewerToken:
    def test_viewer_token_requires_auth(self):
        r = requests.post(f"{API}/live/viewer-token", json={"room": "any"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_viewer_token_503_when_livekit_missing(self, reader_token):
        r = requests.post(
            f"{API}/live/viewer-token",
            json={"room": "freepress-demo"},
            headers=_auth(reader_token),
            timeout=15,
        )
        # LIVEKIT_* keys are not set in dev, so we expect a friendly 503.
        assert r.status_code == 503, r.text
        assert "coming soon" in r.json()["detail"].lower()

    def test_viewer_token_empty_room_returns_400(self, reader_token):
        """When LIVEKIT keys are absent the provider_required guard fires first
        and returns 503; when they are present the missing-room check should
        return 400. Assert one of those two, and specifically 400 when keys exist.
        """
        r = requests.post(
            f"{API}/live/viewer-token",
            json={"room": ""},
            headers=_auth(reader_token),
            timeout=15,
        )
        livekit_configured = all(os.getenv(k) for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"))
        if livekit_configured:
            assert r.status_code == 400, r.text
        else:
            # In dev the provider guard runs before the room check.
            assert r.status_code in (400, 503), r.text


# -------------------- Media status polling --------------------

class TestMediaStatus:
    def test_media_status_requires_auth(self):
        r = requests.get(f"{API}/media/some-upload-id", timeout=15)
        assert r.status_code == 401

    def test_media_status_503_without_mux(self, reporter_token):
        r = requests.get(
            f"{API}/media/some-upload-id",
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 503, r.text
        assert "coming soon" in r.json()["detail"].lower()


# -------------------- Reporters listing + profile --------------------

class TestReportersShape:
    def test_list_has_support_total(self):
        r = requests.get(f"{API}/reporters", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and data
        for item in data:
            assert "_id" not in item
            assert "support_total" in item
            assert isinstance(item["support_total"], int)
            assert "followers" in item

    def test_reporter_detail_shape_unauth(self, reporter_id):
        r = requests.get(f"{API}/reporters/{reporter_id}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reporter" in body and "posts" in body
        rep = body["reporter"]
        for key in ("id", "name", "email", "role", "followers", "support_total", "is_following"):
            assert key in rep, f"missing {key}"
        assert rep["is_following"] is False
        assert isinstance(body["posts"], list)

    def test_reporter_detail_unknown_returns_404(self):
        r = requests.get(f"{API}/reporters/{uuid.uuid4()}", timeout=15)
        assert r.status_code == 404


# -------------------- Follow / Unfollow --------------------

class TestFollow:
    def test_follow_self_returns_400(self, reporter_token, reporter_id):
        r = requests.post(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reporter_token), timeout=15)
        assert r.status_code == 400, r.text

    def test_follow_unknown_returns_404(self, reader_token):
        r = requests.post(f"{API}/reporters/{uuid.uuid4()}/follow", headers=_auth(reader_token), timeout=15)
        assert r.status_code == 404, r.text

    def test_follow_requires_auth(self, reporter_id):
        r = requests.post(f"{API}/reporters/{reporter_id}/follow", timeout=15)
        assert r.status_code == 401

    def test_follow_idempotent_then_unfollow(self, reader_token, reporter_id):
        # Ensure clean state
        requests.delete(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)

        # First follow
        r1 = requests.post(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["ok"] is True and body1["following"] is True
        count_after_first = body1["followers"]

        # Second follow — idempotent
        r2 = requests.post(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["following"] is True
        assert body2["followers"] == count_after_first, "follow should be idempotent"

        # is_following reflected on GET /reporters/{id}
        detail = requests.get(
            f"{API}/reporters/{reporter_id}",
            headers=_auth(reader_token),
            timeout=15,
        ).json()
        assert detail["reporter"]["is_following"] is True
        assert detail["reporter"]["followers"] == count_after_first

        # Unfollow decrements
        d = requests.delete(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
        assert d.status_code == 200
        db = d.json()
        assert db["following"] is False
        assert db["followers"] == count_after_first - 1

        # Detail now shows is_following false
        detail2 = requests.get(
            f"{API}/reporters/{reporter_id}",
            headers=_auth(reader_token),
            timeout=15,
        ).json()
        assert detail2["reporter"]["is_following"] is False


# -------------------- Posts with media --------------------

class TestPostsWithMedia:
    def test_post_with_media_survives_on_feed(self, reporter_token):
        title = f"TEST media {uuid.uuid4().hex[:6]}"
        playback_id = f"pbtest{uuid.uuid4().hex[:10]}"
        r = requests.post(
            f"{API}/posts",
            json={
                "title": title,
                "body": "with media",
                "kind": "dispatch",
                "location": "TEST",
                "media": [{"kind": "image", "playback_id": playback_id}],
            },
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert isinstance(created.get("media"), list) and created["media"]
        assert created["media"][0]["playback_id"] == playback_id

        feed = requests.get(f"{API}/feed", timeout=15).json()
        found = next((p for p in feed if p["id"] == created["id"]), None)
        assert found is not None, "created post not present on feed"
        assert found.get("media"), "media list missing on feed entry"
        assert found["media"][0]["playback_id"] == playback_id

        # cleanup
        requests.delete(f"{API}/posts/{created['id']}", headers=_auth(reporter_token), timeout=15)
