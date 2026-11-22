import { create } from 'zustand'
import type { ToastItem, ToastTone } from '@/components/ui/toast'
import { navigateToDestination } from '@/lib/navigation'

export type AppDestination = 'inbox' | 'tasks' | 'docs' | 'chat' | 'settings'
export type TasksLayout = 'list' | 'board' | 'my-work'
export type DocSidePanel = 'comments' | 'versions' | 'toc' | null
export type DisplayDensity = 'compact' | 'comfortable'
export type ThemeMode = 'light' | 'dark'

export interface IssueFilters {
	readonly query: string
	readonly statusId: string | 'all'
	readonly priority: number | 'all'
	readonly assigneeId: string | 'all' | 'me' | 'unassigned'
	readonly activeViewId: string | null
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
	activeProjectId: string | null
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

	// Modals & overlays
	commandPaletteOpen: boolean
	shortcutsDialogOpen: boolean
	createIssueOpen: boolean
	createProjectOpen: boolean
	conflictDialogOpen: boolean
	importDialogOpen: boolean

	// Docs workspace ephemeral state
	docsSidebarOpen: boolean
	activeDocSidePanel: DocSidePanel
	createDocOpen: boolean
	docShareOpen: boolean
	docImportOpen: boolean
	selectedCommentThreadId: string | null

	// Ephemeral toast stack (§17.8)
	toasts: readonly ToastItem[]

	// Actions
	setDestination: (dest: AppDestination) => void
	setActiveProjectId: (projectId: string | null) => void
	setTasksLayout: (layout: TasksLayout) => void
	setDensity: (density: DisplayDensity) => void
	toggleTheme: () => void
	setTheme: (theme: ThemeMode) => void
	setShortcutsEnabled: (enabled: boolean) => void
	selectIssue: (issueId: string | null, openDetail?: boolean) => void
	setFocusedIssueId: (issueId: string | null) => void
	toggleMultiSelectIssue: (issueId: string) => void
	clearMultiSelect: () => void
	setDetailPanelOpen: (open: boolean) => void
	setFilterPatch: (patch: Partial<IssueFilters>) => void
	resetFilters: () => void
	setCommandPaletteOpen: (open: boolean) => void
	setShortcutsDialogOpen: (open: boolean) => void
	setCreateIssueOpen: (open: boolean) => void
	setCreateProjectOpen: (open: boolean) => void
	setConflictDialogOpen: (conflictDialogOpen: boolean) => void
	setImportDialogOpen: (open: boolean) => void
	setDocsSidebarOpen: (open: boolean) => void
	setActiveDocSidePanel: (panel: DocSidePanel) => void
	setCreateDocOpen: (open: boolean) => void
	setDocShareOpen: (open: boolean) => void
	setDocImportOpen: (open: boolean) => void
	setSelectedCommentThreadId: (commentId: string | null) => void
	pushToast: (toast: {
		readonly title: string
		readonly description?: string | undefined
		readonly tone?: ToastTone | undefined
		readonly actionLabel?: string | undefined
		readonly onAction?: (() => void) | undefined
	}) => string
	dismissToast: (id: string) => void
}

let toastSeq = 0

/**
 * Ephemeral UI state only (M1 rule: replicated server entities live exclusively in TanStack DB).
 */
export const useUiStore = create<UiState>((set, get) => ({
	destination: 'tasks',
	activeProjectId: null,
	tasksLayout: 'list',
	density: 'comfortable',
	theme: 'light',
	shortcutsEnabled: true,

	selectedIssueId: null,
	focusedIssueId: null,
	selectedIssueIds: [],
	detailPanelOpen: false,

	filters: DEFAULT_FILTERS,

	commandPaletteOpen: false,
	shortcutsDialogOpen: false,
	createIssueOpen: false,
	createProjectOpen: false,
	conflictDialogOpen: false,
	importDialogOpen: false,

	docsSidebarOpen: true,
	activeDocSidePanel: 'comments',
	createDocOpen: false,
	docShareOpen: false,
	docImportOpen: false,
	selectedCommentThreadId: null,

	toasts: [],

	setDestination: (destination) => {
		set({ destination })
		navigateToDestination(destination)
	},
	setActiveProjectId: (activeProjectId) =>
		set({ activeProjectId, selectedIssueId: null, focusedIssueId: null, selectedIssueIds: [] }),
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
	clearMultiSelect: () => set({ selectedIssueIds: [] }),
	setDetailPanelOpen: (detailPanelOpen) => set({ detailPanelOpen }),
	setFilterPatch: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
	resetFilters: () => set({ filters: DEFAULT_FILTERS }),
	setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
	setShortcutsDialogOpen: (shortcutsDialogOpen) => set({ shortcutsDialogOpen }),
	setCreateIssueOpen: (createIssueOpen) => set({ createIssueOpen }),
	setCreateProjectOpen: (createProjectOpen) => set({ createProjectOpen }),
	setConflictDialogOpen: (conflictDialogOpen) => set({ conflictDialogOpen }),
	setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),
	setDocsSidebarOpen: (docsSidebarOpen) => set({ docsSidebarOpen }),
	setActiveDocSidePanel: (activeDocSidePanel) => set({ activeDocSidePanel }),
	setCreateDocOpen: (createDocOpen) => set({ createDocOpen }),
	setDocShareOpen: (docShareOpen) => set({ docShareOpen }),
	setDocImportOpen: (docImportOpen) => set({ docImportOpen }),
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
			}, 5_000)
		}
		return id
	},
	dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((item) => item.id !== id) }))
}))
