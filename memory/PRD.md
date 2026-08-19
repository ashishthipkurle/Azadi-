# FreePress — PRD

## Product
A mobile-first news platform for independent reporters. Three roles:

1. **Reader (client)** — dispatch wall with **All / Following / Trending** tabs, live-now strip, inline Mux media, ₹7 one-time or monthly Razorpay support, bookmark to a private reading list, manage / cancel pledges, flag posts for moderation.
2. **Reporter** — publishes text dispatches with photo / video attachments, live-streams via LiveKit, tracks lifetime earnings and top supporters.
3. **Admin** — reviews moderation queue, manages users, monitors platform metrics.

## Stack
- Frontend: Expo Router, React Native, `expo-camera`, `expo-image`, `expo-image-picker`, `expo-video`, `expo-secure-store`, `react-native-webview`, `livekit-client`.
- Backend: FastAPI, motor (async MongoDB), PyJWT + `pwdlib` (argon2), `livekit-api`, `razorpay`, Mux via HTTP.
- Storage: MongoDB with `_id` projected out of every response.

## Integrations
Endpoints call `provider_required(...)`, returning HTTP 503 with a friendly `"<feature> is coming soon — add <KEYS> to backend/.env"` message when keys are missing.
- **LiveKit Cloud** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **Mux** — `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`
- **Razorpay** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_MONTHLY_PLAN_ID`

## Auth
Custom JWT (HS256, 7-day exp), argon2 password hashing via `pwdlib`. Role guards use FastAPI dependencies.

## Seeded accounts (dev)
- Admin — `admin@freepress.in` / `admin123`
- Reporter — `rhea@freepress.in` / `reporter123`
- Reader — `reader@freepress.in` / `reader123`

## Screens
- `app/index.tsx` — auth landing.
- `app/(reader)/feed.tsx` — All / Following / Trending tabs, live-now strip, inline Mux media, Support (one-time / monthly), Bookmark toggle, Flag.
- `app/(reader)/saved.tsx` — private reading list, cached locally via `@/src/utils/storage` so it works offline.
- `app/(reader)/pledges.tsx` — manage / cancel monthly ₹7 pledges.
- `app/(reader)/reporter/[id].tsx` — reporter profile with follow, support and inline media.
- `app/(reader)/live/[room].tsx` — LiveKit subscriber viewer.
- `app/(reporter)/studio.tsx` — Write / Go live / Earnings tabs.
- `app/(admin)/dashboard.tsx` — metrics, moderation, user management.

## Key endpoints
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Feed: `GET /feed`, `GET /feed/following` (auth), **`GET /feed/trending`** (public, 24-hour ranked)
- **`POST /posts/{id}/read`** (auth, deduped per day)
- Reporters: `GET /reporters`, `GET /reporters/{id}`, `POST/DELETE /reporters/{id}/follow`
- Posts: `POST /posts`, `GET /posts/mine`, `DELETE /posts/{id}`
- Earnings: `GET /reporter/earnings`
- Media (Mux): `POST /media/upload-url`, `GET /media/{upload_id}`, `POST /webhooks/mux`
- Live (LiveKit): `POST /live/token`, `POST /live/viewer-token`, `GET /live/sessions`, `POST /live/{id}/end`
- Support (Razorpay): `POST /support` (one-time or monthly), `POST /support/verify`, `POST /webhooks/razorpay`
- **Pledges: `GET /support/pledges`, `POST /support/pledges/{id}/cancel`**
- **Bookmarks: `POST /bookmarks`, `DELETE /bookmarks/{post_id}`, `GET /bookmarks`**
- Moderation: `POST /reports`, `POST /reports/{id}/resolve`
- Admin: `GET /admin/overview`, `GET /admin/users`, `POST /admin/users/{id}/{disable|enable|verify}`

## Testing
- 67/67 pytest tests passing across `backend_test.py`, `test_iter4_features.py`, `test_iter5_features.py`, `test_iter6_features.py`
- Frontend lint: 0 issues
