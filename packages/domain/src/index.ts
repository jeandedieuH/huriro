// @huriro/domain public surface — pure, no I/O (§7.2).

export type { AgentScope, RiskTier } from './agent-scopes'
export {
	AGENT_SCOPES,
	actionsForScopes,
	effectiveRisk,
	isAgentExecutable,
	isAgentScope,
	RISK_TIERS,
	SCOPE_ACTIONS
} from './agent-scopes'
export type {
	AvailabilityProfileLike,
	AvailabilityWarning,
	AvailabilityWarningKey,
	AvailabilityWindowKind,
	AvailabilityWindowLike,
	EffectiveAvailabilityState,
	LivePresenceState,
	ManualAvailabilityState,
	NotificationSuppressionReason,
	ResolvedAvailability,
	WeekdayKey,
	WorkingHoursInterval,
	WorkingHoursSchedule,
	WorkingHoursValidation
} from './availability'
export {
	AVAILABILITY_WARNING_KEYS,
	AVAILABILITY_WINDOW_KINDS,
	buildAvailabilityWarning,
	defaultWorkingHours,
	EFFECTIVE_AVAILABILITY_STATES,
	evaluateNotificationSuppression,
	isAvailabilityRoutable,
	isValidHHMM,
	isValidIanaTimezone,
	localTimeLabel,
	MANUAL_AVAILABILITY_STATES,
	MAX_INTERVALS_PER_DAY,
	NEXT_AVAILABLE_HORIZON_DAYS,
	normalizeWorkingHours,
	resolveEffectiveAvailability,
	validateWorkingHours,
	WEEKDAYS
} from './availability'
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
export type { CyclePolicy, CycleWindow } from './cycle-schedule'
export {
	alignToWeekday,
	isCycleDueToActivate,
	isCycleDueToComplete,
	nextCycleWindow,
	windowsToPreCreate
} from './cycle-schedule'
export type {
	DatabaseCellValueLike,
	DatabaseFilterExpr,
	DatabaseFilterOp,
	DatabaseFilterValidation,
	DatabasePropertyMeta,
	DatabaseRowLike,
	DatabaseSortSpec
} from './database-filter'
export {
	compareDatabaseRows,
	DATABASE_FILTER_LIMITS,
	databaseCellValue,
	evaluateDatabaseFilter,
	validateDatabaseFilter
} from './database-filter'
export type {
	PortableCellInput,
	PortableDatabaseProperty,
	PortableDatabaseRowInput
} from './database-portability'
export {
	databaseRowsFromCsv,
	databaseRowsFromJson,
	databaseRowsToCsv,
	databaseRowsToJson,
	parseCsv,
	portableCellDisplay,
	serializeCsv
} from './database-portability'
export type {
	FilterableIssue,
	FilterContext,
	FilterExpr,
	FilterField,
	FilterFieldDef,
	FilterFieldType,
	FilterOp,
	FilterPredicate,
	FilterScalar,
	FilterValidation,
	FilterValidationError,
	FilterValue,
	RelativeDate
} from './filter-ast'
export {
	compileFilter,
	evaluateFilter,
	FILTER_FIELDS,
	FILTER_TRUE,
	legacyFiltersToExpr,
	normalizeFilter,
	resolveRelative,
	validateFilter
} from './filter-ast'
export type { FilterNodeEdit, FilterNodePath } from './filter-builder'
export {
	appendFilterNode,
	countFilterNodes,
	createGroup,
	createPredicate,
	filterExprEquals,
	getFilterNode,
	opNeedsValue,
	patchPredicate,
	removeFilterNode,
	setFilterCombinator,
	toggleFilterNot,
	updateFilterNode
} from './filter-builder'
export type {
	FormulaDateValue,
	FormulaErrorCode,
	FormulaEvalContext,
	FormulaExpr,
	FormulaLambdaValue,
	FormulaPrimitive,
	FormulaRuntimeValue,
	FormulaValidationResult,
	FormulaValue
} from './formula'
export {
	countFormulaAstNodes,
	detectFormulaDependencyCycle,
	evaluateFormula,
	evaluateFormulaAst,
	extractFormulaPropDependencies,
	FORMULA_LIMITS,
	FormulaError,
	isFormulaDate,
	isFormulaLambda,
	parseFormula,
	validateFormulaSource
} from './formula'
export {
	comparePositions,
	DEFAULT_REBALANCE_MAX_LENGTH,
	generateKeyBetween,
	generateNKeysBetween,
	isValidPositionKey,
	needsRebalance,
	rebalanceKeys
} from './fractional-index'
export {
	isPlausibleEmail,
	normalizeEmail,
	normalizeMailSubject,
	threadingKeyMatches
} from './mail'
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
export { ACL_RESOURCE_TYPES, aclSatisfies, attributionOf, can, needsAcl, requiredAclLevel } from './policy'
export type { ParsedSearchQuery, SearchMode } from './search-query'
export { parseSearchQuery } from './search-query'
export type { TimelineBarGeometry, TimelineRange, TimelineZoom } from './timeline'
export {
	addDaysIso,
	calendarMonthGrid,
	diffDaysIso,
	formatIsoDate,
	resizeDateSpan,
	shiftDateSpan,
	timelineBarGeometry,
	timelineRangeForZoom,
	todayIsoFromDate
} from './timeline'
