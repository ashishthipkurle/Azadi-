# FreePress — PRD

## Product
A mobile-first news platform for independent reporters. Three roles:

1. **Reader (client)** — dispatch wall with All / Following tabs, watches live broadcasts, follows reporters, supports them one-time or with a monthly ₹7 Razorpay pledge, flags posts for moderation.
2. **Reporter** — publishes text dispatches (with photo / video attachments via Mux), live-streams via LiveKit, tracks lifetime earnings and top supporters.
3. **Admin** — reviews the moderation queue, manages users (verify / disable / enable), monitors platform metrics.

## Stack
- Frontend: Expo Router, React Native, `expo-camera`, `expo-image`, `expo-image-picker`, `expo-video`, `expo-secure-store`, `react-native-webview`, `livekit-client`, `@livekit/react-native` (dev-build only).
- Backend: FastAPI, motor (async MongoDB), PyJWT + `pwdlib` (argon2), `livekit-api`, `razorpay`, Mux via HTTP.
- Storage: MongoDB with `_id` projected out of every response.

## Integrations
Endpoints call `provider_required(...)`, returning HTTP 503 with a friendly `"<feature> is coming soon — add <KEYS> to backend/.env"` message when keys are missing.

- **LiveKit Cloud** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **Mux Direct Uploads** — `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET` (webhook optional in dev — `/api/media/{upload_id}` polls Mux directly)
- **Razorpay ₹7 support** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_MONTHLY_PLAN_ID` (a ₹7 monthly plan created in the Razorpay dashboard) for recurring pledges.

## Auth
Custom JWT (HS256, 7-day exp), `JWT_SECRET` in `/app/backend/.env`. Passwords hashed with argon2 via `pwdlib`. Role guards use FastAPI dependencies.

## Seeded accounts (dev)
- Admin — `admin@freepress.in` / `admin123`
- Reporter — `rhea@freepress.in` / `reporter123`
- Reader — `reader@freepress.in` / `reader123`

## Screens
- `app/index.tsx` — auth landing (sign-in / register).
- `app/(reader)/feed.tsx` — **All / Following tabs**, live-now strip, inline Mux media, Support ₹7 (one-time / monthly picker) via Razorpay WebView.
- `app/(reader)/reporter/[id].tsx` — reporter profile with dispatch count, followers, ₹ supported total, follow toggle, inline media.
- `app/(reader)/live/[room].tsx` — subscriber view for a LiveKit room.
- `app/(reporter)/studio.tsx` — **Write / Go live / Earnings** tabs. Write publishes with Mux attachments. Go live publishes via LiveKit. Earnings shows lifetime ₹, verified supporter count, monthly pledges, pending, and top-5 supporters.
- `app/(admin)/dashboard.tsx` — metrics strip, moderation queue, user management.

## Key endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/feed`, **`GET /api/feed/following`** (auth required)
- `GET /api/reporters` (with `support_total`), `GET /api/reporters/{id}` (includes `followers`, `support_total`, `is_following`)
- `POST /api/reporters/{id}/follow`, `DELETE /api/reporters/{id}/follow`
- `POST /api/posts` (optional `media[]`), `GET /api/posts/mine`, `DELETE /api/posts/{id}`
- **`GET /api/reporter/earnings`** (reporter/admin)
- `POST /api/media/upload-url`, `GET /api/media/{upload_id}`, `POST /api/webhooks/mux`
- `POST /api/live/token`, `POST /api/live/viewer-token`, `GET /api/live/sessions`, `POST /api/live/{id}/end`
- **`POST /api/support`** with `interval: "once" | "monthly"`, **`POST /api/support/verify`** accepts subscription flows, `POST /api/webhooks/razorpay`
- `POST /api/reports`, `POST /api/reports/{id}/resolve`
- `GET /api/admin/overview`, `GET /api/admin/users`, `POST /api/admin/users/{id}/{disable|enable|verify}`

## Testing
- 52/52 pytest tests pass (`backend_test.py` + `test_iter4_features.py` + `test_iter5_features.py`)
- Frontend lint: 0 issues
