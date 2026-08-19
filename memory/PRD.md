# FreePress — PRD

## Product
A mobile-first news platform for independent reporters. Three roles:

1. **Reader (client)** — reads the dispatch wall, watches live broadcasts, follows reporters, supports them with ₹7 Razorpay payments, flags posts for moderation.
2. **Reporter** — publishes text dispatches (with photo / video attachments via Mux), live-streams via LiveKit, manages their own posts.
3. **Admin** — reviews the moderation queue, manages users (verify / disable / enable), monitors platform metrics.

## Stack
- Frontend: Expo Router, React Native, `expo-camera`, `expo-image-picker`, `expo-secure-store`, `react-native-webview`, `livekit-client`, `@livekit/react-native` (dev-build only).
- Backend: FastAPI, motor (async MongoDB), PyJWT + `pwdlib` (argon2), `livekit-api`, `razorpay`, Mux via HTTP.
- Storage: MongoDB with `_id` projected out of every response.

## Integrations (backend-ready)
Endpoints call `provider_required(...)`, returning HTTP 503 with a friendly `"<feature> is coming soon — add <KEYS> to backend/.env"` message when keys are missing. Frontend surfaces those as info toasts.

- **LiveKit Cloud** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **Mux Direct Uploads** — `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET` (webhook optional in dev — `/api/media/{upload_id}` polls Mux directly)
- **Razorpay ₹7 support** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

## Auth
Custom JWT (HS256, 7-day exp), `JWT_SECRET` in `/app/backend/.env`. Passwords hashed with argon2 via `pwdlib`. Role guards use FastAPI dependencies.

## Seeded accounts (dev)
- Admin — `admin@freepress.in` / `admin123`
- Reporter — `rhea@freepress.in` / `reporter123`
- Reader — `reader@freepress.in` / `reader123`

## Screens
- `app/index.tsx` — auth landing (sign-in / register).
- `app/(reader)/feed.tsx` — dispatch wall, live-now strip, ₹7 support via Razorpay WebView, flag-for-moderation, tap byline → profile.
- `app/(reader)/reporter/[id].tsx` — reporter profile with dispatch count, follower count, ₹ supported total, follow toggle, support button.
- `app/(reader)/live/[room].tsx` — subscriber view for a LiveKit room, remote video via `<LiveStage/>`.
- `app/(reporter)/studio.tsx` — story composer with Mux photo/video upload, live broadcast that publishes camera + mic via LiveKit.
- `app/(admin)/dashboard.tsx` — metrics strip, moderation queue, user management.

Each route group has a `_layout.tsx` that redirects when the current user's role doesn't match.

## Key endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/feed`, `GET /api/reporters` (now with `support_total`), `GET /api/reporters/{id}` (now includes `followers`, `support_total`, `is_following`)
- `POST /api/reporters/{id}/follow`, `DELETE /api/reporters/{id}/follow`
- `POST /api/posts` (optional `media[]`), `GET /api/posts/mine`, `DELETE /api/posts/{id}`
- `POST /api/media/upload-url`, `GET /api/media/{upload_id}` (poll), `POST /api/webhooks/mux`
- `POST /api/live/token` (publisher), `POST /api/live/viewer-token` (subscriber), `GET /api/live/sessions`, `POST /api/live/{id}/end`
- `POST /api/support`, `POST /api/support/verify`, `POST /api/webhooks/razorpay`
- `POST /api/reports`, `POST /api/reports/{id}/resolve`
- `GET /api/admin/overview`, `GET /api/admin/users`, `POST /api/admin/users/{id}/{disable|enable|verify}`

## Testing
- 39/39 pytest tests pass (`/app/backend/tests/backend_test.py` + `test_iter4_features.py`)
- Frontend lint: 0 issues
