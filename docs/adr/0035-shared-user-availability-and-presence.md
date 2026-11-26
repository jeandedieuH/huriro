# ADR-0035: Shared User Availability and Presence

- **Status:** Accepted
- **Date:** 2026-11-26
- **Supersedes:** the chat-only `user_workspace_profiles` ownership introduced with M11.

## Context

Availability primitives were fragmented: `user_workspace_profiles` was owned by
`modules/chat`, a single `GET/PUT /chat/me/status` route, an untyped
`working_hours` JSONB, an ephemeral WS `online | away` signal wired only into the
web chat store, and notification/mail code that checked only quiet hours plus a
lazily refreshed `last_seen_at`. Tasks, docs, mail, automations, agents, mobile,
and settings had no shared answer to “is this teammate reachable right now?”.

## Decision

1. **A leaf `availability` server module owns the durable model.**
   `user_workspace_profiles` moves to `packages/db/src/schema/availability.ts`
   and a new `user_availability_windows` table holds scheduled OOO / focus / DND
   blocks with an optional backup delegate. `chat` keeps its M11 routes as thin
   delegating wrappers. A dedicated leaf module avoids a chat↔mail↔notifications
   cycle.
2. **Durable state in Postgres, live presence in a registry.**
   Manual overrides, custom status, DND timers, typed weekly working hours,
   timezone, and scheduled windows are durable rows synced through the Tier-1
   `change_log` as `entity_type = 'user_availability'`. `online | away` remains
   an ephemeral, never-persisted WS hint. A `PresenceRegistry` keeps a TTL view
   (fed by the existing signal pub/sub: Postgres NOTIFY or Valkey) for API and
   worker processes; absence of a registry entry falls back to durable state.
3. **One deterministic precedence ladder** lives in `packages/domain/availability.ts`
   and is shared by server and clients:
   `OOO → DND → focus/busy → manual available/away → working hours → live presence`.
   Derived flags (`isRoutable`, `isAcceptingNotifications`, `nextAvailableAt`,
   `localTimeLabel`) are computed from that ladder, never stored.
4. **Opaque cursor sync only.** Durable availability changes write a
   `user_availability` change-log row (cursor allocated last) and fan out via the
   existing opaque `{ t: 'cursor' }` WS signal. TanStack DB gains a version-guarded
   `userAvailability` collection; the replica schema version bumps to 3 with a
   backward-compatible `snap.userAvailability ?? []` fallback.
5. **Guest visibility is scoped.** Active non-guest members may list/sync all
   active members. Guests see only their own row plus co-members sharing an
   accessible project, channel, or teamspace; the change feed delivers guests
   only their own `user_availability` rows.
6. **Enforcement is explicit and opt-in-safe.** Notification push/email use the
   shared suppression evaluator (in-app rows always persist; delivery logs record
   `skipped_dnd` / `skipped_ooo` / `skipped_off_hours`). Urgent approvals/direct
   mentions bypass DND and quiet hours when allowed, but never a suppressing OOO
   window. Mail round-robin defaults to `respect_ooo = true`,
   `use_ooo_delegate = true`, `respect_working_hours = false`; when no realtime
   presence is known it falls back to durable availability instead of starving
   assignment.
7. **Self-scoped writes.** Only the user may edit their own availability or
   windows. `member.manage` does not grant cross-user status edits. Agents may
   inspect availability with `members.read` and update only their owner’s status
   through the `availability.write` scope.

## Consequences

- New tenant table `user_availability_windows` (RLS + coverage-test entry) and
  additive columns on `user_workspace_profiles`, `mail_inbox_routing_state`, and
  `notification_delivery_log`.
- A 60-second `availability-sweep` worker clears expired overrides and emits
  `availability.ooo.started.v1` / `.ended.v1` exactly once per window.
- Web and mobile share `PresenceActivityController` for idle/background
  transitions; clients compute effective state from the replicated row plus
  live presence so relative labels and expirations stay correct offline.
- Automation actions gain `mail.route_round_robin` and OOO-delegate resolution
  for `issue.update` / `mail.assign`; `{{userId}}` and `{{delegateUserId}}`
  templates are available on `availability.*` events.
