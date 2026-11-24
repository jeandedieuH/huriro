# Huriro Mobile (`apps/mobile`)

Expo SDK 58 + React Native 0.88 + Expo Router + Uniwind companion client (§18).

## Non-negotiables

- Reuse workspace packages (`@huriro/contracts`, `@huriro/domain`, `@huriro/sync-client`, `@huriro/i18n`, `@huriro/design-tokens`, `@huriro/editor`, `@huriro/env`) rather than duplicating logic.
- Persist local replica and offline outbox in `expo-sqlite` via `SqliteReplicaStorage`; store tokens exclusively in `expo-secure-store`.
- Push notifications carry hint payloads only (`notificationId`, `entityType`, `entityId`, `deepLink`) — fetch full content after verifying session/workspace context.
- Billing and checkout are **web-only** (Polar international + IremboPay Rwanda Mobile Money); never initiate checkout or IAP from mobile.
