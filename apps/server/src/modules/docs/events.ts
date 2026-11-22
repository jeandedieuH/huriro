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
	CommentDeleted: 'docs.comment.deleted.v1'
} as const
