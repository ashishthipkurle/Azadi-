"""FreePress backend regression tests.

Covers auth (register/login/me), public endpoints (feed/reporters),
role-gated post CRUD, provider-gated 503 endpoints (support/live/media),
report moderation flow, and admin user management.
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


@pytest.fixture(scope="session")
def admin_token() -> str:
    return _login(**ADMIN)


@pytest.fixture(scope="session")
def reporter_token() -> str:
    return _login(**REPORTER)


@pytest.fixture(scope="session")
def reader_token() -> str:
    return _login(**READER)


# -------------------- Auth: register --------------------

class TestRegister:
    def test_register_client_returns_bearer(self):
        payload = {
            "name": "TEST Reader",
            "email": f"test_reader_{uuid.uuid4().hex[:8]}@example.com",
            "password": "secret123",
            "role": "client",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]
        assert body["user"]["role"] == "client"
        assert body["user"]["email"] == payload["email"]
        assert "password_hash" not in body["user"]

    def test_register_reporter_returns_bearer(self):
        payload = {
            "name": "TEST Reporter",
            "email": f"test_reporter_{uuid.uuid4().hex[:8]}@example.com",
            "password": "secret123",
            "role": "reporter",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "reporter"

    def test_register_duplicate_email_returns_409(self):
        # admin@freepress.in is seeded
        r = requests.post(
            f"{API}/auth/register",
            json={"name": "Dup", "email": "admin@freepress.in", "password": "whatever", "role": "client"},
            timeout=15,
        )
        assert r.status_code == 409, r.text


# -------------------- Auth: login / me --------------------

class TestLogin:
    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
        assert r.status_code == 200 and r.json()["user"]["role"] == "admin"

    def test_reporter_login(self):
        r = requests.post(f"{API}/auth/login", json=REPORTER, timeout=15)
        assert r.status_code == 200 and r.json()["user"]["role"] == "reporter"

    def test_reader_login(self):
        r = requests.post(f"{API}/auth/login", json=READER, timeout=15)
        assert r.status_code == 200 and r.json()["user"]["role"] == "client"

    def test_wrong_password_returns_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrongpass"}, timeout=15)
        assert r.status_code == 401

    def test_me_without_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_token(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


# -------------------- Public endpoints --------------------

class TestPublic:
    def test_feed_is_public_array(self):
        r = requests.get(f"{API}/feed", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for item in data:
            assert "_id" not in item

    def test_reporters_is_public_array(self):
        r = requests.get(f"{API}/reporters", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for item in data:
            assert "_id" not in item


# -------------------- Posts (role-gated) --------------------

class TestPosts:
    def test_reporter_can_create_and_list_mine(self, reporter_token):
        title = f"TEST dispatch {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/posts",
            json={"title": title, "body": "field body", "kind": "dispatch", "location": "TEST"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["title"] == title
        assert "_id" not in created

        mine = requests.get(f"{API}/posts/mine", headers=_auth(reporter_token), timeout=15)
        assert mine.status_code == 200
        assert any(p["id"] == created["id"] for p in mine.json())

    def test_reader_cannot_create_post(self, reader_token):
        r = requests.post(
            f"{API}/posts",
            json={"title": "should fail", "body": "x"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 403

    def test_delete_own_post_succeeds(self, reporter_token):
        r = requests.post(
            f"{API}/posts",
            json={"title": f"TEST del {uuid.uuid4().hex[:6]}", "body": "x"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        pid = r.json()["id"]
        d = requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)
        assert d.status_code == 200 and d.json()["ok"] is True
        # verify persistence: further delete returns 404
        d2 = requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)
        assert d2.status_code == 404

    def test_other_reporter_cannot_delete(self, reporter_token):
        # create a post as rhea
        r = requests.post(
            f"{API}/posts",
            json={"title": f"TEST other {uuid.uuid4().hex[:6]}", "body": "x"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        pid = r.json()["id"]
        # register a second reporter and try to delete rhea's post
        other = requests.post(
            f"{API}/auth/register",
            json={
                "name": "TEST Other",
                "email": f"test_other_{uuid.uuid4().hex[:8]}@example.com",
                "password": "secret123",
                "role": "reporter",
            },
            timeout=15,
        ).json()
        d = requests.delete(f"{API}/posts/{pid}", headers=_auth(other["access_token"]), timeout=15)
        assert d.status_code == 403
        # cleanup
        requests.delete(f"{API}/posts/{pid}", headers=_auth(reporter_token), timeout=15)

    def test_admin_can_delete_any_post(self, reporter_token, admin_token):
        r = requests.post(
            f"{API}/posts",
            json={"title": f"TEST admin-del {uuid.uuid4().hex[:6]}", "body": "x"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        pid = r.json()["id"]
        d = requests.delete(f"{API}/posts/{pid}", headers=_auth(admin_token), timeout=15)
        assert d.status_code == 200


# -------------------- Provider-gated 503s --------------------

class TestProviderGating:
    def test_support_returns_503_friendly(self, reader_token):
        r = requests.post(
            f"{API}/support",
            json={"reporter_id": "any", "amount": 7},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 503, r.text
        assert "coming soon" in r.json()["detail"].lower()

    def test_live_token_returns_503_friendly(self, reporter_token):
        r = requests.post(
            f"{API}/live/token",
            json={"title": "TEST live"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 503
        assert "coming soon" in r.json()["detail"].lower()

    def test_media_upload_returns_503_friendly(self, reporter_token):
        r = requests.post(
            f"{API}/media/upload-url",
            json={"filename": "a.mp4", "content_type": "video/mp4"},
            headers=_auth(reporter_token),
            timeout=15,
        )
        assert r.status_code == 503
        assert "coming soon" in r.json()["detail"].lower()


# -------------------- Reports & moderation --------------------

class TestReports:
    def test_authenticated_user_can_report(self, reader_token):
        # need a post id to attach
        feed = requests.get(f"{API}/feed", timeout=15).json()
        assert feed, "expected seeded posts"
        post_id = feed[0]["id"]
        r = requests.post(
            f"{API}/reports",
            json={"post_id": post_id, "reason": "spam", "note": "TEST"},
            headers=_auth(reader_token),
            timeout=15,
        )
        assert r.status_code == 200 and r.json()["status"] == "open"
        assert "_id" not in r.json()

    def test_resolve_requires_admin_and_is_idempotent(self, reader_token, reporter_token, admin_token):
        # create a report
        feed = requests.get(f"{API}/feed", timeout=15).json()
        post_id = feed[0]["id"]
        rep = requests.post(
            f"{API}/reports",
            json={"post_id": post_id, "reason": "abuse", "note": "TEST resolve"},
            headers=_auth(reader_token),
            timeout=15,
        ).json()
        rid = rep["id"]

        # non-admin (reporter) cannot resolve
        forbidden = requests.post(f"{API}/reports/{rid}/resolve", headers=_auth(reporter_token), timeout=15)
        assert forbidden.status_code == 403

        # admin resolves
        ok = requests.post(f"{API}/reports/{rid}/resolve", headers=_auth(admin_token), timeout=15)
        assert ok.status_code == 200 and ok.json()["status"] == "resolved"

        # second resolve -> 404
        again = requests.post(f"{API}/reports/{rid}/resolve", headers=_auth(admin_token), timeout=15)
        assert again.status_code == 404


# -------------------- Admin endpoints --------------------

class TestAdmin:
    def test_overview_requires_admin(self, reader_token, admin_token):
        forbidden = requests.get(f"{API}/admin/overview", headers=_auth(reader_token), timeout=15)
        assert forbidden.status_code == 403
        ok = requests.get(f"{API}/admin/overview", headers=_auth(admin_token), timeout=15)
        assert ok.status_code == 200
        data = ok.json()
        for key in ("users", "reporters", "posts", "open_reports", "live_now", "queue"):
            assert key in data

    def test_admin_users_list(self, admin_token, reader_token):
        forbidden = requests.get(f"{API}/admin/users", headers=_auth(reader_token), timeout=15)
        assert forbidden.status_code == 403
        r = requests.get(f"{API}/admin/users", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        for u in users:
            assert "password_hash" not in u
            assert "_id" not in u

    def test_disable_enable_verify_flow(self, admin_token):
        # create a throwaway user
        email = f"test_disable_{uuid.uuid4().hex[:8]}@example.com"
        reg = requests.post(
            f"{API}/auth/register",
            json={"name": "TEST Disable", "email": email, "password": "secret123", "role": "client"},
            timeout=15,
        ).json()
        uid = reg["user"]["id"]

        # disable
        d = requests.post(f"{API}/admin/users/{uid}/disable", headers=_auth(admin_token), timeout=15)
        assert d.status_code == 200

        # disabled user login must fail with 403
        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "secret123"}, timeout=15)
        assert login.status_code == 403

        # enable
        e = requests.post(f"{API}/admin/users/{uid}/enable", headers=_auth(admin_token), timeout=15)
        assert e.status_code == 200

        # verify
        v = requests.post(f"{API}/admin/users/{uid}/verify", headers=_auth(admin_token), timeout=15)
        assert v.status_code == 200

        # persistence: appears verified in admin/users
        users = requests.get(f"{API}/admin/users", headers=_auth(admin_token), timeout=15).json()
        u = next((x for x in users if x["id"] == uid), None)
        assert u is not None and u.get("verified") is True and u.get("disabled") in (False, None)

    def test_admin_cannot_disable_self(self, admin_token):
        me = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15).json()
        r = requests.post(f"{API}/admin/users/{me['id']}/disable", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 400

    def test_non_admin_cannot_disable(self, reader_token, admin_token):
        me = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15).json()
        r = requests.post(f"{API}/admin/users/{me['id']}/disable", headers=_auth(reader_token), timeout=15)
        assert r.status_code == 403
