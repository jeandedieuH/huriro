# @huriro/sync-client

Client local-first replication adapter over Huriro's change feed (§9.5).

## Owns

- `src/storage.ts` — `ReplicaStorage` (OPFS → IndexedDB → Memory fallback)
- `src/collections.ts` — TanStack DB collections (`projects`, `projectStatuses`, `labels`, `cycles`, `issues`, `savedViews`, `notifications`)
- `src/outbox.ts` — `@tanstack/offline-transactions` durable mutation queue (5,000 / 25 MB cap) + 3-way conflict handling
- `src/ws-signal.ts` — WebSocket signal client (`/ws?v=1`) + 10 s degraded HTTP poll + multi-tab leader coordination
- `src/engine.ts` & `src/react.tsx` — `HuriroSyncEngine`, `SyncProvider`, `useLiveQuery`

## Never do

- Never import `@huriro/db` or server modules.
- Never copy replicated server data into Zustand — query TanStack DB collections directly.
