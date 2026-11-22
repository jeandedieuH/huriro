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
import { createPreviewSeedSnapshot } from '@/lib/sync-bootstrap'
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
})
