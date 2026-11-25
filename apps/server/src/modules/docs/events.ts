/**
 * Domain event names for the docs module (§4.3 outbox, §10).
 */
export const DOCS_EVENTS = {
	PageCreated: 'docs.page.created.v1',
	PageUpdated: 'docs.page.updated.v1',
	PageMoved: 'docs.page.moved.v1',
	PageDeleted: 'docs.page.deleted.v1',
	StateSaved: 'docs.state.saved.v1',
	VersionCreated: 'docs.version.created.v1',
	VersionRestored: 'docs.version.restored.v1',
	CommentCreated: 'docs.comment.created.v1',
	CommentUpdated: 'docs.comment.updated.v1',
	CommentResolved: 'docs.comment.resolved.v1',
	CommentDeleted: 'docs.comment.deleted.v1',
	TeamspaceCreated: 'docs.teamspace.created.v1',
	TeamspaceUpdated: 'docs.teamspace.updated.v1',
	TeamspaceMemberUpdated: 'docs.teamspace.member.updated.v1',
	SyncedBlockCreated: 'docs.synced_block.created.v1',
	SyncedBlockUpdated: 'docs.synced_block.updated.v1',
	SuggestionCreated: 'docs.suggestion.created.v1',
	SuggestionDecided: 'docs.suggestion.decided.v1',
	VerificationUpdated: 'docs.verification.updated.v1',
	VerificationExpiring: 'docs.verification.expiring.v1',
	PublicShareUpdated: 'docs.public_share.updated.v1',
	PublicShareRevoked: 'docs.public_share.revoked.v1',
	ButtonTriggered: 'docs.button.triggered.v1'
} as const
