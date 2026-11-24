# ADR-0024: Native Mobile Client Stack & Web-Only Cloud Billing Boundary

- **Status:** Accepted (M6)
- **Date:** 2026-11-24
- **Plan refs:** §18 (Mobile & Shared Client Core), §2.5 / §23 M6 (Cloud Billing), ADR-0016, ADR-0018

## Context

Delivering M6 requires two clear architectural boundaries:

1. **Mobile client stack & shared code ratio.** Reimplementing Huriro's sync protocol, permission catalog, contracts, i18n, and rich-text schemas in Swift/Kotlin or ad-hoc React Native code would diverge from the web platform and violate the `>= 60%` shared-code gate. Meanwhile, mobile UI components needed an accessible, composable design system matching our Tailwind design tokens.
2. **Global + Rwanda-compatible cloud billing.** Stripe is not available for Rwandan entities or local Mobile Money rails, and handling checkout directly inside native iOS/Android binaries triggers avoidable app-store billing surface area and review friction.

## Decision

1. **Expo + Expo Router + Uniwind + `heroui-native` over `@huriro/*` shared core.**
   - `apps/mobile` runs on Expo SDK 58 (React Native) with Expo Router typed navigation, `uniwind` Tailwind utilities fed by `@huriro/design-tokens`, `heroui-native` UI primitives, and `lucide-react-native` icons.
   - Offline persistence reuses `@huriro/sync-client`'s `HuriroSyncEngine` backed by a SQLite adapter (`expo-sqlite` wrapper implementing `ReplicaStorage`), keeping shared TypeScript business logic in `packages/*` above `80%`.
   - Document editing uses a lightweight Expo DOM/webview component bridged cleanly to `@huriro/editor`.

2. **Web-only Cloud billing via Polar (USD) & IremboPay (Rwanda RWF / Mobile Money), flat $10 USD / workspace / month.**
   - Stripe is removed completely. When `HURIRO_MODE=cloud`, workspace owners (`workspace.billing`) choose between:
     - **Polar** (`USD`): International card and digital wallet checkouts at flat `$10.00 USD / workspace / month`, with Standard Webhooks verification (`webhook-id`, `webhook-timestamp`, `webhook-signature`) and customer portal management.
     - **IremboPay** (`RWF`): Rwanda local invoices and direct USSD push prompts for **MTN Mobile Money (`078`/`079`)** and **Airtel Money (`072`/`073`)**, converted from `$10 USD` using `UsdToRwfConverter` (live FX API → 6-hour cache → `BILLING_USD_TO_RWF_FALLBACK`), verified via `irembopay-signature` HMAC.
   - `POST /api/v1/billing/checkout` and `POST /api/v1/billing/portal` strictly reject mobile client headers (`x-huriro-client: huriro-mobile*`, `expo`, `x-huriro-platform: ios|android`) with `403 web_only_billing`. Mobile surfaces subscription plan/usage read-only and instructs owners to complete upgrades on the web app.
   - `HURIRO_MODE=selfhost` disables all billing endpoints (`404 billing_disabled`).

## Consequences

- Shared client packages (`contracts`, `domain`, `editor`, `i18n`, `design-tokens`, `sync-client`, `env`) stay single-source across web and mobile (`>= 60%` enforced in CI via `bun run check:shared-code`).
- Zero Stripe SDK or secret footprint remains anywhere in server, web, mobile, or Compose configs.
- App Store / Play Store builds contain zero third-party in-app payment links or SDKs while supporting both global card users and Rwandan Mobile Money customers seamlessly on the web.
