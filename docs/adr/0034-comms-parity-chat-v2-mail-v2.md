# ADR-0034: M11 Communications Parity — Chat v2 (Slack) & Mail v2 (Front/Superhuman)

- **Status:** Accepted
- **Date:** 2026-11-26
- **Plan refs:** advanced-features-plan M11, §15 (chat), §14/§6 (mail)

## Context

M11 brings chat to Slack parity and mail to Front/Superhuman parity. The
cross-cutting design questions:

1. **Broadcast thread replies** (Slack "also send to channel") break the M4
   invariant that a message is either a top-level channel entry (`channel_seq`)
   or a thread reply (`thread_seq`) — never both. Ordering guarantees for the
   offline-first sync replica depend on a single monotonic sequence per feed.
2. **Collaborative mail drafts** need realtime co-editing, but the existing
   Hocuspocus runtime only knows `doc_page`/`synced_block` rooms, and mail
   drafts already have a lifecycle (review, send, undo) that plain text
   persistence must not corrupt.
3. **Review-before-send** is a compliance-shaped hard gate, not a UI hint —
   where does enforcement live?
4. **Huddles** (Slack-style audio) require LiveKit, but self-host installs must
   not hard-depend on it.
5. **Round-robin routing** needs presence/DND signals, but presence is
   best-effort and must never silently drop assignments.

## Decision

1. **Broadcast replies allocate BOTH sequences in one transaction.** A thread
   reply with `broadcastToChannel` takes the next `channel_seq` under the same
   channel lock as top-level posts _and_ its own `thread_seq`; the channel feed
   query filters on `channel_seq IS NOT NULL` rather than
   `thread_parent_id IS NULL`. Plain replies keep `channel_seq NULL`. A
   broadcast flag on a top-level post is rejected 422 — it is meaningless.
   Sync ordering per feed stays monotonic because every row in a feed has
   exactly one ordering key for that feed.
2. **`mail_draft:<workspaceId>:<draftId>` is a third collab room kind** sharing
   the doc-room machinery: single-use tickets (`collab_tickets.room_kind =
   'mail_draft'`), room leases with epoch fencing, live reauthorization
   (`verifyLiveMailDraftAccess` — draft must still be `status='draft'` and
   `collab_enabled`). Persistence writes the merged Yjs state AND the extracted
   ProseMirror body/`body_text` back to `mail_drafts` fenced on
   `(lease_node_id, lease_epoch)`, so the review/send pipeline always reads the
   latest co-edited content through the same columns as solo edits.
3. **Review state is enforced in `sendDraft`** — a draft whose `review_status`
   is `requested`/`changes_requested` cannot send; the API returns 409
   `mail_review_required`. Completing review (`approved`) is the only
   transition that unblocks send. Reviewer identity is server-side, never
   client-asserted.
4. **Huddles are optional and inert when unconfigured.** `chat_huddle_sessions`
   rows plus a `huddle_session` message kind exist regardless, but
   start/join/end return 404 when the instance has no LiveKit config, and no
   other chat feature depends on them.
5. **Routing treats absence of presence data as online.** Round-robin reads
   `user_workspace_profiles.dnd_until`/`last_seen_at`; members with no presence
   row or no `last_seen_at` count as online so a fresh workspace never dead-ends
   assignment. `respect_dnd`/`require_online` are discrete columns on
   `mail_inbox_routing_state` (not a config blob), with
   `last_assigned_user_id` as the round-robin cursor.
6. **Keyword alerts fan out inside `sendMessage` in the same transaction**:
   channel members whose `notification_preferences.alert_keywords` substring-match
   (via `position()`, never LIKE interpolation) the body get a
   `chat.keyword_match` notification. Authors never alert themselves;
   `chat_level='none'` suppresses. INSERT…SELECT parameters carry explicit
   `::uuid` casts because Postgres resolves SELECT-list parameters to `text`
   and refuses the implicit assignment cast.
7. **Private inboxes are enforced in three places**: creation persists
   `visibility`/`owner_user_id` (owner defaults to creator), `listInboxes`
   filters non-owners lacking a `mail_inbox` ACL grant (admins/owners bypass
   with audit), and `requireConversation` re-checks per conversation so direct
   links can't bypass list filtering.

## Consequences

- All M11 tenant tables follow the §4.2 invariant (workspace_id, composite FK,
  ENABLE+FORCE RLS, coverage-test entries); migration `0028_m11_comms_parity.sql`
  is expand-phase with a documented rollback path.
- Chat additions (drafts, scheduled messages, saved items+reminders, pins,
  bookmarks, sidebar sections, polls, user groups, workspace emojis, presence
  profiles) are independent tables — no M4 chat invariants changed except the
  broadcast sequencing rule above, which the 500-message burst regression
  continues to pin.
- Mail additions (tags, templates/snippets with server-side merge rendering,
  macros, contacts/organizations, SLA policies, split-inbox settings, bulk
  triage, forward/split) are plain REST state machines; only draft collaboration
  touches the realtime plane.
- Scheduled-message/follow-up/reminder sweeps run inside `withWorkspace` —
  FORCE RLS means a worker querying tenant tables outside a tenant context
  silently sees zero rows (a bug class this milestone hit once and now tests
  against).
- Web/mobile UI surfaces consume the same contracts; nothing in this ADR is
  transport-specific beyond the `/collab` room grammar.
