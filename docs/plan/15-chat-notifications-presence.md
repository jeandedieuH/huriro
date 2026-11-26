# 15. Chat, Notifications & Presence

## 15.1 Chat model

| Concept       | Design                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels      | Public (workspace-visible) and private (ACL-gated). Membership is a table, not a policy string.                                                                                                                                                                                                                                                                                                                                |
| DMs           | Modeled as a 2–8 member channel with `kind = 'dm'` — one code path for ordering, pagination, and read state                                                                                                                                                                                                                                                                                                                    |
| Threads       | `thread_parent_id` (self-FK) with denormalized `reply_count`/`last_reply_at` maintained by trigger                                                                                                                                                                                                                                                                                                                             |
| Messages      | Markdown subset rendered through the same sanitizer as docs. Chat is **not** in the workspace `change_log` (its write rate would serialize the whole workspace, §9.2); it has its own **per-channel feed** instead (below)                                                                                                                                                                                                     |
| Ordering      | Two per-channel counters on the channel row, both allocated with the `UPDATE … RETURNING` trick: **`last_msg_seq`** gives every _top-level_ message an immutable `channel_seq` (display order, pagination, unread math); **`last_rev`** is bumped by _every_ change in the channel (new message, thread reply, edit, delete, reaction) and stamped on the row as `rev`. Thread replies get a `thread_seq` within their parent. |
| Channel feed  | `GET /api/v1/chat/channels/:id/changes?since=<rev>` returns rows with `rev > since` (index on `(channel_id, rev)`), tombstones included. The socket signal is `{ t: "chat", channelId, rev }`, sent only to members' sockets. Clients keep one `rev` cursor per _open or recently viewed_ channel and a cheap per-channel `last_msg_seq` summary for the sidebar.                                                              |
| Attachments   | `files` rows linked via `message_attachments`, uploaded through the quarantine flow                                                                                                                                                                                                                                                                                                                                            |
| Link previews | Async unfurl via the SSRF-safe egress proxy; cached with TTL; never blocks send                                                                                                                                                                                                                                                                                                                                                |
| Rich links    | Typed inline nodes for `issue:`, `doc:`, `conversation:` mentions rendered live (title/status/assignee) so pasted links stay useful                                                                                                                                                                                                                                                                                            |
| Reactions     | Separate small table, aggregate counts materialized per message                                                                                                                                                                                                                                                                                                                                                                |

```sql
CREATE TABLE chat_channels (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind         text NOT NULL DEFAULT 'public',   -- public | private | dm
    name         text,                             -- null for DMs
    topic        text,
    last_msg_seq bigint NOT NULL DEFAULT 0,        -- top-level message order counter
    last_rev     bigint NOT NULL DEFAULT 0,        -- channel change-feed counter (every change)
    created_by   uuid NOT NULL REFERENCES users(id),
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name),
    UNIQUE (workspace_id, id)
);
-- Sidebar order is per user (chat_channel_members.position), not a property of the channel.

CREATE TABLE chat_channel_members (
    workspace_id uuid NOT NULL,
    channel_id   uuid NOT NULL,
    principal_type text NOT NULL DEFAULT 'user',   -- 'user' | 'agent'
    principal_id uuid NOT NULL,
    role         text NOT NULL DEFAULT 'member',   -- member | admin
    position     text COLLATE "C",                 -- personal sidebar order (fractional index)
    joined_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, principal_type, principal_id),
    FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id   uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    channel_seq  bigint,                            -- set for top-level messages only
    thread_seq   bigint,                            -- set for thread replies only (order within parent)
    rev          bigint NOT NULL,                   -- channel last_rev at last change (feed cursor)
    CHECK ((thread_parent_id IS NULL) = (channel_seq IS NOT NULL)),
    author_id    uuid NOT NULL REFERENCES users(id),
    thread_parent_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
    client_id    text,                              -- client-generated dedupe id
    body         jsonb NOT NULL,                    -- rich text
    body_text    text NOT NULL,                     -- extracted, for search + notifications
    edited_at    timestamptz,
    deleted_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    version      int NOT NULL DEFAULT 1,
    UNIQUE (channel_id, channel_seq),
    UNIQUE (thread_parent_id, thread_seq)
);
CREATE INDEX idx_messages_chan_seq ON chat_messages (workspace_id, channel_id, channel_seq DESC)
    WHERE deleted_at IS NULL AND thread_parent_id IS NULL;
CREATE INDEX idx_messages_chan_rev ON chat_messages (channel_id, rev);   -- channel change feed
CREATE UNIQUE INDEX uq_messages_client ON chat_messages (workspace_id, channel_id, author_id, client_id)
    WHERE client_id IS NOT NULL;

CREATE TABLE chat_read_state (
    workspace_id uuid NOT NULL,
    channel_id   uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq bigint NOT NULL DEFAULT 0,
    mention_count int NOT NULL DEFAULT 0,
    muted        boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
```

