# 14. Mail (Shared Inbox)

## 14.1 The decision that shapes everything

The original sketch made **Stalwart the system of record**. Two facts make that untenable as the default:

1. **Stalwart 1.0 is two weeks old** (1.0.0 released 2026-10-26, 1.1.0 on 2026-11-09) and, critically, **multi-tenancy is an Enterprise-license feature**. Running one shared mail server for all workspaces would mean either paying an enterprise license on every self-hosted install or weakening tenant isolation to application code.
2. **Deliverability is the hardest part of email**, and it is not our differentiator: cold IPs, port 25 blocks at most providers, DMARC alignment, complaint-rate thresholds, and Google's bulk-sender rules.

**Therefore: Huriro owns the canonical message store; mail providers are adapters.**

```text
                  ┌──────────────── MailProvider interface ────────────────┐
                  │ inbound-route · gmail · graph · imap · jmap (Stalwart) │
                  └───────────────▲───────────────────────┬────────────────┘
    webhook / poll / Pub/Sub      │                       │ send (or hand to provider)
                                  │                       ▼
  ┌──────────────┐   raw MIME  ┌──┴───────────────┐  ┌──────────────────┐
  │ S3: raw/     │◀────────────│  mail sync       │─▶│ outbound queue   │
  │ (immutable)  │             │  worker          │  │ (DKIM, retries)  │
  └──────────────┘             └──┬───────────────┘  └──────────────────┘
                                  │ parse (sandboxed, limits)
                                  ▼
                       Postgres: conversations · messages · drafts
                                  │
                                  ▼
                         search index + embeddings
```

## 14.2 Phased provider strategy (ADR-0011)

| Phase                               | What ships                                                                                                                                           | Why                                                                                                  |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **1**                               | **Forwarding address + inbound-parse webhook**; outbound via managed relay (SES/Postmark/Resend) with a per-customer domain verification + DKIM flow | Fastest time-to-value, no IP reputation work, no port 25 dependency                                  |
| **2**                               | **Connected mailboxes**: Gmail API (Pub/Sub push), Microsoft Graph (change notifications + lifecycle), generic IMAP (`imapflow` + IDLE/poll)         | Replies go out through the customer's own provider → best deliverability, no sending reputation risk |
| **3** (optional, self-host profile) | **Stalwart adapter** over JMAP, pinned to a supported minor version, enterprise-only features avoided                                                | Self-hosters who want a fully contained mailbox; never the default, never the system of record       |

Notable constraints to plan around: Gmail restricted scopes require OAuth verification and (for stored data) a security assessment; Graph subscriptions must be renewed and need lifecycle notifications to recover from missed events; Exchange Online is OAuth-only. Each is a checklist item in §23's mail phase, not a surprise.

**Self-host note:** on self-host, "managed relay" means whatever SMTP the operator configures (SES, Postmark, their own server) — phase 1 needs no vendor approval at all. Generic IMAP also ships in phase 2 regardless of Google/Microsoft verification status, so self-hosted instances get connected mailboxes even while cloud OAuth verification is pending.

## 14.3 Schema (replacing the invalid original)

