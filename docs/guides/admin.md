# Workspace & Instance Administration Guide

## 1. Workspace Onboarding & Access Control

- First boot creates a one-time setup token (`bun run setup-token` rotates an unused setup token before workspace setup completes).
- Promote an existing user to instance administrator:
  ```bash
  bun apps/server/src/index.ts create-admin --email admin@example.com --name "Instance Admin"
  ```
- Role hierarchy (`packages/domain`): `owner`, `admin`, `member`, and `guest`, enforced via PostgreSQL `FORCE ROW LEVEL SECURITY`, resource ACLs, and centralized `can()` checks.

## 2. Read-Only Maintenance Mode

During database maintenance, storage migrations, or disaster recovery rehearsals, set `HURIRO_READ_ONLY=true` to pause all mutating endpoints while keeping reads, exports, and health probes online:
- Reads (`GET`, `HEAD`, `OPTIONS`) continue returning `200 OK`.
- Mutations return HTTP `503` (`code: "read_only_mode"`, `Content-Type: application/problem+json`, `Retry-After: 60`), and the web UI automatically displays the maintenance banner.

## 3. Cloud Billing (`HURIRO_MODE=cloud`)

In `selfhost` mode (`HURIRO_MODE=selfhost`), billing endpoints return `404 billing_disabled` and no billing UI is shown.

In `HURIRO_MODE=cloud`, workspace owners (`workspace.billing`) manage a flat **$10.00 USD / workspace / month** plan on the **Huriro web app** using two payment rails:
- **International Cards (Polar)**: Card & digital-wallet checkouts in USD (`POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`, `POLAR_WEBHOOK_SECRET`), plus self-service customer portal access.
- **Rwanda Local Payments (IremboPay)**: Converted dynamically to RWF using `UsdToRwfConverter` (`BILLING_FX_API_URL` live rate, 6h cache, or `BILLING_USD_TO_RWF_FALLBACK`), supporting direct MTN Mobile Money (`078`/`079`), Airtel Money (`072`/`073`) USSD push prompts, or hosted web invoices (`IREMBOPAY_SECRET_KEY`, `IREMBOPAY_WEBHOOK_SECRET`).

### Web-Only Billing Boundary
Requests originating from mobile clients (`x-huriro-client: huriro-mobile*` or `x-huriro-platform: ios|android`) are rejected by the API with `403 web_only_billing`. The mobile app displays current plan/usage read-only and directs owners to the web settings billing tab.

## 4. Data Governance (GDPR Export & Erasure)

- **Workspace Export** (`POST /api/v1/governance/exports`): Owner-only asynchronous snapshot downloadable as JSON with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.
- **Self-Service Identity Erasure** (`POST /api/v1/governance/erase-me`): Requires exact email confirmation (`confirmEmail`). Executes `erase_user_identity(user_id)` inside a transaction to anonymize `public.users`, suspend workspace memberships, revoke OAuth/passkey/session rows, revoke push tokens, and broadcast realtime disconnect signals.
