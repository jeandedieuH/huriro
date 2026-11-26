import type { ImportSource } from '@huriro/contracts'
import { create } from 'zustand'
import type { ToastItem, ToastTone } from '@/components/ui/toast'
import { navigateToDestination, navigateToSettingsSection } from '@/lib/navigation'

export type AppDestination = 'home' | 'inbox' | 'tasks' | 'docs' | 'chat' | 'settings'
export type SidebarLevel = 'root' | 'feature'
export type TasksPreset =
	| 'all'
	| 'my-tasks'
	| 'this-week'
	| 'my-week'
	| 'overdue'
	| 'due-soon'
	| 'trash'
	| 'triage'
export type InboxFilter = 'unread' | 'all' | 'assigned' | 'mentions' | 'archived'
export type InboxPane = 'notifications' | 'mail'
export type SettingsSection =
	| 'general'
	| 'members'
	| 'notifications'
	| 'billing'
	| 'governance'
	| 'imports'
	| 'webhooks'
	| 'agents'
	| 'approvals'
	| 'ai'
	| 'integrations'
	| 'mail'
	| 'appearance'
export type TasksLayout = 'list' | 'board' | 'my-work' | 'timeline' | 'calendar'
export type DocSidePanel = 'comments' | 'suggestions' | 'versions' | 'toc' | null
export type DisplayDensity = 'compact' | 'comfortable'
export type ThemeMode = 'light' | 'dark'

export interface IssueFilters {
	readonly query: string
	readonly statusId: string | 'all'
	readonly priority: number | 'all'
	readonly assigneeId: string | 'all' | 'me' | 'unassigned'
	readonly activeViewId: string | null
}

/**
 * Display/sort/group state for the tasks workspace (§3.4) — mirrors
 * `ViewDisplayOptions` on saved views but stays ephemeral until the user
 * saves the layout into a view.
 */
export interface TasksDisplayOptions {
	readonly groupBy:
		| 'none'
		| 'status_category'
		| 'priority'
		| 'assignee_id'
		| 'project_id'
		| 'cycle_id'
		| 'due_date'
	readonly subGroupBy: 'none' | 'priority' | 'assignee_id'
	readonly sortBy: 'manual' | 'priority' | 'due_date' | 'updated_at' | 'created_at' | 'estimate'
	readonly sortDirection: 'asc' | 'desc'
	readonly showSubIssues: boolean
}

export const DEFAULT_DISPLAY_OPTIONS: TasksDisplayOptions = {
	groupBy: 'none',
	subGroupBy: 'none',
	sortBy: 'manual',
	sortDirection: 'asc',
	showSubIssues: true
}

const DEFAULT_FILTERS: IssueFilters = {
	query: '',
	statusId: 'all',
	priority: 'all',
	assigneeId: 'all',
	activeViewId: null
}

export interface UiState {
	// Primary navigation & workspace view — `destination` mirrors the current
	// URL (router is the source of truth; __root syncs pathname → store)
	destination: AppDestination
	sidebarLevel: SidebarLevel
	sidebarCollapsed: boolean
	activeProjectId: string | null
	tasksPreset: TasksPreset
	inboxFilter: InboxFilter
	inboxPane: InboxPane
	settingsSection: SettingsSection
	tasksLayout: TasksLayout
	density: DisplayDensity
	theme: ThemeMode
	shortcutsEnabled: boolean

	// Selection & detail drawer
	selectedIssueId: string | null
	focusedIssueId: string | null
	selectedIssueIds: readonly string[]
	detailPanelOpen: boolean

	// Filters & saved views
	filters: IssueFilters
	tasksDisplay: TasksDisplayOptions
	/** Compound filter expr currently applied in the workspace — null = legacy flat filters. */
	filterExpr: unknown | null

	// Modals & overlays
	commandPaletteOpen: boolean
	shortcutsDialogOpen: boolean
	createIssueOpen: boolean
	createProjectOpen: boolean
	projectSettingsOpen: boolean
	conflictDialogOpen: boolean
	importDialogOpen: boolean
	importDialogSource: ImportSource
	serverReadOnly: boolean

	// Docs workspace ephemeral state
	docsSidebarOpen: boolean
	activeDocSidePanel: DocSidePanel
	createDocOpen: boolean
	docShareOpen: boolean
	docImportOpen: boolean
	docPublishOpen: boolean
	teamspaceManagerOpen: boolean
	docsGraphOpen: boolean
	activeTeamspaceId: string | null
	selectedCommentThreadId: string | null

	// Ephemeral toast stack (§17.8)
	toasts: readonly ToastItem[]

