# 22. Privacy, Compliance & Data Governance

## 22.1 Data classification

| Class            | Examples                                                      | Handling                                                                                                                 |
| :--------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| **Restricted**   | Mail bodies/attachments, OAuth tokens, API keys, auth secrets | Encrypted at rest (tokens via envelope encryption), never logged, never sent to AI without policy consent, access-logged |
| **Confidential** | Docs, issues, chat, file contents                             | Tenant-isolated (RLS), encrypted at rest, egress-controlled                                                              |
| **Internal**     | Workspace metadata, usage metrics                             | Aggregated/anonymized where possible                                                                                     |
| **Public**       | Marketing site, docs site                                     | No tenant linkage                                                                                                        |

## 22.2 GDPR / privacy-by-design commitments

- **Lawful basis & DPA:** we act as **processor** for workspace content and **controller** for account/billing data. A DPA with subprocessor list is published and versioned.
- **Data subject rights:**
  - **Export (Art. 20):** workspace owner export → JSON + original files + EML; asynchronous job with signed download; email verification for the requester.
  - **Erasure (Art. 17):** user deletion removes PII, anonymizes authorship ("Deleted user"), cascades sessions/tokens, purges derived indexes and AI caches; backups expire per the documented window.
  - **Rectification/access:** profile self-service + support path with identity verification.
- **Retention:** configurable per workspace (default: mail 24 months, chat 36 months, audit 24 months, backups 30 days). Retention jobs are idempotent and report counts.
- **Data minimization:** no analytics PII; IP addresses hashed with a rotating salt; session replay disabled by default and never on mail/doc content.
- **International transfers:** documented regions; self-hosters choose their own.
- **Sub-processors:** AI providers, email relay, object storage, observability — each listed with purpose and region.

## 22.3 AI-specific privacy rules

1. **No training on customer content** by us, contractually and technically (no fine-tuning pipelines on tenant data).
2. **Provider terms:** zero-retention/enterprise endpoints only; the gateway records the provider and retention mode per run.
3. **Workspace controls:** AI on/off per workspace, model allowlist, BYO key, prompt/response retention toggle (default: **do not store** content, only hashes + metadata).
4. **Erasure propagation:** deleting a doc removes its chunks and embeddings; the semantic cache key includes a content hash so stale entries can't resurface deleted text.
5. **Right to explanation for agents:** every agent action links to the run record (who, what tool, what arguments) in the audit log.

## 22.4 Security & compliance controls checklist (Huriro Cloud; SOC 2 readiness — self-hosters inherit the product controls, the operational ones are theirs)

| Control area        | Implementation                                                                                             |
| :------------------ | :--------------------------------------------------------------------------------------------------------- |
| Access control      | SSO for staff, least privilege, quarterly access reviews, no shared accounts, break-glass with audit       |
| Change management   | PR review required, CI gates, production deploy approvals, migration review, audit trail                   |
| Encryption          | TLS 1.2+ in transit, AES-256 at rest, envelope encryption for third-party tokens, managed KMS              |
| Monitoring          | Centralized logs (append-only), alerting, intrusion detection at the edge, anomaly alerts on admin actions |
| Backups             | Encrypted, tested restores, documented RPO/RTO, off-site copies                                            |
| Vendor management   | Subprocessor inventory, annual review, DPAs, security questionnaires                                       |
| Incident response   | Documented plan, severity ladder, 72-hour breach notification path, postmortems                            |
| Business continuity | Runbooks for DB loss, provider outage, key compromise, region failure                                      |
| Device & endpoint   | Disk encryption, MDM where feasible, no production data on laptops                                         |
| Data deletion       | Documented erasure pipeline incl. backups, verified by a recurring test                                    |

## 22.5 Logging and data-subject safety

- **Never log:** passwords, tokens, mail bodies, doc content, attachment contents, full prompts.
- **Log with care:** user ids (ok), emails (hash or redact), IP (hash), search queries (opt-in, per workspace, for improving search only).
- **Log retention:** 30 days hot, 12 months cold (audit log separate, 24 months).

## 22.6 Why not end-to-end encryption (yet)

E2EE is incompatible with server-side full-text search, collaborative editing (server needs the CRDT state to be authoritative on reconnects for offline peers), semantic search, and reliable mobile sync without a device always online. The design keeps a **seam**: `doc_state.state` is already opaque bytes, and attachments are stored as opaque objects, so a future "confidential docs" tier (per-document keys, server-blind) can be added for a subset of content. Recorded as an explicit non-goal with a dated revisit trigger (first enterprise request or a regulated vertical).
