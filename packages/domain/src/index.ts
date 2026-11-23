// @huriro/domain public surface — pure, no I/O (§7.2).

export type { ExtractedChatMentions, ExtractedRichLink } from './chat'
export {
	computeDmKey,
	computeWebhookBackoffMs,
	extractChatMentions,
	extractRichLinks,
	extractUrls,
	isWithinQuietHours
} from './chat'
export type { MergeResolution } from './conflict'
export { resolveFieldMerge } from './conflict'
export {
	comparePositions,
	DEFAULT_REBALANCE_MAX_LENGTH,
	generateKeyBetween,
	generateNKeysBetween,
	isValidPositionKey,
	needsRebalance,
	rebalanceKeys
} from './fractional-index'
export type { Action, SystemRoleKey } from './permissions'
export {
	ACTIONS,
	ADMIN_BYPASS_RANK,
	isAction,
	ROLE_RANKS,
	SYSTEM_ROLE_KEYS,
	SYSTEM_ROLES
} from './permissions'
export type {
	AclLevel,
	AclResourceType,
	ActorContext,
	Decision,
	DenyReason,
	ResourceRef
} from './policy'
export { ACL_RESOURCE_TYPES, aclSatisfies, can, needsAcl, requiredAclLevel } from './policy'
export type { ParsedSearchQuery, SearchMode } from './search-query'
export { parseSearchQuery } from './search-query'