**Send path:** client generates a `client_id` (uuidv7), appends optimistically, sends. The unique index on `client_id` makes retries safe; the response is matched back to the optimistic row. Messages are **immutable in order** (`channel_seq` from the server) — the client re-sorts after confirmation, which is why the optimistic row fades rather than jumps.

**Unread state, without per-message rows:** "has unread" is the O(1) comparison `channel.last_msg_seq > read.last_read_seq` (muted channels excluded). Posting advances the author's own `last_read_seq`, so your own messages never count. The badge _number_ is an indexed count of non-deleted top-level messages with `channel_seq > last_read_seq`, capped at 100 ("99+") — exact, and cheap because it walks at most 100 index entries. `mention_count` is maintained atomically by the notification consumer. Thread replies are tracked per followed thread (`chat_thread_read_state`), not in the channel badge.

**Pagination:** cursor-based on `channel_seq` descending. No offset pagination anywhere in the product.

## 15.2 Presence, typing, read state

| Signal                                 | Storage                                                                              | Lifetime                   |
| :------------------------------------- | :----------------------------------------------------------------------------------- | :------------------------- |
| Online/away                            | Realtime in-memory + Redis with TTL                                                  | Ephemeral (30 s heartbeat) |
| Typing                                 | Realtime only, never persisted                                                       | 5 s                        |
| Viewing (mail/doc collision detection) | Realtime only                                                                        | 30 s                       |
| Read cursor per channel                | Postgres `chat_read_state(channel_id, user_id, last_read_seq, mention_count, muted)` | Durable                    |
| Unread counts                          | Derived, never stored per message (§15.1)                                            | Durable                    |

**Rule: presence is never a database row.** Storing it creates write amplification and stale state. Unread state is derived from sequence numbers, so it cannot drift.

**Notification wake-ups use `LISTEN/NOTIFY` only as a signal, never as transport.** Notify payloads are capped (~8 KB) and a full queue can fail the _committing_ transaction, so the payload is a tiny id and the consumer reads the real data. For multi-instance fan-out use Valkey pub/sub. Notify also historically serialized commits under many writers, so never put it on a hot write path without load-testing the actual version in use.

**Notification fan-out** (on `message.created`):

1. Resolve recipients: channel members minus author, minus muted, minus blocked.
2. Apply rules: direct mention always notifies; thread replies notify thread participants; channel messages notify per user preference (all / mentions / none).
3. Write `notifications` rows + increment unread counters.
4. Dispatch by channel: in-app (socket), email digest (batched, with quiet hours), push (respecting OS-level and per-workspace settings).
5. Collapse duplicates within a window ("3 new messages in #api-design").

## 15.3 Shared user availability

Availability is a **workspace-scoped platform feature**, not a chat-only field
(ADR-0035). Durable state lives in `user_workspace_profiles` (manual override,
custom status, DND timer, timezone, typed weekly working hours, off-hours
notification opt-in) plus `user_availability_windows` (scheduled OOO / focus /
DND with an optional backup delegate). It syncs as the Tier-1
`user_availability` entity, so Chat, Tasks, Mail, Docs, Inbox, Settings, Web,
and Mobile read one replicated answer.

**Resolution order** (pure `packages/domain/availability.ts`, shared by server
and clients):
OOO → DND → focus/busy → manual available/away → working hours → live presence.
Live `online | away` stays ephemeral (registry + pub/sub, TTL), never a
database heartbeat; when no presence is known, consumers fall back to durable
state instead of guessing.

**Enforcement:** notification push/email consult the shared suppression
evaluator (in-app rows always persist; logs record `skipped_dnd`,
`skipped_ooo`, `skipped_off_hours`), with urgent approval/mention overrides
honouring the user's opt-in but never a suppressing OOO window. Mail
round-robin can skip DND/OOO/off-hours users and route to the OOO delegate,
with working-hours enforcement opt-in. The 60-second `availability-sweep`
worker clears expired overrides and emits `availability.ooo.started.v1` /
`.ended.v1` exactly once per window. Guests see only their own row plus
co-members sharing an accessible project/channel/teamspace.
