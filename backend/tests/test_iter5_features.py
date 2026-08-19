"""FreePress iteration-5 backend tests.

Covers the four new/extended features:
- GET  /api/feed/following (auth-gated; empty until follows exist; returns followed reporter's posts)
- GET  /api/reporter/earnings (reporter/admin only; correct shape with zero defaults)
- POST /api/support with interval='monthly' — 503 with RAZORPAY_MONTHLY_PLAN_ID hint
- POST /api/support with interval='once'    — 503 friendly (existing RAZORPAY_KEY_ID path)
- POST /api/support with interval='weekly'  — 400 (validation)
- POST /api/support with amount != 7        — 400 regardless of interval
- POST /api/support/verify with subscription id — 503 in dev without keys
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


# -------------------- Following feed --------------------

class TestFollowingFeed:
    def test_following_feed_requires_auth(self):
        r = requests.get(f"{API}/feed/following", timeout=15)
        assert r.status_code == 401, r.text

    def test_following_feed_empty_before_follow(self, reader_token, reporter_id):
        # Ensure clean state (unfollow if any)
        requests.delete(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
        r = requests.get(f"{API}/feed/following", headers=_auth(reader_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert data == []

    def test_following_feed_returns_posts_after_follow(self, reader_token, reporter_token, reporter_id):
        # Ensure a post exists from that reporter
        title = f"TEST iter5 following {uuid.uuid4().hex[:6]}"
        create = requests.post(
            f"{API}/posts",
            json={"title": title, "body": "iter5", "kind": "dispatch", "location": "TEST"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert create.status_code == 200, create.text
        pid = create.json()["id"]

        # Follow the reporter
        f = requests.post(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
        assert f.status_code == 200

        try:
            r = requests.get(f"{API}/feed/following", headers=_auth(reader_token), timeout=15)
            assert r.status_code == 200
            data = r.json()
            assert isinstance(data, list) and data, "expected posts from followed reporter"
            # All entries must be from the followed reporter and have no _id leak
            for post in data:
                assert "_id" not in post
                assert post["reporter_id"] == reporter_id
            assert any(p["id"] == pid for p in data)
        finally:
            # cleanup: unfollow + delete post
            requests.delete(f"{API}/reporters/{reporter_id}/follow", headers=_auth(reader_token), timeout=15)
            requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)


# -------------------- Reporter earnings --------------------

class TestReporterEarnings:
    def test_earnings_requires_reporter_role(self, reader_token):
        r = requests.get(f"{API}/reporter/earnings", headers=_auth(reader_token), timeout=15)
        assert r.status_code == 403, r.text

    def test_earnings_requires_auth(self):
        r = requests.get(f"{API}/reporter/earnings", timeout=15)
        assert r.status_code == 401, r.text

    def test_earnings_shape_for_reporter(self, reporter_token):
        r = requests.get(f"{API}/reporter/earnings", headers=_auth(reporter_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("lifetime", "verified_count", "pending_amount", "pending_count", "monthly_pledges", "top_supporters"):
            assert key in body, f"missing {key}"
        assert isinstance(body["lifetime"], int)
        assert isinstance(body["verified_count"], int)
        assert isinstance(body["pending_amount"], int)
        assert isinstance(body["pending_count"], int)
        assert isinstance(body["monthly_pledges"], int)
        assert isinstance(body["top_supporters"], list)
        # No verified supports were seeded / created for rhea in dev → all zeros
        # (Verified supports require a real Razorpay flow which is not configured.)
        assert body["lifetime"] == 0
        assert body["verified_count"] == 0
        assert body["top_supporters"] == []


# -------------------- Support: interval / amount validation & 503 gating --------------------

class TestSupportInterval:
    def _reporter_id(self) -> str:
        # Grab a reporter id from public listing so we do not need auth here.
        r = requests.get(f"{API}/reporters", timeout=15)
        assert r.status_code == 200 and r.json()
        return r.json()[0]["id"]

    def test_support_monthly_returns_503_mentioning_plan_id(self, reader_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 7, "interval": "monthly"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 503, r.text
        detail = r.json()["detail"]
        # Either the outer RAZORPAY_KEY_ID guard OR the monthly plan hint may fire depending on env.
        # In dev both keys are missing → outer guard fires first with "coming soon".
        # If RAZORPAY_KEY_ID/SECRET are set but plan id isn't, the monthly-specific message fires.
        razorpay_configured = all(os.getenv(k) for k in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"))
        if razorpay_configured and not os.getenv("RAZORPAY_MONTHLY_PLAN_ID"):
            assert "RAZORPAY_MONTHLY_PLAN_ID" in detail, detail
        else:
            assert "coming soon" in detail.lower(), detail

    def test_support_once_returns_503_when_keys_missing(self, reader_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 7, "interval": "once"},
            headers=_auth(reader_token),
            timeout=15,
        )
        # In dev RAZORPAY_KEY_ID is absent → 503 friendly.
        if not os.getenv("RAZORPAY_KEY_ID"):
            assert r.status_code == 503, r.text
            assert "coming soon" in r.json()["detail"].lower()
        else:
            # If configured this would attempt a real order; skip in that case.
            assert r.status_code in (200, 503)

    def test_support_invalid_interval_returns_400(self, reader_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 7, "interval": "weekly"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "interval" in r.json()["detail"].lower()

    def test_support_wrong_amount_returns_400_once(self, reader_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 10, "interval": "once"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "₹7" in r.json()["detail"] or "7" in r.json()["detail"]

    def test_support_wrong_amount_returns_400_monthly(self, reader_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 42, "interval": "monthly"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_support_requires_client_role(self, reporter_token):
        rid = self._reporter_id()
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": rid, "amount": 7, "interval": "monthly"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 403, r.text


# -------------------- Support verify with subscription id --------------------

class TestSupportVerifySubscription:
    def test_verify_subscription_503_without_keys(self, reader_token):
        r = requests.post(
            f"{API}/support/verify",
            json={
                "razorpay_subscription_id": "sub_TEST",
                "razorpay_payment_id": "pay_TEST",
                "razorpay_signature": "sig_TEST",
            },
            headers=_auth(reader_token),
            timeout=15,
        )
        if not os.getenv("RAZORPAY_KEY_ID"):
            assert r.status_code == 503, r.text
            assert "coming soon" in r.json()["detail"].lower()
        else:
            # With keys present, invalid signature should yield 400.
            assert r.status_code == 400, r.text
