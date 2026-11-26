import { activateI18n } from '@huriro/i18n'
import { MemoryReplicaStorage, SyncProvider } from '@huriro/sync-client'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Y from 'yjs'
import { createPreviewWorkspace } from '@/lib/preview-workspace'
import { EditorShell } from './editor-shell'

activateI18n('en')

const providerMock = vi.hoisted(() => ({
	providerInstances: [] as { destroy: ReturnType<typeof vi.fn> }[],
	websocketInstances: [] as {
		connect: ReturnType<typeof vi.fn>
		destroy: ReturnType<typeof vi.fn>
	}[]
}))

vi.mock('@hocuspocus/provider', () => {
	class FakeAwareness {
		private readonly listeners = new Map<string, Set<() => void>>()
		private localState: Record<string, unknown> | null = {}
		private readonly states = new Map<number, Record<string, unknown> | null>()

		on(event: string, listener: () => void) {
			let listeners = this.listeners.get(event)
			if (!listeners) {
				listeners = new Set()
				this.listeners.set(event, listeners)
			}
			listeners.add(listener)
		}

		off(event: string, listener: () => void) {
			this.listeners.get(event)?.delete(listener)
		}

		getStates() {
			return this.states
		}

		getLocalState() {
			return this.localState
		}

		setLocalState(state: Record<string, unknown> | null) {
			this.localState = state
		}

		setLocalStateField(field: string, value: unknown) {
			this.localState = { ...(this.localState ?? {}), [field]: value }
		}

		destroy() {
			this.listeners.clear()
		}
	}

	class FakeHocuspocusProviderWebsocket {
		connect = vi.fn()
		destroy = vi.fn()

		constructor() {
			providerMock.websocketInstances.push(this as never)
		}
	}

	class FakeHocuspocusProvider {
		configuration: { document: Y.Doc }
		awareness: FakeAwareness
		attach = vi.fn()
		destroy = vi.fn()

		constructor(configuration: { document: Y.Doc }) {
			this.configuration = configuration
			this.awareness = new FakeAwareness()
			providerMock.providerInstances.push(this as never)
		}
	}

	return {
		HocuspocusProvider: FakeHocuspocusProvider,
		HocuspocusProviderWebsocket: FakeHocuspocusProviderWebsocket
	}
})

async function flushProviderAndEditorEffects() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10))
	})
}

describe('EditorShell collaboration lifecycle', () => {
	beforeEach(() => {
		providerMock.providerInstances.length = 0
		providerMock.websocketInstances.length = 0
	})

	it('survives the provider-triggered editor recreation without using a destroyed editor', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return
			const detail = await boot.api.getDocBySlug(page.slug)

			const view = render(
				<SyncProvider engine={boot.engine}>
					<EditorShell
						detail={detail}
						api={boot.api}
						isPreview={false}
						userDisplayName={boot.userDisplayName}
						currentUserId={boot.currentUserId}
						pages={[page]}
						onUpdateTitle={async () => {}}
						onToggleFavorite={async () => {}}
						onExportMarkdown={async () => {}}
						onSplitPage={async () => {}}
						onStartAnchoredComment={() => {}}
						onHeadingsChange={() => {}}
					/>
				</SyncProvider>
			)

			try {
				await flushProviderAndEditorEffects()
				await flushProviderAndEditorEffects()

				expect(providerMock.providerInstances).toHaveLength(1)
				expect(providerMock.websocketInstances[0]?.connect).toHaveBeenCalled()
				expect(screen.getByLabelText(detail.page.title)).toBeInTheDocument()
				expect(view.container.querySelector('.ProseMirror')).toBeInTheDocument()
			} finally {
				view.unmount()
			}
		} finally {
			boot.engine.dispose()
		}
	})
})
