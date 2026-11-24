import { createMobileEnv } from '@huriro/env/mobile'

const env = createMobileEnv({
	EXPO_PUBLIC_API_URL: process.env['EXPO_PUBLIC_API_URL'],
	EXPO_PUBLIC_WS_URL: process.env['EXPO_PUBLIC_WS_URL']
})

export function defaultServerUrl(): string {
	return env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'
}

export function deriveWsUrl(serverUrl: string): string {
	if (env.EXPO_PUBLIC_WS_URL) return env.EXPO_PUBLIC_WS_URL
	try {
		const url = new URL(serverUrl)
		const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
		return `${proto}//${url.host}/ws`
	} catch {
		return 'ws://localhost:3005/ws'
	}
}
