# FreePress Product Requirements & Handoff

## Problem statement
FreePress is a mobile platform for independent reporters, readers, and administrators. Reporters can publish field dispatches and prepare live broadcasts; readers can discover reporting and support creators for ₹7; administrators keep moderation transparent and accountable.

## Architecture
- Expo SDK 54 React Native frontend in `/app/frontend/app/index.tsx`, with role-gated reader, reporter studio, and admin experiences.
- FastAPI backend in `/app/backend/server.py`, mounted under `/api` and bound to the existing service port.
- MongoDB persistence for reporters, posts, support intents, live sessions, and moderation reports.
- Frontend API base uses Expo config first, then `EXPO_PUBLIC_BACKEND_URL`/`EXPO_BACKEND_URL` fallbacks.

## User personas
- Reader/supporter: wants direct, evidence-rich reporting and simple creator support.
- Independent reporter: needs a fast field composer, media choices, and broadcast controls.
- Admin/accountability desk: needs operational visibility and auditable moderation resolution.

## Core requirements
- Separate account-role entry experiences for client, reporter, and admin.
- News feed with topic rail, editorial lead dispatch, reporter identity, verification, save, and support actions.
- Reporter story composer with headline/body, media attachment affordances, location affordance, and publish API.
- Reporter live studio with camera, microphone, torch, quality, preview, and go-live controls.
- ₹7 support intent flow with explicit payment status.
- Admin metrics, moderation queue, report detail modal, and persisted resolution endpoint.
- Transparent moderation language: no silent takedowns, evidence required, and appeals available.

## Implemented (2026-08-19)
- Built the full FreePress visual system using warm paper surfaces, high-contrast editorial hierarchy, utility labels, and role-specific headers.
- Added MongoDB seed data and API endpoints for feed, reporters, posts, support, live sessions, reports, admin overview, and report resolution.
- Added iOS camera/microphone descriptions and Android camera/audio permissions.
- Added visible in-screen success banners for support, publish, go-live, and admin actions; failed publish/live requests no longer show success.
- Verified backend endpoints with curl, linted Python/TypeScript, and tested mobile flows at 390x844.

## Prioritized backlog

### P0
- Add real authentication and role authorization; current role gate is a local product-flow entry, not identity security.
- Connect a payment provider for ₹7 collection; current support collection is **MOCKED** and stores a pending intent.
- Connect a real live transport provider and device capture permissions/session lifecycle; current broadcast transport is **MOCKED**.

### P1
- Implement real media upload/storage for images and video attachments.
- Add reporter profile editing, follows, saved stories, captions/transcripts, and correction history UI.
- Add moderation appeals, audit-log browsing, and admin user management actions.
- Add offline draft persistence and upload retry states.

### P2
- Add notification preferences, richer search/filtering, analytics, and reporter support receipts.
- Add stream health/reconnect telemetry and external camera/mic enumeration where supported.

## Next task list
1. Choose the payment provider and implement ₹7 payment confirmation/webhooks.
2. Choose a live streaming provider and replace the **MOCKED** transport while retaining current controls.
3. Add secure auth/session handling and enforce role permissions on every protected endpoint.
4. Implement real media capture/upload and attach uploaded assets to posts.