import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { useHocuspocusProvider } from './use-hocuspocus-provider'

const providerMock = vi.hoisted(() => ({
	providerInstances: [] as {
		configuration: { name: string; document: Y.Doc; websocketProvider: unknown }
		attach: ReturnType<typeof vi.fn>
		destroy: ReturnType<typeof vi.fn>
	}[],
	websocketInstances: [] as {
		configuration: { url: string; autoConnect: boolean }
		connect: ReturnType<typeof vi.fn>
		destroy: ReturnType<typeof vi.fn>
	}[]
}))

vi.mock('@hocuspocus/provider', () => {
	class FakeHocuspocusProviderWebsocket {
		configuration: { url: string; autoConnect: boolean }
		connect = vi.fn()
		destroy = vi.fn()

		constructor(configuration: { url: string; autoConnect: boolean }) {
			this.configuration = configuration
			providerMock.websocketInstances.push(this as never)
		}
	}

	class FakeHocuspocusProvider {
		configuration: { name: string; document: Y.Doc; websocketProvider: unknown }
		attach = vi.fn()
		destroy = vi.fn()

		constructor(configuration: { name: string; document: Y.Doc; websocketProvider: unknown }) {
			this.configuration = configuration
			providerMock.providerInstances.push(this as never)
		}
	}

	return {
		HocuspocusProvider: FakeHocuspocusProvider,
		HocuspocusProviderWebsocket: FakeHocuspocusProviderWebsocket
	}
})

function Probe(props: {
	readonly documentName: string
	readonly document: Y.Doc
	readonly renders: unknown[]
	readonly enabled?: boolean
}) {
	const provider = useHocuspocusProvider({
		enabled: props.enabled ?? true,
		documentName: props.documentName,
		document: props.document,
		getToken: async () => 'ticket'
	})
	props.renders.push(provider)
	return null
}

async function flushConnectTimer() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 5))
	})
}

describe('useHocuspocusProvider', () => {
	beforeEach(() => {
		providerMock.providerInstances.length = 0
		providerMock.websocketInstances.length = 0
	})

	it('creates the provider after the first committed render and owns cleanup', async () => {
		const ydoc = new Y.Doc()
		const renders: unknown[] = []
		const view = render(<Probe documentName="ws:doc" document={ydoc} renders={renders} />)

		expect(renders[0]).toBeNull()
		expect(providerMock.providerInstances).toHaveLength(1)
		expect(providerMock.websocketInstances).toHaveLength(1)
		expect(providerMock.websocketInstances[0]?.configuration.autoConnect).toBe(false)
		expect(providerMock.providerInstances[0]?.configuration.document).toBe(ydoc)
		expect(providerMock.providerInstances[0]?.attach).toHaveBeenCalledTimes(1)
		expect(renders.at(-1)).toBe(providerMock.providerInstances[0])

		await flushConnectTimer()
		expect(providerMock.websocketInstances[0]?.connect).toHaveBeenCalledTimes(1)

		view.unmount()
		expect(providerMock.providerInstances[0]?.destroy).toHaveBeenCalledTimes(1)
		expect(providerMock.websocketInstances[0]?.destroy).toHaveBeenCalledTimes(1)
		ydoc.destroy()
	})

	it('does not let a StrictMode-discarded provider open a socket', async () => {
		const ydoc = new Y.Doc()
		const renders: unknown[] = []
		const view = render(
			<StrictMode>
				<Probe documentName="ws:doc" document={ydoc} renders={renders} />
			</StrictMode>
		)

		await flushConnectTimer()
		expect(providerMock.websocketInstances.length).toBeGreaterThanOrEqual(2)
		const [discarded, active] = providerMock.websocketInstances
		expect(providerMock.providerInstances[0]?.destroy).toHaveBeenCalled()
		expect(discarded?.connect).not.toHaveBeenCalled()
		expect(discarded?.destroy).toHaveBeenCalled()
		expect(active?.connect).toHaveBeenCalledTimes(1)

		view.unmount()
		ydoc.destroy()
	})

	it('replaces the provider when the bound Y.Doc changes', async () => {
		const firstDoc = new Y.Doc()
		const secondDoc = new Y.Doc()
		const renders: unknown[] = []
		const view = render(<Probe documentName="ws:doc" document={firstDoc} renders={renders} />)
		await flushConnectTimer()

		view.rerender(<Probe documentName="ws:doc" document={secondDoc} renders={renders} />)
		await flushConnectTimer()

		expect(providerMock.providerInstances).toHaveLength(2)
		expect(providerMock.providerInstances[0]?.destroy).toHaveBeenCalledTimes(1)
		expect(providerMock.providerInstances[1]?.configuration.document).toBe(secondDoc)
		expect(providerMock.websocketInstances[1]?.connect).toHaveBeenCalledTimes(1)

		view.unmount()
		firstDoc.destroy()
		secondDoc.destroy()
	})
})
