-- 0029_m11_comms_constraint_expansion.sql — M11 comms parity follow-up
--
-- 0028 was applied before three wire-facing constraint domains were widened.
-- Applied migrations are checksum-pinned, so those expansions land here instead
-- of editing 0028:
--   * ACLs can point at relational doc databases.
--   * Notifications can carry chat keyword-match events.
--   * Mail conversation events can carry the M11 outbound/split/follow-up/
--     macro/bulk-triage/linked-issue audit kinds.
--
-- This is an additive domain expansion: every row valid under 0028 remains
-- valid here, and no data rewrite or backfill is required.
--
-- Rollback note: drop the replacement constraints below and recreate the
-- narrower 0028 definitions (without 'doc_database', 'chat.keyword_match', or
-- the nine additional mail_conversation_events kinds). Only rollback-safe if no
-- rows using the newly admitted values have been written.

ALTER TABLE acl_entries DROP CONSTRAINT ck_acl_entries_resource_type;
ALTER TABLE acl_entries ADD CONSTRAINT ck_acl_entries_resource_type
	CHECK (resource_type IN ('project', 'doc_page', 'teamspace', 'channel', 'mail_account', 'mail_inbox', 'doc_database'));

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind
	CHECK (
		kind IN (
			'issue.assigned',
			'issue.mentioned',
			'issue.commented',
			'issue.status_changed',
			'project.access_granted',
			'doc.mentioned',
			'doc.commented',
			'doc.comment_resolved',
			'doc.access_granted',
			'doc.verification_expiring',
			'doc.suggestion_created',
			'chat.mentioned',
			'chat.dm',
			'chat.reply',
			'chat.message',
			'chat.reminder_due',
			'chat.keyword_match',
			'channel.access_granted',
			'approval.requested',
			'mail.assigned',
			'mail.mentioned',
			'mail.reply_needed',
			'mail.review_requested',
			'mail.review_completed',
			'mail.follow_up_due',
			'mail.sla_breached'
		)
	);

ALTER TABLE mail_conversation_events DROP CONSTRAINT ck_mail_conversation_events_kind;
ALTER TABLE mail_conversation_events ADD CONSTRAINT ck_mail_conversation_events_kind
	CHECK (
		kind IN (
			'assigned',
			'unassigned',
			'status_changed',
			'merged',
			'linked',
			'unlinked',
			'snoozed',
			'note_added',
			'converted',
			'split',
			'forwarded',
			'tag_added',
			'tag_removed',
			'review_requested',
			'review_approved',
			'review_changes_requested',
			'follow_up_due',
			'sla_breached',
			'draft_created',
			'outbound_started',
			'forwarded_from',
			'split_out',
			'split_from',
			'follow_up_set',
			'macro_status',
			'bulk_triaged',
			'linked_issue_completed',
			'linked_issue_reopened'
		)
	);
