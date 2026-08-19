import os
import uuid

import requests


BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def test_public_api_smoke_and_persistence():
    suffix = uuid.uuid4().hex[:8]
    feed = requests.get(f"{BASE_URL}/api/feed", timeout=15)
    assert feed.status_code == 200 and isinstance(feed.json(), list)

    post_payload = {"title": f"TEST dispatch {suffix}", "body": "Regression report"}
    post = requests.post(f"{BASE_URL}/api/posts", json=post_payload, timeout=15)
    assert post.status_code == 200 and post.json()["title"] == post_payload["title"]

    support = requests.post(
        f"{BASE_URL}/api/support", json={"reporter_id": "rhea-iyer", "amount": 7}, timeout=15
    )
    assert support.status_code == 200 and support.json()["status"] == "pending"
    assert "MOCKED" in support.json()["payment_note"]

    live = requests.post(
        f"{BASE_URL}/api/live-sessions",
        json={"title": f"TEST live {suffix}", "camera": "Front camera", "microphone": "External microphone"},
        timeout=15,
    )
    assert live.status_code == 200 and live.json()["status"] == "live"
    assert "MOCKED" in live.json()["stream_note"]

    report = requests.post(
        f"{BASE_URL}/api/reports",
        json={"post_id": post.json()["id"], "reason": "spam", "note": f"TEST {suffix}"},
        timeout=15,
    )
    assert report.status_code == 200 and report.json()["status"] == "open"

    overview = requests.get(f"{BASE_URL}/api/admin/overview", timeout=15)
    assert overview.status_code == 200
    data = overview.json()
    assert all(key in data for key in ("users", "posts", "open_reports", "live_now", "queue"))
    assert any(item["id"] == report.json()["id"] for item in data["queue"])


def test_support_rejects_non_seven_amount():
    response = requests.post(
        f"{BASE_URL}/api/support", json={"reporter_id": "rhea-iyer", "amount": 8}, timeout=15
    )
    assert response.status_code == 400