# M5 threat-model review (§14, §23.2)

Scope: M5 Shared Inbox — canonical mail storage (`mail_accounts`, `mail_inboxes`, `mail_identities`, `mail_conversations`, `mail_messages`, `mail_conversation_comments`, `mail_drafts`), inbound webhooks (`/api/v1/mail/inbound/:token`), Gmail/Microsoft Graph/IMAP sync, raw RFC 822 blob quarantine, HTML sanitization, and delayed undo-send worker.

## Boundaries & assets

| Boundary | Crosses | Assets |
| --- | --- | --- |
| External mail relay → `/api/v1/mail/inbound/:token` | Opaque per-account ingest token (`mi_...`) + raw MIME payload | Customer email headers/bodies, attachments, SPF/DKIM/DMARC auth results |
| Worker → IMAP / Gmail / MS Graph APIs | AES-256-GCM encrypted OAuth/IMAP credentials + TLS sockets | Historical mailbox threads, delta cursors |
| Browser → Shared Mail UI | Cookie session + `X-Workspace-Id` + `X-Huriro-Client` | Assigned conversations, internal team notes, draft lock leases |
| Worker → Outbound SMTP / Provider API | Draft `sending` rows past `scheduled_send_at` | Outbound replies with verified DKIM domain alignment |

## STRIDE findings & mitigations

| Threat | Surface | Mitigation in place |
| --- | --- | --- |
| Stored XSS / remote tracking pixels in inbound HTML email | `mail_messages.html_body` | Ingest-time sanitization via `sanitizeMailHtml` (strict editor allowlist, event handlers & scripts stripped, remote images blocked, external links rewritten cleanly); raw RFC 822 bytes quarantined in object storage. |
| Parser resource exhaustion / MIME bombs | `parseMime` | Hard bounded limits (50 MiB message cap, 200 MIME parts, 100 recipients, 25 attachments, 2 MiB inline HTML). Headerless or hostile payloads fail closed as quarantined `[unparseable message]` records rather than crashing workers. |
| Tenant enumeration via inbound webhook route | `POST /api/v1/mail/inbound/:token` | Tokens stored SHA-256-hashed (`mail_accounts.config`); `resolve_mail_inbound_route` (`SECURITY DEFINER`) maps valid tokens to `(workspace_id, account_id)` prior to `withWorkspace()`, returning uniform `404` for unknown tokens. |
| Information disclosure — leaking internal teammate notes in customer replies | `mail_conversation_comments`, outbound drafts | Internal notes reside in a dedicated table (`mail_conversation_comments`) separate from `mail_messages` and never serialize into outbound SMTP/Graph/Gmail draft send payloads. |
| Repudiation / premature send bypassing undo delay | `mail_drafts` (`sending` status) | Undo-send window is server-enforced (`scheduled_send_at = now + undoSeconds`); worker sweeper (`list_mail_drafts_due_for_send`) claims due drafts atomically via `FOR UPDATE SKIP LOCKED`. |

## Review outcome

All M5 Gate G5 controls are verified by real PG18 mail integration tests and HTML/MIME sanitizer suites: **pass**.
