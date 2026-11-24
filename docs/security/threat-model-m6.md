# M6 threat-model review (§18–§22, §23.2, ADR-0024)

Scope: M6 Production Hardening, Mobile Client (`@huriro/mobile`), Cloud Billing (`POLAR` USD + `IREMBOPAY` Rwanda RWF/MoMo), GDPR Export/Erasure (`governance`), API rate limiting, read-only maintenance mode, and multi-replica Valkey pub/sub failover.

## Boundaries & assets

| Boundary | Crosses | Assets |
| --- | --- | --- |
| Mobile App (iOS/Android) → `/api/v1/*` | Bearer/cookie session + `x-huriro-client: huriro-mobile` + `x-huriro-platform` | Local SQLite replica sync delta, Expo push tokens (`mobile_push_tokens`) |
| Worker → Expo Push Service | `safeEgressFetch` + Bearer access token | Lightweight notification hints (pointer IDs + truncated titles; no sensitive payloads) |
| Web App → `/api/v1/billing/*` | Owner session + `x-huriro-client: huriro-web` + `Idempotency-Key` | Polar card checkouts ($10 USD/workspace), IremboPay invoices & MTN/Airtel MoMo prompts (RWF), subscription tier |
| Polar / IremboPay → `/api/v1/billing/webhooks/*` | Unparsed raw JSON body + HMAC headers (`webhook-signature` / `irembopay-signature`) | Verified subscription activation/revocation state, `billing_webhook_events` |
| Owner / User → `/api/v1/governance/*` | Owner RBAC or self-service email-confirmed session | Full JSON workspace export (`workspace_exports`) and identity erasure (`erase_user_identity`) |

## STRIDE findings & mitigations

| Threat | Surface | Mitigation in place |
| --- | --- | --- |
| Store policy violation / client spoofing — mobile in-app billing bypass | `POST /api/v1/billing/{checkout,portal}` | `assertWebOnlyBillingClient` rejects requests carrying `x-huriro-client: huriro-mobile*`, `expo`, or `x-huriro-platform: ios|android` with `403 web_only_billing`; mobile settings show read-only subscription status only. |
| Forged payment activation webhooks | `/api/v1/billing/webhooks/{polar,irembopay}` | Raw-body constant-time HMAC-SHA256 verification before JSON branching: Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature` 300s skew check) for Polar, and timestamped HMAC (`irembopay-signature`) for IremboPay; `provider_event_id` deduplication prevents replays. |
| Billing privilege escalation / cross-tenant tampering | `billing_subscriptions`, `billing_usage_snapshots` | Strict owner-only `workspace.billing` policy check plus PostgreSQL `FORCE RLS`; `selfhost` instances fail closed with `404 billing_disabled`. |
| Unauthenticated / accidental GDPR account erasure | `POST /api/v1/governance/erase-me` | Requires active authenticated session AND exact `confirmEmail` match; `erase_user_identity` verifies `app.user_id = p_user_id` before anonymizing PII, suspending memberships, clearing auth sessions/OAuth/passkeys/push tokens, and revoking realtime sockets. |
| Malicious export script execution in browser | `GET /api/v1/governance/exports/:id/download` | Served strictly as `application/json` with `Content-Disposition: attachment`, `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`. |
| Brute-force / API flood / SPOF pubsub crash | `/api/v1/*`, `realtime` Valkey | Bounded sliding/fixed-window `ApiRateLimiter` emits `429 rate_limited` + `Retry-After`; `ResilientPubSub` fails over cleanly to `InProcessPubSub`/`PostgresNotifyPubSub` on Valkey socket loss; `/readyz` redacts connection strings on failure. |

## Review outcome

All M6 Gate G6 security controls pass real PG18 integration, pentest-hardening, chaos-smoke, and bundle gates: **pass**.
