# M4 threat-model review (§23.2, §12.1, §17.13b)

Scope: M4 surfaces — Team Chat (`chat_channels`, `chat_channel_members`, `chat_channel_acls`, `chat_messages`, `chat_reactions`, `chat_link_previews`, `chat_read_state`, `chat_thread_read_state`, `chat_thread_subscriptions`), partitioned per-channel monotonic sync, ephemeral WebSocket presence & typing, two-phase attachment quarantine (`files` + ClamAV/header scan + EXIF/metadata strip + `CSP: sandbox`), SSRF-safe outbound egress (`api/egress.ts`) for OpenGraph unfurling & outbound webhooks, Slack/Jira importers, notification preferences + quiet-hours email digests + RFC 8292 VAPID Web Push (`push_subscriptions`), and GitHub App two-way issue sync (`github_installations`, `issue_github_links`, `github_webhook_events`).

## Boundaries & assets

| Boundary | Crosses | Assets |
| --- | --- | --- |
| Browser / client → `/api/v1/chat*` | Session Cookie / Bearer + `Origin` + `X-Huriro-Client` | Public/private channels, DM messages, thread replies, reactions, read cursors |
| Browser / client → `/api/v1/files*` | Pre-signed / authenticated binary upload & download | User attachments in `quarantine` / `clean` / `infected` states, stripped image bytes |
| API / Worker → External URLs | `safeEgressFetch()` (DNS pre-resolution + IP pinning + no auto-redirect) | OpenGraph metadata previews (`chat_link_previews`) and webhook POST payloads |
| GitHub → `/api/v1/integrations/github/webhook` | Raw request body + `X-Hub-Signature-256` HMAC-SHA256 | Installation lifecycle events, GitHub issue/comment webhooks (`github_webhook_events`) |
| Worker → Browser Push Service | ES256 VAPID JWT + RFC 8291 encrypted/authenticated push requests | `push_subscriptions` endpoints, `notification_delivery_log` |
| API / Worker → Postgres 18 | `huriro_app` inside `withWorkspace()` / `withSystem()` (`FORCE RLS`) | 16 new tenant tables + `github_webhook_events` + `update_chat_thread_stats()` trigger |

## STRIDE findings & mitigations

| Threat | Surface | Mitigation in place |
| --- | --- | --- |
| Info disclosure — admin/owner reading private DMs | `chat_channels (kind = 'dm')`, `chat_messages`, `/search` | Strict participant-only enforcement in both SQL RLS (`EXISTS (SELECT 1 FROM chat_channel_members ...)`) and application policy/service/search: `kind = 'dm'` returns `403` to workspace owners/admins who are not members — **no admin bypass** (`bypassAcl` applies only to private `#channels` and logs an `audit_log` entry). |
| Tampering — chat sequence gaps or cross-contamination with workspace sync | `chat_channels.last_msg_seq`, `last_rev`, `change_log` | Per-channel monotonic counters allocated under fixed lock order (`chat_channels` → parent `chat_messages`); chat traffic never writes rows to `change_log`, and clients pull per-channel deltas via `GET /chat/channels/:id/changes?since=`. |
| SSRF — cloud metadata (`169.254.169.254`) or LAN probing | Link preview unfurl & outbound webhooks | Both URL validation at registration/extraction and every HTTP attempt in `api/egress.ts` resolve DNS first, block loopback/private/link-local/CGNAT/ULA IPv4+IPv6 ranges, disable automatic redirects (re-validating each `Location` hop), enforce timeout + size caps (`MAX_PREVIEW_BYTES` / `MAX_WEBHOOK_RESPONSE_BYTES`), and persist `'blocked'` status for SSRF-rejected link previews. |
| Malware / SVG/XSS / EXIF GPS leak in file uploads | `POST /files`, `POST /files/:id/finalize`, `GET /files/:id/download` | Two-phase upload into quarantine; magic-byte + SVG script check + ClamAV INSTREAM scan; EXIF/metadata stripping re-encode for raster images (`png`/`jpeg`/`webp`); downloads return `403 file_infected` or `409 file_pending_scan` unless `clean` (or `unscanned` only when scanner disabled), and always serve with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`. |
| Spoofing / Forgery — fake GitHub webhooks | `POST /api/v1/integrations/github/webhook` | Elysia raw-body route computes constant-time HMAC-SHA256 (`X-Hub-Signature-256`) over unparsed request bytes against per-installation encrypted webhook secret or `GITHUB_APP_WEBHOOK_SECRET`, rejecting mismatches with `401 Unauthorized` before queuing; `(delivery_id)` deduplication prevents replay. |
| Info disclosure — leaked webhook / GitHub signing secrets | `/api/v1/webhooks`, `/api/v1/integrations/github/*` | Secrets encrypted at rest via AES-256-GCM envelope key (`HURIRO_SECRET_KEY`, `api/crypto.ts`); plaintext webhook `signingSecret` is returned strictly once on creation or rotation and excluded from list/GET DTOs and pino redacted logs. |
| Infinite echo loops in GitHub two-way sync | GitHub webhooks ↔ `tasks.issue.*` outbox | Inbound sync mutations tag `origin = 'github_sync'` and record `last_sync_hash` (SHA-256 of canonical synced fields); outbound worker skips `github_sync`-originated events and unchanged hashes, isolating failures into `sync_state = 'push_failed'` for manual retry without blocking the outbox. |
| Repudiation / privacy — stale push subscriptions | Web Push worker (`modules/notifications/push.ts`) | Push endpoints responding `404` or `410 Gone` are automatically revoked (`revoked_at = now()`) inside a system/workspace transaction, preventing dead-endpoint retry storms or recycled-token leakage. |
| DoS — flood of notifications or typing DB churn | Chat typing, presence, notifications | Presence and typing live strictly in ephemeral `realtime` process memory (TTL pruned, never persisted); chat notification fan-out collapses repeated replies in the same channel/thread within 5 minutes and skips users whose channel mute flag, quiet hours (`isWithinQuietHours`), or preference level excludes the event. |

## Open risks accepted for M4

1. **In-process / single-broker realtime pubsub for ephemeral typing & presence** — works on single-instance `all` or single `realtime` deployments; multi-replica realtime fan-out will promote presence/typing channels onto Redis/Valkey pubsub in M6 HA hardening.
2. **Optional ClamAV daemon (`CLAMAV_HOST`)** — self-hosters without a ClamAV sidecar still enforce magic-byte/script quarantine and image metadata stripping, marking files `unscanned`; managed/enterprise deployments require `CLAMAV_HOST` enabled.
3. **Outbound webhook fixed IP pinning in custom `fetcher` overrides** — unit/integration tests inject mock fetchers; production `safeEgressFetch` validates resolved IPs prior to fetch and rejects redirects to private ranges.

## Review outcome

All M4 Gate G4 surfaces pass security controls: strict participant-only DMs (`403` without admin bypass), partitioned monotonic chat sync free of `change_log` bloat, two-phase attachment quarantine + AV + EXIF strip + `CSP: sandbox`, SSRF-hardened egress proxy (`422 ssrf_blocked`), raw-body GitHub webhook HMAC verification (`401`/`202`), encrypted one-time secrets (`AES-256-GCM`), echo-loop-safe GitHub sync with visible `push_failed` retry, and auto-revoking VAPID Web Push. M4 security gate: **pass**.
