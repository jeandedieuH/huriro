# ADR-0023: Shared inbox — canonical store, token-authed ingest, quarantined raw MIME, undo-send sweep

- **Status:** Accepted (M5)
- **Date:** 2026-11-25
- **Plan refs:** §14.1–§14.7 (shared inbox), §12.4 (tenant context), §23 M5

## Context

M5 adds a shared customer-inbox on top of the existing tenancy, outbox, and
files-quarantine substrate. Four decisions needed recording:

1. **Canonical store vs passthrough.** Provider mail (Gmail/Graph/IMAP) must
   be usable even when the provider is down, must support internal notes,
   assignment, retention, and export — none of which a passthrough proxy can
   offer.
2. **How inbound mail reaches a tenant.** A webhook POST arrives with no
   session and no `app.workspace_id`; FORCE RLS refuses everything until a
   tenant context exists.
3. **What happens to malformed or hostile MIME.** Dropping it silently makes
   support mail unrecoverable; storing it unsanitized is a stored-XSS vector.
4. **How undo-send can work at all.** A queued send that is claimed
   immediately can never be cancelled; a client-side delay is not
   enforceable.

## Decision

**Huriro is the canonical mail store.** Providers are sync sources, not the
system of record: `mail_messages`/`mail_conversations` hold the derived,
sanitized projection; the immutable raw RFC 822 bytes live in quarantined
blob storage (`mail-raw/...`) and are only read for export and re-parse.
Dedupe is `(workspace_id, account_id, rfc_message_id)` — provider message ids
are cache-only `provider_ref` metadata (§14.3).

**Inbound routing is pre-tenant via SECURITY DEFINER.** `POST
/api/v1/mail/inbound/:token` carries an opaque per-account token (`mi_…`,
stored SHA-256-hashed in `mail_accounts.config`). `resolve_mail_inbound_route`
maps token → workspace+account before any tenant context exists, then the
write runs inside `withWorkspace` — the same pattern GitHub webhooks use.
These routes are exempt from cookie CSRF because they never carry a session.

**Fail closed, but never lose mail.** `parseMime` enforces hard limits
(50 MiB total, 200 parts, 100 recipients, 25 attachments, 2 MiB inline HTML)
and rejects header-less input outright (postal-mime is lenient and will
"parse" arbitrary bytes). On `MimeParseError` the service still creates a
visible `[unparseable message]` conversation with the raw blob attached —
operators triage quarantine instead of losing customer mail. Sanitized HTML
is produced at ingest time (`sanitizeMailHtml` → editor allowlist → remote
images stripped → external links rewritten with `data-orig-href`), so read
paths never re-process attacker input.

**Drafts double as the outbound queue.** `sendDraft` flips status to
`sending` with `scheduled_send_at = now + undoSeconds`; undo inside the
window flips it back. No outbox event is emitted at send time — a worker
sweeper (`mail-outbound-due`, 15 s) scans `list_mail_drafts_due_for_send()`
so the undo window is real, not advisory. A `transportOverride` seam on
`MailWorkerDeps` lets tests and self-hosters inject a fake relay without
touching provider code.

**Threading is conservative.** In-Reply-To/References hits win; otherwise
same-account normalized-subject match (Re:/Fwd:/[tag] stripped). Ambiguity
always creates a new conversation — a wrongly merged thread leaks customer
data, a split thread is merely annoying.

## Consequences

- Provider outage ⇒ support mail still readable, assignable, exportable;
  sync resumes from `sync_state` (uidNext / historyId / deltaLink).
- A forged token yields only the ability to inject mail into one workspace's
  support inbox — no reads, no cross-tenant reach; rotation is an account
  update. Token in `config` lets self-hosters re-copy the inbound URL.
- Undo-send adds ≤15 s delivery latency (sweep cadence) — acceptable for
  team replies, and the window is enforced server-side.
- Raw MIME retention is bounded by the per-inbox `retentionDays` sweep —
  `runRetentionSweep` deletes derived rows AND raw blobs together.

## Alternatives rejected

- **Passthrough to provider APIs:** no internal notes, no assignment, no
  retention, no offline reads — and every page load re-trusts provider HTML.
- **Session-authed ingest or an unauthenticated path:** the first can't be
  reached by an MTA; the second is an open spam/injection hole.
- **Dropping unparseable MIME:** support mail is irreplaceable; a visible
  quarantine row preserves the raw bytes for forensics.
- **Eager outbox event for sends:** consumed before `scheduled_send_at`, the
  event would be marked processed and the message would never send (or the
  undo window would be illusory) — the sweeper makes the delay authoritative.