	// Actions
	setDestination: (dest: AppDestination) => void
	setSidebarLevel: (level: SidebarLevel) => void
	setSidebarCollapsed: (collapsed: boolean) => void
	toggleSidebarCollapsed: () => void
	setActiveProjectId: (projectId: string | null) => void
	setTasksPreset: (preset: TasksPreset) => void
	setInboxFilter: (filter: InboxFilter) => void
	setInboxPane: (pane: InboxPane) => void
	setSettingsSection: (section: SettingsSection) => void
	setTasksLayout: (layout: TasksLayout) => void
	setDensity: (density: DisplayDensity) => void
	toggleTheme: () => void
	setTheme: (theme: ThemeMode) => void
	setShortcutsEnabled: (enabled: boolean) => void
	selectIssue: (issueId: string | null, openDetail?: boolean) => void
	setFocusedIssueId: (issueId: string | null) => void
	toggleMultiSelectIssue: (issueId: string) => void
	/** Shift-click range selection across the visible order (§3.4). */
	rangeSelectIssue: (issueId: string, orderedIds: readonly string[]) => void
	selectAllIssues: (ids: readonly string[]) => void
	clearMultiSelect: () => void
	setDetailPanelOpen: (open: boolean) => void
	setFilterPatch: (patch: Partial<IssueFilters>) => void
	resetFilters: () => void
	setTasksDisplay: (patch: Partial<TasksDisplayOptions>) => void
	setFilterExpr: (expr: unknown | null) => void
	setCommandPaletteOpen: (open: boolean) => void
	setShortcutsDialogOpen: (open: boolean) => void
	setCreateIssueOpen: (open: boolean) => void
	setCreateProjectOpen: (open: boolean) => void
	setProjectSettingsOpen: (open: boolean) => void
	setConflictDialogOpen: (conflictDialogOpen: boolean) => void
	setImportDialogOpen: (open: boolean) => void
	openImportDialog: (source?: ImportSource) => void
	setServerReadOnly: (readOnly: boolean) => void
	setDocsSidebarOpen: (open: boolean) => void
	setActiveDocSidePanel: (panel: DocSidePanel) => void
	setCreateDocOpen: (open: boolean) => void
	setDocShareOpen: (open: boolean) => void
	setDocImportOpen: (open: boolean) => void
	setDocPublishOpen: (open: boolean) => void
	setTeamspaceManagerOpen: (open: boolean) => void
	setDocsGraphOpen: (open: boolean) => void
	setActiveTeamspaceId: (teamspaceId: string | null) => void
	setSelectedCommentThreadId: (commentId: string | null) => void
	pushToast: (toast: {
		readonly title: string
		readonly description?: string | undefined
		readonly tone?: ToastTone | undefined
		readonly actionLabel?: string | undefined
		readonly onAction?: (() => void) | undefined
		/** Auto-dismiss override (ms) — default 5000; bulk undo passes the server window. */
		readonly durationMs?: number | undefined
	}) => string
	dismissToast: (id: string) => void
}

let toastSeq = 0

/**
 * Ephemeral UI state only (M1 rule: replicated server entities live exclusively in TanStack DB).
 */
