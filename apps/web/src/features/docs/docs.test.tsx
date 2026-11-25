import type { DocPageDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import {
	generateUuidV7,
	HuriroSyncEngine,
	MemoryReplicaStorage,
	SyncProvider,
	type SyncTransport
} from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { CreateDocDialog } from './components/create-doc-dialog'
import { DocsSidebarNav } from './components/docs-sidebar-nav'
import { DocsWorkspace } from './components/docs-workspace'

activateI18n('en')

async function renderDocsWorkspace(activeSlug: string | null) {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<SyncProvider engine={boot.engine}>
				<div className="flex h-full">
					<DocsSidebarNav activeSlug={activeSlug} />
					<DocsWorkspace
						api={boot.api}
						currentUserId={boot.currentUserId}
						isPreview={true}
						activeSlug={activeSlug}
					/>
				</div>
			</SyncProvider>
		</TooltipProvider>
	)
	return { boot, ...rendered }
}

describe('DocsWorkspace', () => {
	beforeAll(async () => {
		await import('./components/editor-shell')
	})

	beforeEach(() => {
		useUiStore.setState({
			destination: 'docs',
			shortcutsEnabled: true,
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
			toasts: []
		})
	})

	it('renders page tree and active TipTap collaborative doc cleanly with zero axe violations', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(
				() => {
					expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
				},
				{ timeout: 5000 }
			)
			expect(screen.getByRole('navigation', { name: 'Workspace pages' })).toBeInTheDocument()
			const leafPageButton = screen.getByRole('button', { name: 'Incident Response Runbook' })
			// Leaf-only branches do not reserve a disclosure gutter, keeping their icons aligned with utility actions.
			expect(leafPageButton.parentElement?.firstElementChild).toBe(leafPageButton)
			expect(screen.getByText('Let us keep latency under 50ms p95.')).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports adding comments, resolving threads, and inspecting orphaned-anchor badge', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(
				() => {
					expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
				},
				{ timeout: 5000 }
			)

			const commentInput = screen.getByPlaceholderText('Add a comment (@mention colleagues)…')
			fireEvent.change(commentInput, { target: { value: 'Great RFC breakdown!' } })
			const postButtons = screen.getAllByRole('button', { name: 'Post comment' })
			const topPost = postButtons[0]
			if (!topPost) throw new Error('Expected Post comment button')
			fireEvent.click(topPost)

			await waitFor(() => {
				expect(screen.getByText('Great RFC breakdown!')).toBeInTheDocument()
			})

			const resolveButtons = screen.getAllByRole('button', { name: 'Resolve' })
			const firstResolve = resolveButtons[0]
			if (!firstResolve) throw new Error('Expected Resolve button')
			fireEvent.click(firstResolve)
			await waitFor(() => {
				expect(screen.getByText('Resolved')).toBeInTheDocument()
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders version timeline diff and creates/restores named snapshots cleanly', async () => {
		useUiStore.setState({ activeDocSidePanel: 'versions' })
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(
				() => {
					expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
				},
				{ timeout: 5000 }
			)

			await waitFor(() => {
				expect(screen.getByText('Initial baseline')).toBeInTheDocument()
			})

			const snapInput = screen.getByPlaceholderText('Snapshot label (e.g. Ready for review)')
			fireEvent.change(snapInput, { target: { value: 'v2 milestone' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))

			await waitFor(() => {
				expect(screen.getByText('v2 milestone')).toBeInTheDocument()
			})

			fireEvent.click(screen.getByText('Initial baseline'))
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Restore version' })).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
			await waitFor(() => {
				expect(screen.getAllByText('Pre-restore').length).toBeGreaterThan(0)
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports creating a new page from template and opening share dialog with zero axe violations', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(
				() => {
					expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
				},
				{ timeout: 5000 }
			)

			// Open share dialog
			fireEvent.click(screen.getByRole('button', { name: 'Share' }))
			await waitFor(() => {
				expect(screen.getByText('Share & permissions')).toBeInTheDocument()
			})
			fireEvent.click(screen.getByRole('button', { name: 'Grant access' }))
			await waitFor(() => {
				expect(screen.getByText('Can comment')).toBeInTheDocument()
			})
			await expectNoViolations(container)
			const closeButtons = screen.getAllByRole('button', { name: 'Close' })
			const firstClose = closeButtons[0]
			if (!firstClose) throw new Error('Expected Close button')
			fireEvent.click(firstClose)

			// Create new page via dialog
			act(() => {
				useUiStore.getState().setCreateDocOpen(true)
			})
			await waitFor(() => {
				expect(screen.getByPlaceholderText('Engineering handbook')).toBeInTheDocument()
			})
			fireEvent.change(screen.getByPlaceholderText('Engineering handbook'), {
				target: { value: 'Release Checklist' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

			await waitFor(() => {
				expect(screen.getAllByText('Release Checklist').length).toBeGreaterThan(0)
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('shows a single template label when the blank option is selected', async () => {
		const boot = await createPreviewWorkspace()
		try {
			useUiStore.setState({ createDocOpen: true })
			render(
				<SyncProvider engine={boot.engine}>
					<CreateDocDialog pages={[]} />
				</SyncProvider>
			)
			const templateTrigger = await screen.findByRole('combobox', { name: 'Template' })
			// Regression: two items sharing value="blank" are both "selected", so Radix
			// concatenated their labels in the trigger ("Blank documentBlank page")
			await waitFor(() => {
				expect(templateTrigger.textContent).toBe('Blank document')
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('resyncs snapshot and removes ghost page from sidebar on 404 when opening stale replica doc', async () => {
		const previewBoot = await createPreviewWorkspace()
		const wsId = generateUuidV7()
		const userId = generateUuidV7()
		const ghostId = generateUuidV7()
		const nowIso = '2026-11-24T00:00:00Z'
		const ghostDoc: DocPageDto = {
			id: ghostId,
			workspaceId: wsId,
			parentId: null,
			path: ghostId,
			depth: 0,
			slug: 'repro-doc',
			title: 'Repro Doc',
			icon: null,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: userId,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}
		let serverDocs: DocPageDto[] = [ghostDoc]
		let snapshotCalls = 0

		const transport: SyncTransport = {
			async fetchSnapshot() {
				snapshotCalls += 1
				return {
					cursor: snapshotCalls,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: serverDocs
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				return { cursor: snapshotCalls, results: [] }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: wsId,
			currentUserId: userId,
			storage: new MemoryReplicaStorage(),
			transport
		})
		await engine.bootstrap()
		// Server no longer has ghostDoc, simulating stale local OPFS cache.
		serverDocs = []

		const liveApi = {
			...previewBoot.api,
			async listMembers() {
				return []
			},
			async getDocBySlug(_slug: string) {
				const err = new Error('Document page not found') as Error & { status?: number }
				err.status = 404
				throw err
			}
		}

		const { unmount } = render(
			<TooltipProvider>
				<SyncProvider engine={engine}>
					<div className="flex h-full">
						<DocsSidebarNav activeSlug="repro-doc" />
						<DocsWorkspace api={liveApi} currentUserId={userId} isPreview={false} activeSlug="repro-doc" />
					</div>
				</SyncProvider>
			</TooltipProvider>
		)

		try {
			expect(screen.getByText('Repro Doc')).toBeInTheDocument()
			await waitFor(() => {
				expect(snapshotCalls).toBe(2)
				expect(screen.queryByText('Repro Doc')).not.toBeInTheDocument()
			})
		} finally {
			unmount()
			engine.dispose()
			previewBoot.engine.dispose()
		}
	})

	it('refreshes slug via resyncSnapshot and loads document when slug changed remotely', async () => {
		const previewBoot = await createPreviewWorkspace()
		const wsId = generateUuidV7()
		const userId = generateUuidV7()
		const docId = generateUuidV7()
		const nowIso = '2026-11-24T00:00:00Z'
		const initialDoc: DocPageDto = {
			id: docId,
			workspaceId: wsId,
			parentId: null,
			path: docId,
			depth: 0,
			slug: 'old-slug',
			title: 'Renamed Doc',
			icon: null,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: userId,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}
		const updatedDoc: DocPageDto = { ...initialDoc, slug: 'new-slug', version: 2 }
		let serverDocs: DocPageDto[] = [initialDoc]

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: serverDocs
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				return { cursor: 1, results: [] }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: wsId,
			currentUserId: userId,
			storage: new MemoryReplicaStorage(),
			transport
		})
		await engine.bootstrap()
		serverDocs = [updatedDoc]

		const onSelectSlug = vi.fn()
		const liveApi = {
			...previewBoot.api,
			async listMembers() {
				return []
			},
			async listDocVersions() {
				return []
			},
			async getDocBySlug(slug: string) {
				if (slug === 'new-slug') {
					return {
						page: updatedDoc,
						stateBase64: '',
						stateVectorBase64: '',
						byteSize: 0,
						plainText: '',
						headings: [],
						comments: [],
						canWrite: true,
						canShare: true
					}
				}
				const err = new Error('Document page not found') as Error & { status?: number }
				err.status = 404
				throw err
			}
		}

		const { unmount } = render(
			<TooltipProvider>
				<SyncProvider engine={engine}>
					<DocsWorkspace
						api={liveApi}
						currentUserId={userId}
						isPreview={false}
						activeSlug="old-slug"
						onSelectSlug={onSelectSlug}
					/>
				</SyncProvider>
			</TooltipProvider>
		)

		try {
			await waitFor(() => {
				expect(onSelectSlug).toHaveBeenCalledWith('new-slug')
				expect(screen.getByDisplayValue('Renamed Doc')).toBeInTheDocument()
			})
		} finally {
			unmount()
			engine.dispose()
			previewBoot.engine.dispose()
		}
	})

	it('archives ghost page via sidebar menu without resurrecting it on 404 not_found', async () => {
		const wsId = generateUuidV7()
		const userId = generateUuidV7()
		const ghostId = generateUuidV7()
		const nowIso = '2026-11-24T00:00:00Z'
		const ghostDoc: DocPageDto = {
			id: ghostId,
			workspaceId: wsId,
			parentId: null,
			path: ghostId,
			depth: 0,
			slug: 'repro-doc',
			title: 'Repro Doc',
			icon: null,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: userId,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: [ghostDoc]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 404,
						outcome: 'not_found',
						error: 'Document page not found'
					}))
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: wsId,
			currentUserId: userId,
			storage: new MemoryReplicaStorage(),
			transport
		})
		await engine.bootstrap()

		const { unmount } = render(
			<TooltipProvider>
				<SyncProvider engine={engine}>
					<DocsSidebarNav activeSlug={null} />
				</SyncProvider>
			</TooltipProvider>
		)

		try {
			const actionsTrigger = screen.getByRole('button', { name: 'Repro Doc actions' })
			fireEvent.keyDown(actionsTrigger, { key: 'Enter' })
			const archiveItem = await screen.findByRole('menuitem', { name: 'Archive page' })
			fireEvent.click(archiveItem)

			await waitFor(() => {
				expect(engine.getStatus().pendingCount).toBe(0)
				expect(screen.queryByText('Repro Doc')).not.toBeInTheDocument()
			})
			expect(engine.collections.docPages.get(ghostId)).toBeUndefined()
		} finally {
			unmount()
			engine.dispose()
		}
	})
})
