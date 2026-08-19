# FreePress — PRD

## Product
A mobile-first news platform for independent reporters. Three roles:

1. **Reader (client)** — reads the dispatch wall, supports reporters with ₹7 payments, flags posts for moderation.
2. **Reporter** — publishes text dispatches, records live streams from device camera + mic, manages their own posts.
3. **Admin** — reviews the moderation queue, manages users (verify / disable / re-enable), monitors platform metrics.

## Stack
- Frontend: Expo Router, React Native, `expo-camera`, `expo-secure-store`, `@livekit/react-native` (ready for keys).
- Backend: FastAPI, motor (async MongoDB), PyJWT + `pwdlib` (argon2) for auth, `livekit-api` / `razorpay` / Mux HTTP client for integrations.
- Storage: MongoDB (single database, no ObjectIds leak — every response projects `_id: 0`).

## Integrations (backend-ready, keys pending)
All third-party endpoints call `provider_required(...)` which returns HTTP 503 with a friendly `"<feature> is coming soon — add <KEYS> to backend/.env"` message when configuration is missing. The frontend surfaces those messages as info toasts, so nothing silently fails.

- **LiveKit Cloud** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **Mux Direct Uploads** — `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`
- **Razorpay ₹7 support** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

## Auth
Custom JWT (HS256, 7-day exp). `JWT_SECRET` is seeded in `/app/backend/.env` for dev. Passwords hashed with argon2 via `pwdlib`. Role guards implemented as FastAPI dependencies (`require_roles("reporter", "admin")` etc.).

## Seeded accounts (dev)
- Admin — `admin@freepress.in` / `admin123`
- Reporter — `rhea@freepress.in` / `reporter123`
- Reader — `reader@freepress.in` / `reader123`

## Screens
- `/app/frontend/app/index.tsx` — auth landing (sign-in / register).
- `/app/frontend/app/(reader)/feed.tsx` — dispatch wall, ₹7 support, flag-for-moderation.
- `/app/frontend/app/(reporter)/studio.tsx` — story composer + live stream setup with real camera preview.
- `/app/frontend/app/(admin)/dashboard.tsx` — metrics strip, moderation queue, user management.

Each route group has a `_layout.tsx` that redirects when the current user's role doesn't match.

## Key endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/feed`, `GET /api/reporters`, `GET /api/reporters/{id}`
- `POST /api/posts`, `GET /api/posts/mine`, `DELETE /api/posts/{id}`
- `POST /api/media/upload-url`, `POST /api/webhooks/mux`
- `POST /api/live/token`, `GET /api/live/sessions`, `POST /api/live/{id}/end`
- `POST /api/support`, `POST /api/support/verify`, `POST /api/webhooks/razorpay`
- `POST /api/reports`, `POST /api/reports/{id}/resolve`
- `GET /api/admin/overview`, `GET /api/admin/users`, `POST /api/admin/users/{id}/{disable|enable|verify}`