export const useUiStore = create<UiState>((set, get) => ({
	destination: 'home',
	sidebarLevel: 'root',
	sidebarCollapsed: false,
	activeProjectId: null,
	tasksPreset: 'all',
	inboxFilter: 'unread',
	inboxPane: 'notifications',
	settingsSection: 'general',
	tasksLayout: 'list',
	density: 'comfortable',
	theme: 'light',
	shortcutsEnabled: true,

	selectedIssueId: null,
	focusedIssueId: null,
	selectedIssueIds: [],
	detailPanelOpen: false,

	filters: DEFAULT_FILTERS,
	tasksDisplay: DEFAULT_DISPLAY_OPTIONS,
	filterExpr: null,

	commandPaletteOpen: false,
	shortcutsDialogOpen: false,
	createIssueOpen: false,
	createProjectOpen: false,
	projectSettingsOpen: false,
	conflictDialogOpen: false,
	importDialogOpen: false,
	importDialogSource: 'linear',
	serverReadOnly: false,

	docsSidebarOpen: true,
	activeDocSidePanel: null,
	createDocOpen: false,
	docShareOpen: false,
	docImportOpen: false,
	docPublishOpen: false,
	teamspaceManagerOpen: false,
	docsGraphOpen: false,
	activeTeamspaceId: null,
	selectedCommentThreadId: null,

	toasts: [],

	setDestination: (destination) => {
		set({
			destination,
			sidebarLevel: destination === 'home' ? 'root' : 'feature',
			...(destination === 'inbox' ? { inboxPane: 'notifications' as const } : {})
		})
		navigateToDestination(destination)
	},
	setSidebarLevel: (sidebarLevel) => set({ sidebarLevel }),
	setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
	toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
	setActiveProjectId: (activeProjectId) =>
		set({ activeProjectId, selectedIssueId: null, focusedIssueId: null, selectedIssueIds: [] }),
	setTasksPreset: (tasksPreset) =>
		set((s) => ({
			tasksPreset,
			filters: { ...s.filters, activeViewId: null },
			selectedIssueId: null,
			focusedIssueId: null,
			selectedIssueIds: []
		})),
	setInboxFilter: (inboxFilter) => set({ inboxFilter, inboxPane: 'notifications' }),
	setInboxPane: (inboxPane) => set({ inboxPane }),
	setSettingsSection: (settingsSection) => {
		set({ settingsSection })
		if (get().destination === 'settings') {
			navigateToSettingsSection(settingsSection)
		}
	},
	setTasksLayout: (tasksLayout) => set({ tasksLayout }),
	setDensity: (density) => set({ density }),
	toggleTheme: () =>
		set((s) => {
			const next: ThemeMode = s.theme === 'dark' ? 'light' : 'dark'
			if (typeof document !== 'undefined') {
				document.documentElement.classList.toggle('dark', next === 'dark')
			}
			return { theme: next }
		}),
	setTheme: (theme) => {
		if (typeof document !== 'undefined') {
			document.documentElement.classList.toggle('dark', theme === 'dark')
		}
		set({ theme })
	},
	setShortcutsEnabled: (shortcutsEnabled) => set({ shortcutsEnabled }),
	selectIssue: (issueId, openDetail = true) =>
		set({
			selectedIssueId: issueId,
			focusedIssueId: issueId,
			detailPanelOpen: issueId !== null ? openDetail : false
		}),
	setFocusedIssueId: (focusedIssueId) => set({ focusedIssueId }),
	toggleMultiSelectIssue: (issueId) =>
		set((s) => ({
			selectedIssueIds: s.selectedIssueIds.includes(issueId)
				? s.selectedIssueIds.filter((id) => id !== issueId)
				: [...s.selectedIssueIds, issueId]
		})),
	rangeSelectIssue: (issueId, orderedIds) =>
		set((s) => {
			const anchor = s.focusedIssueId ?? s.selectedIssueIds[s.selectedIssueIds.length - 1]
			const end = orderedIds.indexOf(issueId)
			const start = anchor ? orderedIds.indexOf(anchor) : -1
			if (end < 0) return {}
			if (start < 0) {
				return { selectedIssueIds: [...new Set([...s.selectedIssueIds, issueId])], focusedIssueId: issueId }
			}
			const [lo, hi] = start < end ? [start, end] : [end, start]
			const range = orderedIds.slice(lo, hi + 1)
			return { selectedIssueIds: [...new Set([...s.selectedIssueIds, ...range])], focusedIssueId: issueId }
		}),
	selectAllIssues: (ids) => set({ selectedIssueIds: [...ids] }),
	clearMultiSelect: () => set({ selectedIssueIds: [] }),
	setDetailPanelOpen: (detailPanelOpen) => set({ detailPanelOpen }),
	setFilterPatch: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
	resetFilters: () => set({ filters: DEFAULT_FILTERS, filterExpr: null }),
	setTasksDisplay: (patch) => set((s) => ({ tasksDisplay: { ...s.tasksDisplay, ...patch } })),
	setFilterExpr: (filterExpr) => set({ filterExpr, filters: { ...get().filters, activeViewId: null } }),
	setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
	setShortcutsDialogOpen: (shortcutsDialogOpen) => set({ shortcutsDialogOpen }),
	setCreateIssueOpen: (createIssueOpen) => set({ createIssueOpen }),
	setCreateProjectOpen: (createProjectOpen) => set({ createProjectOpen }),
	setProjectSettingsOpen: (projectSettingsOpen) => set({ projectSettingsOpen }),
	setConflictDialogOpen: (conflictDialogOpen) => set({ conflictDialogOpen }),
	setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),
	openImportDialog: (source) =>
		set((s) => ({
			importDialogOpen: true,
			importDialogSource: source ?? s.importDialogSource
		})),
	setServerReadOnly: (serverReadOnly) => set({ serverReadOnly }),
	setDocsSidebarOpen: (docsSidebarOpen) => set({ docsSidebarOpen }),
	setActiveDocSidePanel: (activeDocSidePanel) => set({ activeDocSidePanel }),
	setCreateDocOpen: (createDocOpen) => set({ createDocOpen }),
	setDocShareOpen: (docShareOpen) => set({ docShareOpen }),
	setDocImportOpen: (docImportOpen) => set({ docImportOpen }),
	setDocPublishOpen: (docPublishOpen) => set({ docPublishOpen }),
	setTeamspaceManagerOpen: (teamspaceManagerOpen) => set({ teamspaceManagerOpen }),
	setDocsGraphOpen: (docsGraphOpen) => set({ docsGraphOpen }),
	setActiveTeamspaceId: (activeTeamspaceId) => set({ activeTeamspaceId }),
	setSelectedCommentThreadId: (selectedCommentThreadId) => set({ selectedCommentThreadId }),
	pushToast: (toast) => {
		toastSeq += 1
		const id = `toast-${toastSeq}`
		set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }))
		if (typeof window !== 'undefined') {
			setTimeout(() => {
				if (get().toasts.some((item) => item.id === id)) {
					get().dismissToast(id)
				}
			}, toast.durationMs ?? 5_000)
		}
		return id
	},
	dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((item) => item.id !== id) }))
}))