```sql
CREATE TABLE mail_accounts (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider      text NOT NULL,             -- inbound_parse | gmail | graph | imap | jmap
    address       citext NOT NULL,
    display_name  text,
    secret_ref    text,                      -- pointer to encrypted credential row
    config        jsonb NOT NULL DEFAULT '{}'::jsonb,
    sync_state    jsonb NOT NULL DEFAULT '{}'::jsonb,
    status        text NOT NULL DEFAULT 'active',   -- active | error | disconnected
    last_synced_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, address)
);

CREATE TABLE mail_inboxes (                        -- shared inbox grouping (e.g. "Support", "Sales")
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    position      text NOT NULL,
    settings      jsonb NOT NULL DEFAULT '{}'::jsonb   -- routing, SLA, default assignee
);

CREATE TABLE mail_conversations (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    inbox_id       uuid NOT NULL REFERENCES mail_inboxes(id) ON DELETE CASCADE,
    subject        text NOT NULL,
    status         text NOT NULL DEFAULT 'open',   -- open | pending | snoozed | closed | spam
    assignee_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    snoozed_until  timestamptz,
    merged_into_id uuid REFERENCES mail_conversations(id) ON DELETE SET NULL,
    last_message_at timestamptz NOT NULL,
    first_reply_at timestamptz,                    -- for response-time metrics
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    version        int NOT NULL DEFAULT 1
);
CREATE INDEX idx_conv_inbox ON mail_conversations (workspace_id, inbox_id, status, last_message_at DESC);

CREATE TABLE mail_messages (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    direction      text NOT NULL,                  -- inbound | outbound
    rfc_message_id text,                           -- from the MIME headers
    in_reply_to    text,
    references_ids text[] NOT NULL DEFAULT '{}',   -- RFC 5322 References header ("references" is a reserved word in SQL)
    from_addr      jsonb NOT NULL,                 -- {name,email}
    to_addrs       jsonb NOT NULL DEFAULT '[]'::jsonb,
    cc_addrs       jsonb NOT NULL DEFAULT '[]'::jsonb,
    subject        text,
    sent_at        timestamptz,
    received_at    timestamptz NOT NULL DEFAULT now(),
    raw_blob_key   text NOT NULL,                  -- S3 key of immutable raw MIME
    body_html      text,                           -- sanitized for display
    body_text      text,
    auth_results   jsonb,                          -- SPF/DKIM/DMARC verdicts
    provider_ref   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- cache only; never a key
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_msg_dedupe
    ON mail_messages (workspace_id, account_id, rfc_message_id)
    WHERE rfc_message_id IS NOT NULL;

CREATE TABLE mail_conversation_events (              -- the timeline: assignment, status, merges, links
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    kind            text NOT NULL,               -- assigned | status_changed | merged | linked | snoozed
    actor_id        uuid REFERENCES users(id),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_conversation_comments (             -- internal notes (never sent)
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    author_id       uuid NOT NULL REFERENCES users(id),
    body            jsonb NOT NULL,              -- rich text
    mentions        uuid[] NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_drafts (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id   uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    identity_id       uuid NOT NULL,             -- from-address + signature
    created_by        uuid NOT NULL REFERENCES users(id),
    last_edited_by    uuid REFERENCES users(id),
    body              jsonb NOT NULL,            -- collaborative body (Yjs state ref)
    recipients        jsonb NOT NULL,
    in_reply_to_id    uuid REFERENCES mail_messages(id),
    scheduled_send_at timestamptz,
    status            text NOT NULL DEFAULT 'draft', -- draft | sending | sent | discarded
    sent_message_id   uuid REFERENCES mail_messages(id),
    locked_by         uuid REFERENCES users(id), -- soft lock for "X is editing"
    locked_until      timestamptz,
    version           int NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Links are real relations, not nullable columns in a primary key.
CREATE TABLE mail_conversation_tasks (
    workspace_id    uuid NOT NULL,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    task_id         uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, task_id)
);

CREATE TABLE mail_conversation_docs (
    workspace_id    uuid NOT NULL,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    page_id         uuid NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, page_id)
);
```

**Why `provider_ref` is only a cache:** JMAP `threadId`s are immutable but _mergeable only by re-inserting messages with new ids_; Gmail and Graph ids differ per mailbox. Provider identifiers must never be primary keys.

## 14.4 Threading

Threading follows the RFC 8621 §3 heuristic: messages join a conversation when they share a `Message-Id` link across `In-Reply-To`/`References` **and** have an equivalent normalized subject. New messages that match nothing start a conversation. Ambiguity resolves to "new conversation" rather than "attach to the wrong customer".

## 14.5 The conversation timeline (UX contract)

A conversation shows, in one interleaved, reverse-chronological-or-threaded stream:

1. **Customer messages** (sent + received) with sanitized bodies and attachment chips.
2. **Replies** from teammates, with the sending identity and status (queued → sent → delivered/bounced).
3. **Internal notes** (visually distinct, marked "not sent").
4. **Activity events** (assigned to X, status → pending, linked to ENG-142, merged).
5. **Snooze/undo affordances** (undo-send window: default 10 s, configurable).

Collaboration affordances that matter and are cheap once sync exists: **who else is viewing** (presence), **who is typing a reply** (ephemeral), **draft lock** ("Sam is editing a reply"), and **assignee handoff notes**.

## 14.6 Rendering untrusted HTML safely

1. Parse MIME in a **worker with CPU/memory/time limits** (untrusted input).
2. Sanitize server-side with an allowlist; strip `<form>`, `<base>`, `<meta http-equiv>`, `@import`, `javascript:` and `data:` (except safe image types).
3. Render in a **sandboxed iframe with no `allow-scripts`**, on a **separate origin**, with a strict CSP.
4. **Block remote images by default**; when the user opts in, proxy them through a signed image proxy that strips tracking pixels.
5. **Rewrite links** through an interstitial that shows the real destination and flags punycode/IDN lookalikes.
6. Surface **authentication results**: SPF, DKIM, DMARC verdicts ("this sender failed DMARC") in the message header.
7. Attachments: quarantine → ClamAV → promote; `Content-Disposition: attachment`; separate origin.

## 14.7 Compliance and retention

Mail is the highest-risk data class in the product. Requirements: configurable retention per workspace, legal hold (Phase 5), export (EML + JSON), deletion propagation across raw blobs, derived rows, search index, and AI caches, and a documented backup-retention window (deleted data may persist in backups for N days — stated in the DPA).
