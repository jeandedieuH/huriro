import { activateI18n } from '@huriro/i18n'
import {
	generateUuidV7,
	HuriroSyncEngine,
	MemoryReplicaStorage,
	SyncProvider,
	type SyncTransport
} from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewSeedSnapshot } from '@/lib/preview-workspace'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { ConflictResolverDialog } from './components/conflict-resolver-dialog'
import { SyncStatusBanner } from './components/sync-status-banner'

activateI18n('en')

describe('SyncStatusBanner & ConflictResolverDialog', () => {
	beforeEach(() => {
		useUiStore.setState({ conflictDialogOpen: false })
	})

	it('surfaces overlapping conflict in banner and resolves with keep-local patch', async () => {
		const seed = createPreviewSeedSnapshot()
		const targetIssue = seed.issues[0]
		if (!targetIssue) throw new Error('missing seed issue')

		let attempt = 0
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return seed
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: since,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				attempt += 1
				const m = mutations[0]
				if (!m) return { cursor: 1, results: [] }
				if (attempt === 1) {
					return {
						cursor: 2,
						results: [
							{
								mutationId: m.mutationId,
								status: 409,
								outcome: 'stale_version',
								currentVersion: 2,
								currentEntity: { ...targetIssue, title: 'Server conflict title', version: 2 },
								changedFields: ['title']
							}
						]
					}
				}
				return {
					cursor: 3,
					results: [
						{
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: { ...targetIssue, title: String(m.patch['title']), version: 3 }
						}
					]
				}
			}
		}

		const storage = new MemoryReplicaStorage()
		const engine = new HuriroSyncEngine({
			workspaceId: seed.projects[0]?.workspaceId ?? generateUuidV7(),
			currentUserId: seed.projects[0]?.createdBy ?? generateUuidV7(),
			storage,
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)
		await engine.updateIssue(targetIssue.id, { title: 'My offline edit' })
		engine.setOnline(true)
		await engine.flushOutbox()

		try {
			const { container } = render(
				<SyncProvider engine={engine}>
					<SyncStatusBanner />
					<ConflictResolverDialog />
				</SyncProvider>
			)

			expect(screen.getByText(/1 conflict needs review/)).toBeInTheDocument()
			await expectNoViolations(container)

			fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
			expect(await screen.findByText('Resolve sync conflict')).toBeInTheDocument()
			expect(screen.getByText('My offline edit')).toBeInTheDocument()
			expect(screen.getByText('Server conflict title')).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Apply resolution' }))

			await waitFor(() => {
				expect(engine.getConflicts()).toHaveLength(0)
				expect(engine.collections.issues.get(targetIssue.id)?.title).toBe('My offline edit')
			})
		} finally {
			engine.dispose()
		}
	})

	it('renders nothing when healthy — no Synced indicator or manual Sync now button', async () => {
		const seed = createPreviewSeedSnapshot()
		const engine = new HuriroSyncEngine({
			workspaceId: seed.projects[0]?.workspaceId ?? generateUuidV7(),
			currentUserId: seed.projects[0]?.createdBy ?? generateUuidV7(),
			storage: new MemoryReplicaStorage()
		})
		await engine.bootstrap({ skipNetwork: true })

		try {
			const { container } = render(
				<SyncProvider engine={engine}>
					<SyncStatusBanner />
				</SyncProvider>
			)
			expect(container.firstChild).toBeNull()
			expect(screen.queryByText('Synced')).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
		} finally {
			engine.dispose()
		}
	})

	it('shows offline banner with auto-sync hint when offline and disappears when back online', async () => {
		const seed = createPreviewSeedSnapshot()
		const engine = new HuriroSyncEngine({
			workspaceId: seed.projects[0]?.workspaceId ?? generateUuidV7(),
			currentUserId: seed.projects[0]?.createdBy ?? generateUuidV7(),
			storage: new MemoryReplicaStorage()
		})
		await engine.bootstrap({ skipNetwork: true })
		engine.setOnline(false)

		try {
			const { container } = render(
				<SyncProvider engine={engine}>
					<SyncStatusBanner />
				</SyncProvider>
			)
			expect(screen.getByText('Offline')).toBeInTheDocument()
			expect(screen.getByText(/Changes will sync automatically when you reconnect/)).toBeInTheDocument()
			await expectNoViolations(container)

			engine.setOnline(true)
			await waitFor(() => {
				expect(container.firstChild).toBeNull()
			})
		} finally {
			engine.dispose()
		}
	})

	it('shows Retry action on sync error and hides banner once recovery succeeds', async () => {
		const seed = createPreviewSeedSnapshot()
		let shouldFail = false
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return seed
			},
			async fetchChanges(since) {
				if (shouldFail) {
					const err = new Error('Sync upstream timeout (503)') as Error & { status?: number }
					err.status = 503
					throw err
				}
				return {
					changes: [],
					nextCursor: since,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch() {
				return { cursor: seed.cursor, results: [] }
			}
		}
		const engine = new HuriroSyncEngine({
			workspaceId: seed.projects[0]?.workspaceId ?? generateUuidV7(),
			currentUserId: seed.projects[0]?.createdBy ?? generateUuidV7(),
			storage: new MemoryReplicaStorage(),
			transport,
			syncRetryBaseMs: 60_000
		})
		await engine.bootstrap()
		shouldFail = true
		await engine.syncNow()

		try {
			const { container } = render(
				<SyncProvider engine={engine}>
					<SyncStatusBanner />
				</SyncProvider>
			)
			expect(screen.getByText(/Sync upstream timeout/)).toBeInTheDocument()
			shouldFail = false
			fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

			await waitFor(() => {
				expect(container.firstChild).toBeNull()
			})
		} finally {
			engine.dispose()
		}
	})

	it('renders plural conflict banner when multiple records conflict and keeps dialog open until all resolve', async () => {
		const seed = createPreviewSeedSnapshot()
		const issueA = seed.issues[0]
		const issueB = seed.issues[1]
		if (!issueA || !issueB) throw new Error('missing two seed issues')

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return seed
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: since,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				return {
					cursor: 2,
					results: mutations.map((m) => {
						const baseIssue = m.entityId === issueA.id ? issueA : issueB
						return {
							mutationId: m.mutationId,
							status: 409,
							outcome: 'stale_version' as const,
							currentVersion: 2,
							currentEntity: { ...baseIssue, title: 'Server title', version: 2 },
							changedFields: ['title']
						}
					})
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: seed.projects[0]?.workspaceId ?? generateUuidV7(),
			currentUserId: seed.projects[0]?.createdBy ?? generateUuidV7(),
			storage: new MemoryReplicaStorage(),
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)
		await engine.updateIssue(issueA.id, { title: 'Local A' })
		await engine.updateIssue(issueB.id, { title: 'Local B' })
		engine.setOnline(true)
		await engine.flushOutbox()

		try {
			render(
				<SyncProvider engine={engine}>
					<SyncStatusBanner />
					<ConflictResolverDialog />
				</SyncProvider>
			)

			expect(screen.getByText(/2 conflicts need review/)).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
			expect(await screen.findByText('Resolve sync conflict')).toBeInTheDocument()

			// Keeping theirs for the first conflict leaves the dialog open for the remaining conflict.
			fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
			await waitFor(() => {
				expect(engine.getConflicts()).toHaveLength(1)
			})
			expect(screen.getByText(/1 conflict needs review/)).toBeInTheDocument()
			expect(screen.getByText('Resolve sync conflict')).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
			await waitFor(() => {
				expect(engine.getConflicts()).toHaveLength(0)
			})
		} finally {
			engine.dispose()
		}
	})
})
