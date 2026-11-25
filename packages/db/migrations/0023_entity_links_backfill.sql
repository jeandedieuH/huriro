-- Migration 0023 — M7 unified entity_links V1 backfill (§7.1, ADR-0033)
--
-- Expand-phase only and idempotent: the INSERT ... SELECT statements may be
-- re-run safely because the edge uniqueness constraint is the conflict target.
--
-- Rollback note: remove exactly the edge sets derived from the legacy tables —
--
--   DELETE FROM entity_links e
--   USING mail_conversation_tasks l
--   WHERE e.workspace_id = l.workspace_id
--     AND e.source_type = 'mail_conversation' AND e.source_id = l.conversation_id
--     AND e.target_type = 'issue' AND e.target_id = l.task_id
--     AND e.relation_kind = 'tracked_by';
--
--   DELETE FROM entity_links e
--   USING mail_conversation_docs l
--   WHERE e.workspace_id = l.workspace_id
--     AND e.source_type = 'mail_conversation' AND e.source_id = l.conversation_id
--     AND e.target_type = 'doc_page' AND e.target_id = l.page_id
--     AND e.relation_kind = 'references';
--
-- This deliberately preserves any newer edge that no longer has a legacy-row
-- counterpart (for example after a V1 unlink during the dual-write window).

-- ---------- 1. mail_conversation_tasks → tracked_by edges ----------
INSERT INTO entity_links (
	workspace_id,
	source_type,
	source_id,
	target_type,
	target_id,
	relation_kind,
	created_by,
	created_at
)
SELECT
	l.workspace_id,
	'mail_conversation',
	l.conversation_id,
	'issue',
	l.task_id,
	'tracked_by',
	l.created_by,
	l.created_at
FROM mail_conversation_tasks l
ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind)
DO NOTHING;

-- ---------- 2. mail_conversation_docs → references edges ----------
INSERT INTO entity_links (
	workspace_id,
	source_type,
	source_id,
	target_type,
	target_id,
	relation_kind,
	created_by,
	created_at
)
SELECT
	l.workspace_id,
	'mail_conversation',
	l.conversation_id,
	'doc_page',
	l.page_id,
	'references',
	l.created_by,
	l.created_at
FROM mail_conversation_docs l
ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind)
DO NOTHING;
