export interface SecureKvStore {
	getItemAsync(key: string): Promise<string | null>
	setItemAsync(key: string, value: string): Promise<void>
	deleteItemAsync(key: string): Promise<void>
}

export interface MobileAuthSession {
	readonly serverUrl: string
	readonly token: string
	readonly workspaceId: string
	readonly userId: string
	readonly email: string
	readonly displayName: string
}

const SESSION_KEY = 'huriro_mobile_session_v1'

export function createMemorySecureKvStore(): SecureKvStore {
	const map = new Map<string, string>()
	return {
		async getItemAsync(key) {
			return map.get(key) ?? null
		},
		async setItemAsync(key, value) {
			map.set(key, value)
		},
		async deleteItemAsync(key) {
			map.delete(key)
		}
	}
}

async function resolveDefaultSecureKvStore(): Promise<SecureKvStore> {
	try {
		const mod = await import('expo-secure-store')
		if (
			typeof mod.getItemAsync === 'function' &&
			typeof mod.setItemAsync === 'function' &&
			typeof mod.deleteItemAsync === 'function'
		) {
			return {
				getItemAsync: (k) => mod.getItemAsync(k),
				setItemAsync: (k, v) => mod.setItemAsync(k, v),
				deleteItemAsync: (k) => mod.deleteItemAsync(k)
			}
		}
	} catch {
		// Fall back in pure Bun tests where native SecureStore module is unavailable.
	}
	return createMemorySecureKvStore()
}

export class MobileAuthStore {
	private storePromise: Promise<SecureKvStore> | null = null

	constructor(storeOverride?: SecureKvStore) {
		if (storeOverride) {
			this.storePromise = Promise.resolve(storeOverride)
		}
	}

	private getStore(): Promise<SecureKvStore> {
		if (!this.storePromise) {
			this.storePromise = resolveDefaultSecureKvStore()
		}
		return this.storePromise
	}

	async loadSession(): Promise<MobileAuthSession | null> {
		const store = await this.getStore()
		const raw = await store.getItemAsync(SESSION_KEY)
		if (!raw) return null
		try {
			const parsed = JSON.parse(raw) as Partial<MobileAuthSession>
			if (
				typeof parsed.serverUrl !== 'string' ||
				typeof parsed.token !== 'string' ||
				typeof parsed.workspaceId !== 'string' ||
				typeof parsed.userId !== 'string'
			) {
				return null
			}
			return {
				serverUrl: parsed.serverUrl,
				token: parsed.token,
				workspaceId: parsed.workspaceId,
				userId: parsed.userId,
				email: typeof parsed.email === 'string' ? parsed.email : '',
				displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'User'
			}
		} catch {
			return null
		}
	}

	async saveSession(session: MobileAuthSession): Promise<void> {
		const store = await this.getStore()
		await store.setItemAsync(SESSION_KEY, JSON.stringify(session))
	}

	async clearSession(): Promise<void> {
		const store = await this.getStore()
		await store.deleteItemAsync(SESSION_KEY)
	}
}
