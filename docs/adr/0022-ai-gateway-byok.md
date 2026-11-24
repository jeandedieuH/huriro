# ADR-0022: AI gateway — BYO providers, encrypted keys, local-model egress

- **Status:** Accepted (M3)
- **Date:** 2026-11-24
- **Plan refs:** §11.3 (AI gateway + policy), §11.4 (semantic search v1),
  §20 (SSRF egress)

## Context

M3 adds the first model-driven surface: thread/doc summaries and semantic
search v1. The plan requires AI to be off by default per workspace, BYO key
or local Ollama providers, redaction before external egress, metering on
every call, and no service-account bypass of workspace permissions.

Two decisions needed recording:

1. **Where provider secrets live.** A provider key is a bearer for a
   third-party service; it must not appear in list responses, logs, or
   backups-adjacent exports.
2. **Whether local Ollama can use private IPs.** §20 blocks private
   resolution targets for all egress to kill SSRF — but a self-host Ollama
   legitimately runs on `localhost`/RFC-1918.

## Decision

**Provider API keys** are envelope-encrypted at write time with the server
root secret (`api/crypto.ts`), AAD-bound to `ai-provider:<name>` so rewrites
of the row (URL/model changes) reuse the same AAD and stay decryptable. The
key is write-only: `PUT /ai/providers` accepts `apiKey`, `GET` returns only
`hasApiKey: true`.

**Private-IP egress is a provider-kind property, not a caller option.**
`safeEgress` gained `allowPrivate?: boolean`; the gateway sets it only when
`provider.kind === 'ollama'` — an admin-configured, intentionally-local
endpoint. `openai_compatible` providers and all other egress callers
(unfurl, webhooks, CIMD) remain under strict SSRF rules. There is no API
input that can promote a URL to private access.

**Model governance lives in `policy.ts`, not in call sites:** every AI
route loads the workspace flags (`ai_enabled` off by default,
`ai_allowed_models`, `ai_max_tokens`, `ai_monthly_token_cap`,
`ai_trace_prompts` opt-in) and the permission (`ai.manage` to configure,
`ai.use` to run) in one place.

**Prompt/response privacy defaults to hashes.** `ai_runs` stores
`prompt_hash`/`response_hash` always; `prompt_trace`/`response_trace` only
when `ai_trace_prompts` is on. The exact-response cache (`ai_cache`,
model+params+prompt_hash key) returns hits without calling the provider and
is invalidated on policy version changes via the provider id in the key.

**Semantic search v1 rides the existing search ACL.** Chunks
(`chunk_embeddings`, pgvector per-model dimensions) are written by the
outbox consumer only when `content_hash` changes; `/ai/search` vector-ranks
then applies the identical `entity_acl()` filter the keyword path uses —
no separate permission model, no post-filter leak.

## Consequences

- Compromising `ai_providers.api_key_enc` without the root secret yields
  nothing; rotating a key is a normal `PUT` re-encrypt.
- An attacker-controlled `baseUrl` can only reach public IPs unless the
  workspace admin deliberately sets `kind='ollama'`.
- Ollama trust is admin-configured: a workspace admin choosing a local
  provider has already decided the boundary; SSRF rules still apply to
  every non-Ollama URL.
- AI provider outage degrades to `502 ai_provider_error` on the AI surface
  only — search falls back to keyword, nothing else depends on the model.

## Alternatives rejected

- Plaintext keys + row-level ACL: leaks via any dump/backup; encryption at
  rest is cheap because the root secret already exists for webhooks/GitHub.
- `allowPrivate` as a per-request flag on `safeEgress`: one forgotten call
  site reopens SSRF; scoping it to provider kind keeps the exception
  auditable in one line of `gateway.ts`.
- A separate semantic ACL: duplicates and eventually drifts from the
  keyword ACL; sharing `entity_acl()` keeps one source of truth.
