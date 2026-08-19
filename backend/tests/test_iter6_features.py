"""FreePress iteration-6 backend tests.

New endpoints:
- Bookmarks:  POST /api/bookmarks, DELETE /api/bookmarks/{post_id}, GET /api/bookmarks
- Reads:      POST /api/posts/{id}/read (dedupe per (viewer, post, day))
- Trending:   GET /api/feed/trending (public, includes trending_score & reads_24h)
- Pledges:    GET /api/support/pledges, POST /api/support/pledges/{id}/cancel
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

READER = {"email": "reader@freepress.in", "password": "reader123"}
REPORTER = {"email": "rhea@freepress.in", "password": "reporter123"}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def reader_token() -> str:
    return _login(**READER)


@pytest.fixture(scope="module")
def reporter_token() -> str:
    return _login(**REPORTER)


@pytest.fixture(scope="module")
def seed_post(reporter_token) -> str:
    """Create a TEST post, yield its id, and delete it after the module runs."""
    title = f"TEST iter6 {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/posts",
        json={"title": title, "body": "iter6 test", "kind": "dispatch", "location": "TEST"},
        headers=_auth(reporter_token),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    # cleanup
    requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)


# -------------------- Bookmarks --------------------

class TestBookmarks:
    def test_bookmark_requires_auth(self, seed_post):
        r = requests.post(f"{API}/bookmarks", json={"post_id": seed_post}, timeout=15)
        assert r.status_code == 401, r.text

    def test_list_bookmarks_requires_auth(self):
        r = requests.get(f"{API}/bookmarks", timeout=15)
        assert r.status_code == 401, r.text

    def test_bookmark_unknown_post_returns_404(self, reader_token):
        r = requests.post(
            f"{API}/bookmarks",
            json={"post_id": f"nope-{uuid.uuid4().hex}"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_bookmark_create_get_idempotent_and_delete(self, reader_token, seed_post):
        # Clean prior state
        requests.delete(f"{API}/bookmarks/{seed_post}", headers=_auth(reader_token), timeout=15)

        # Create
        r1 = requests.post(
            f"{API}/bookmarks",
            json={"post_id": seed_post},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        assert r1.json() == {"ok": True, "bookmarked": True}

        # Idempotent second call
        r2 = requests.post(
            f"{API}/bookmarks",
            json={"post_id": seed_post},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json() == {"ok": True, "bookmarked": True}

        # GET returns shape and one row only for this post
        g = requests.get(f"{API}/bookmarks", headers=_auth(reader_token), timeout=15)
        assert g.status_code == 200, g.text
        body = g.json()
        assert set(body.keys()) >= {"post_ids", "posts"}
        assert isinstance(body["post_ids"], list) and isinstance(body["posts"], list)
        assert body["post_ids"].count(seed_post) == 1, body["post_ids"]
        matching = [p for p in body["posts"] if p["id"] == seed_post]
        assert len(matching) == 1
        assert "_id" not in matching[0]

        # DELETE removes
        d1 = requests.delete(
            f"{API}/bookmarks/{seed_post}", headers=_auth(reader_token), timeout=15
        )
        assert d1.status_code == 200
        assert d1.json() == {"ok": True, "bookmarked": False}

        # DELETE again is a no-op
        d2 = requests.delete(
            f"{API}/bookmarks/{seed_post}", headers=_auth(reader_token), timeout=15
        )
        assert d2.status_code == 200
        assert d2.json() == {"ok": True, "bookmarked": False}

        # Now empty
        g2 = requests.get(f"{API}/bookmarks", headers=_auth(reader_token), timeout=15)
        assert g2.status_code == 200
        assert seed_post not in g2.json()["post_ids"]

    def test_bookmarks_ordered_created_at_desc(self, reader_token, reporter_token):
        # Create two posts, bookmark them in order, verify order
        titles = [f"TEST iter6 order {i} {uuid.uuid4().hex[:4]}" for i in range(2)]
        ids = []
        try:
            for t in titles:
                r = requests.post(
                    f"{API}/posts",
                    json={"title": t, "body": "order", "kind": "dispatch", "location": "TEST"},
                    headers=_auth(reporter_token),
                    timeout=15,
                )
                assert r.status_code == 200
                ids.append(r.json()["id"])

            # Bookmark first, then second (second is more recent)
            for pid in ids:
                requests.post(
                    f"{API}/bookmarks",
                    json={"post_id": pid},
                    headers=_auth(reader_token),
                    timeout=15,
                )

            g = requests.get(f"{API}/bookmarks", headers=_auth(reader_token), timeout=15)
            assert g.status_code == 200
            post_ids = g.json()["post_ids"]
            # The most recently bookmarked should come first
            idx0 = post_ids.index(ids[0])
            idx1 = post_ids.index(ids[1])
            assert idx1 < idx0, f"expected desc order by created_at, got {post_ids}"
        finally:
            for pid in ids:
                requests.delete(
                    f"{API}/bookmarks/{pid}", headers=_auth(reader_token), timeout=15
                )
                requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)


# -------------------- Reads + Trending --------------------

class TestReadsAndTrending:
    def test_read_requires_auth(self, seed_post):
        r = requests.post(f"{API}/posts/{seed_post}/read", timeout=15)
        assert r.status_code == 401, r.text

    def test_read_unknown_post_404(self, reader_token):
        r = requests.post(
            f"{API}/posts/nope-{uuid.uuid4().hex}/read",
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_read_dedupes_same_day(self, reader_token, seed_post):
        r1 = requests.post(
            f"{API}/posts/{seed_post}/read", headers=_auth(reader_token), timeout=15
        )
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["ok"] is True
        # first call may be new=True (or False if a prior test already recorded it today)
        assert "new" in body1

        r2 = requests.post(
            f"{API}/posts/{seed_post}/read", headers=_auth(reader_token), timeout=15
        )
        assert r2.status_code == 200
        assert r2.json() == {"ok": True, "new": False}

    def test_trending_public_and_shape(self, reader_token, seed_post):
        # Ensure at least one read exists for the seed post
        requests.post(
            f"{API}/posts/{seed_post}/read", headers=_auth(reader_token), timeout=15
        )

        r = requests.get(f"{API}/feed/trending", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and data, "expected non-empty trending list"
        for post in data:
            assert "_id" not in post
            assert "id" in post
            assert "trending_score" in post
            assert "reads_24h" in post
            assert isinstance(post["trending_score"], int)
            assert isinstance(post["reads_24h"], int)

        matches = [p for p in data if p["id"] == seed_post]
        assert matches, f"seed_post {seed_post} not in trending output"
        seed_row = matches[0]
        assert seed_row["reads_24h"] >= 1
        assert seed_row["trending_score"] >= 1


# -------------------- Pledges --------------------

class TestPledges:
    def test_pledges_requires_auth(self):
        r = requests.get(f"{API}/support/pledges", timeout=15)
        assert r.status_code == 401, r.text

    def test_pledges_empty_for_reader(self, reader_token):
        r = requests.get(f"{API}/support/pledges", headers=_auth(reader_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # In dev there are no monthly pledges seeded → empty list.
        # If somehow seeded, ensure shape.
        for p in data:
            assert set(p.keys()) >= {
                "id", "subscription_id", "reporter", "amount", "status", "created_at",
            }
            assert "_id" not in p

    def test_cancel_pledge_requires_auth(self):
        r = requests.post(f"{API}/support/pledges/some-id/cancel", timeout=15)
        assert r.status_code == 401, r.text

    def test_cancel_unknown_pledge_404(self, reader_token):
        r = requests.post(
            f"{API}/support/pledges/nope-{uuid.uuid4().hex}/cancel",
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_cancel_monthly_pledge_without_subscription_id(self, reader_token):
        """When a monthly pledge has no subscription_id yet, cancel should work
        without hitting Razorpay and return status:cancelled."""
        # Fetch reader id via /auth/me
        me = requests.get(f"{API}/auth/me", headers=_auth(reader_token), timeout=15).json()
        # Insert a fake pledge directly via mongo? No — use API path instead.
        # We can't create a monthly pledge without Razorpay keys via API. So write
        # the pledge doc directly through a hidden path is not available.
        # Instead: use pymongo via env MONGO_URL to seed one TEST pledge.
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa
        # Use pymongo synchronously for simplicity
        try:
            from pymongo import MongoClient
        except ImportError:
            pytest.skip("pymongo not available; skipping direct-seed pledge test")

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("MONGO_URL/DB_NAME not available; cannot seed pledge directly")

        cli = MongoClient(mongo_url)
        try:
            supports = cli[db_name].supports
            pledge_id = f"TEST-pledge-{uuid.uuid4().hex[:8]}"
            supports.insert_one({
                "id": pledge_id,
                "supporter_id": me["id"],
                "reporter_id": "TEST-reporter",
                "amount": 7,
                "interval": "monthly",
                "status": "pending",
                "created_at": "2026-01-01T00:00:00+00:00",
            })

            # GET pledges should include it
            g = requests.get(f"{API}/support/pledges", headers=_auth(reader_token), timeout=15)
            assert g.status_code == 200
            ids = [p["id"] for p in g.json()]
            assert pledge_id in ids

            # Cancel — no subscription_id → bypass Razorpay
            c = requests.post(
                f"{API}/support/pledges/{pledge_id}/cancel",
                headers=_auth(reader_token),
                timeout=15,
            )
            assert c.status_code == 200, c.text
            assert c.json() == {"ok": True, "status": "cancelled"}
        finally:
            cli[db_name].supports.delete_many({"id": {"$regex": "^TEST-pledge-"}})
            cli.close()

    def test_cancel_monthly_pledge_with_subscription_returns_503_without_keys(self, reader_token):
        """When a monthly pledge has a subscription_id and Razorpay keys are
        absent, cancel should return 503 (provider_required)."""
        if os.getenv("RAZORPAY_KEY_ID") and os.getenv("RAZORPAY_KEY_SECRET"):
            pytest.skip("Razorpay configured — cannot assert 503 path")

        try:
            from pymongo import MongoClient
        except ImportError:
            pytest.skip("pymongo not available")

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("MONGO_URL/DB_NAME not available")

        me = requests.get(f"{API}/auth/me", headers=_auth(reader_token), timeout=15).json()
        cli = MongoClient(mongo_url)
        try:
            supports = cli[db_name].supports
            pledge_id = f"TEST-pledge-{uuid.uuid4().hex[:8]}"
            supports.insert_one({
                "id": pledge_id,
                "supporter_id": me["id"],
                "reporter_id": "TEST-reporter",
                "amount": 7,
                "interval": "monthly",
                "subscription_id": "sub_TEST_NOT_REAL",
                "status": "pending",
                "created_at": "2026-01-01T00:00:00+00:00",
            })
            r = requests.post(
                f"{API}/support/pledges/{pledge_id}/cancel",
                headers=_auth(reader_token),
                timeout=15,
            )
            assert r.status_code == 503, r.text
            assert "coming soon" in r.json()["detail"].lower()
        finally:
            cli[db_name].supports.delete_many({"id": {"$regex": "^TEST-pledge-"}})
            cli.close()
