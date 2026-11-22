# 16. API Design & Contracts

## 16.1 Conventions

| Concern            | Decision                                                                                          |
| :----------------- | :------------------------------------------------------------------------------------------------ |
| Base path          | `/api/v1` (proxied on the app origin)                                                             |
| Style              | REST for resources; **batch endpoints** for multi-entity reads; no GraphQL in v1                  |
| IDs                | uuidv7 strings in URLs; never expose sequential integers                                          |
| Auth headers       | Cookie (web) or `Authorization: Bearer` (native/keys); `X-Workspace-Id` for multi-workspace users |
| Content type       | `application/json`; `application/problem+json` for errors                                         |
| Versioning         | URL major version (`/v1`), additive-only changes within it, deprecation headers (§16.7)           |
| Idempotency        | `Idempotency-Key` on all non-idempotent writes (draft-ietf-httpapi standard semantics)            |
| Concurrency        | `If-Match`/`ETag` on mutable resources; `409` on version mismatch                                 |
| Pagination         | Cursor-based: `?limit=&cursor=`, response `{ data, nextCursor, hasMore }`                         |
| Filtering          | Explicit, typed query params; no arbitrary query language on public endpoints                     |
| Sorting            | Allowlisted fields only, always with a deterministic tiebreaker (`id`)                            |
| Partial responses  | `?fields=` allowlist on heavy list endpoints (never `SELECT *` semantics)                         |
| Rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`                                       |

## 16.2 Error contract

```json
{
	"type": "https://docs.huriro.app/errors/stale-version",
	"title": "The resource changed since you loaded it",
	"status": 409,
	"code": "stale_version",
	"detail": "Issue ENG-142 was updated by another user.",
	"instance": "/api/v1/issues/019a…",
	"requestId": "req_01J…",
	"currentVersion": 8,
	"yourVersion": 7
}
```

- RFC 9457 Problem Details shape, extended with a stable machine-readable `code` and `requestId`.
- **Never leak internals:** no stack traces, SQL, or provider messages in production responses (logged with `requestId` instead).
- Every error code is enumerated in `packages/contracts/errors.ts` with a doc URL, so clients can localize.

## 16.3 Batch and sync endpoints

| Endpoint                               | Purpose                                                                          |
| :------------------------------------- | :------------------------------------------------------------------------------- |
| `GET /api/v1/sync/changes?since=`      | Incremental changes (§9.3)                                                       |
| `GET /api/v1/sync/snapshot?resources=` | Full resync after `410 Gone`                                                     |
| `POST /api/v1/batch`                   | Up to 20 reads in one round trip (fixed cost; used on cold start)                |
| `POST /api/v1/mutations`               | Optionally batch several mutations atomically across entities the user can write |

## 16.4 Typed clients

- **Eden Treaty** for first-party TypeScript clients (web, mobile) — zero codegen, compile-time safety.
- **Generated OpenAPI 3.1** from the same TypeBox schemas, used for: external SDKs, MCP tool schemas, and a **contract test** that diffs the generated spec against a snapshot (breaking change = CI failure unless explicitly approved).
- Hand-written SDKs are forbidden.

## 16.5 Webhooks (outbound, for integrators)

- Subscribed per workspace, signed with HMAC-SHA256 (`X-Huriro-Signature` + timestamp to prevent replay), retried with exponential backoff for 24 h, with a delivery log and manual replay.
- Payloads are the same event DTOs used internally, versioned.

## 16.6 GitHub integration

- GitHub App (not OAuth app) with least-privilege permissions: `issues:write`, `pull_requests:read`, `contents:read` (for link previews only).
- Webhook receiver verifies `X-Hub-Signature-256`, stores raw payload, enqueues, returns `202` immediately.
- Two-way sync uses a **link table** (`issue_github_links`) with remote ids and a `last_synced_at`/`source_of_truth` field to prevent echo loops.
- Outbound updates to GitHub are queued and rate-limit aware; a failed push surfaces as an inline warning on the issue, never silently dropped.

## 16.7 Versioning and deprecation

1. Additive changes (new fields, new endpoints) ship freely.
2. Breaking changes require a **new URL version** or an explicit opt-in header, a 90-day overlap, `Sunset`/`Deprecation` headers, and telemetry showing remaining usage.
3. Removed endpoints return `410` with a link to the migration guide for 30 days beyond sunset.
