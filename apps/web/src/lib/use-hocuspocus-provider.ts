import { HocuspocusProvider, HocuspocusProviderWebsocket, type WebSocketStatus } from '@hocuspocus/provider'
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'

export interface UseHocuspocusProviderOptions {
	readonly enabled: boolean
	readonly documentName: string
	readonly document: Y.Doc
	readonly getToken: () => Promise<string>
	readonly onStatus?: ((status: WebSocketStatus) => void) | undefined
}

interface ProviderInstance {
	readonly provider: HocuspocusProvider
	readonly documentName: string
	readonly document: Y.Doc
}

/**
 * Create a Hocuspocus provider only after React commits the component.
 *
 * Constructing the provider in `useMemo` opens a socket during render; when
 * React discards that render there is no cleanup for the socket, and status
 * callbacks can update a fiber that never mounted. Keeping creation here also
 * lets StrictMode throw away the first effect before the deferred connect fires.
 */
export function useHocuspocusProvider({
	enabled,
	documentName,
	document,
	getToken,
	onStatus
}: UseHocuspocusProviderOptions): HocuspocusProvider | null {
	const [instance, setInstance] = useState<ProviderInstance | null>(null)
	const getTokenRef = useRef(getToken)
	const onStatusRef = useRef(onStatus)

	useEffect(() => {
		getTokenRef.current = getToken
		onStatusRef.current = onStatus
	}, [getToken, onStatus])

	useEffect(() => {
		if (!enabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') return

		let cancelled = false
		let connectTimer: number | null = null
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
		const url = `${proto}//${window.location.host}/collab`
		// Hocuspocus only honours autoConnect when the websocket provider is
		// constructed explicitly; url-only provider construction always connects.
		const websocketProvider = new HocuspocusProviderWebsocket({ url, autoConnect: false })
		const provider = new HocuspocusProvider({
			name: documentName,
			document,
			websocketProvider,
			token: () => getTokenRef.current(),
			onStatus: ({ status }) => {
				if (!cancelled) onStatusRef.current?.(status)
			}
		})
		provider.attach()
		setInstance({ provider, documentName, document })

		connectTimer = window.setTimeout(() => {
			connectTimer = null
			if (!cancelled) void websocketProvider.connect()
		}, 0)

		return () => {
			cancelled = true
			if (connectTimer !== null) window.clearTimeout(connectTimer)
			provider.destroy()
			websocketProvider.destroy()
		}
	}, [document, documentName, enabled])

	if (!enabled) return null
	if (instance?.documentName !== documentName || instance.document !== document) return null
	return instance.provider
}
