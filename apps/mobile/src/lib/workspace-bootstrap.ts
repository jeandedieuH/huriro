import './crypto-polyfill'
import type { SyncSnapshotResponse } from '@huriro/contracts'
import {
	HttpSyncTransport,
	HuriroSyncEngine,
	type ReplicaStorage,
	type SqliteDatabaseLike
} from '@huriro/sync-client'
import type { AxiosRequestConfig } from 'axios'
import { useMobileAvailabilityStore } from '../stores/availability-store'
import { HuriroMobileApiClient } from './api-client'
import type { MobileAuthSession } from './auth-store'
import { deriveWsUrl } from './env'
import { createMobileReplicaStorage } from './sqlite-adapter'

export const MOBILE_PREVIEW_WS_ID = '0190a0b1-0000-7000-8000-000000000001'
export const MOBILE_PREVIEW_USER_ID = '0190a0b1-0000-7000-8000-000000000002'
export const MOBILE_PREVIEW_PROJ_ID = '0190a0b1-0000-7000-8000-000000000010'
export const MOBILE_PREVIEW_STATUS_TODO_ID = '0190a0b1-0000-7000-8000-000000000102'

export interface MobileRuntime {
	readonly engine: HuriroSyncEngine
	readonly api: HuriroMobileApiClient
	readonly storage: ReplicaStorage
	readonly isPreview: boolean
	readonly dispose: () => void
}

export function createMobilePreviewSnapshot(): SyncSnapshotResponse {
	const now = '2026-11-24T09:00:00Z'
	return {
		cursor: 1,
		serverTime: now,
		projects: [
			{
				id: MOBILE_PREVIEW_PROJ_ID,
				workspaceId: MOBILE_PREVIEW_WS_ID,
				key: 'ENG',
				name: 'Engineering',
				description: 'Huriro mobile & offline sync',
				visibility: 'workspace',
				position: 'F',
				archivedAt: null,
				createdBy: MOBILE_PREVIEW_USER_ID,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
		],
		projectStatuses: [
			{
				id: MOBILE_PREVIEW_STATUS_TODO_ID,
				workspaceId: MOBILE_PREVIEW_WS_ID,
				projectId: MOBILE_PREVIEW_PROJ_ID,
				name: 'Todo',
				category: 'unstarted',
				color: 'info',
				position: 'F',
				isDefault: true,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
		],
		labels: [],
		cycles: [],
		issues: [
			{
				id: '0190a0b1-0000-7000-8000-000000000201',
				workspaceId: MOBILE_PREVIEW_WS_ID,
				projectId: MOBILE_PREVIEW_PROJ_ID,
				projectKey: 'ENG',
				number: 1,
				identifier: 'ENG-1',
				parentId: null,
				cycleId: null,
				title: 'Verify Expo SQLite offline outbox queue',
				description: null,
				descriptionText: 'Create a task offline and flush once back online.',
				statusId: MOBILE_PREVIEW_STATUS_TODO_ID,
				priority: 2,
				assigneeType: 'user',
				assigneeId: MOBILE_PREVIEW_USER_ID,
				creatorId: MOBILE_PREVIEW_USER_ID,
				position: 'F',
				startDate: null,
				dueDate: null,
				estimate: 2,
				closedAt: null,
				labelIds: [],
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
				version: 1
			}
		],
		savedViews: [],
		notifications: [
			{
				id: '0190a0b1-0000-7000-8000-000000000401',
				workspaceId: MOBILE_PREVIEW_WS_ID,
				userId: MOBILE_PREVIEW_USER_ID,
				kind: 'assigned',
				entityType: 'issue',
				entityId: '0190a0b1-0000-7000-8000-000000000201',
				actorId: MOBILE_PREVIEW_USER_ID,
				title: 'Assigned ENG-1',
				body: 'Verify Expo SQLite offline outbox queue',
				readAt: null,
				archivedAt: null,
				createdAt: now
			}
		],
		docPages: [
			{
				id: '0190a0b1-0000-7000-8000-000000000301',
				workspaceId: MOBILE_PREVIEW_WS_ID,
				parentId: null,
				path: '0190a0b1000070008000000000000301',
				depth: 0,
				slug: 'engineering-handbook',
				title: 'Engineering Handbook',
				icon: '📘',
				visibility: 'workspace',
				position: 'F',
				isTemplate: false,
				isFavorite: true,
				byteSize: 256,
				createdBy: MOBILE_PREVIEW_USER_ID,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
		]
	}
}

export async function bootstrapMobileRuntime(args: {
	readonly session?: MobileAuthSession | null | undefined
	readonly preview?: boolean | undefined
	readonly sqliteDb?: SqliteDatabaseLike | undefined
	readonly platform?: 'ios' | 'android' | 'web' | undefined
	/** Test seam — custom axios adapter routed into both api client and sync transport. */
	readonly httpAdapter?: AxiosRequestConfig['adapter'] | undefined
}): Promise<MobileRuntime> {
	const workspaceId = args.session?.workspaceId ?? MOBILE_PREVIEW_WS_ID
	const userId = args.session?.userId ?? MOBILE_PREVIEW_USER_ID
	const storage = await createMobileReplicaStorage(workspaceId, args.sqliteDb)

	if (args.preview || !args.session) {
		await storage.set('huriro:replica:v1', JSON.stringify(createMobilePreviewSnapshot()))
		const engine = new HuriroSyncEngine({
			workspaceId,
			currentUserId: userId,
			storage,
			onPresence: (users) => useMobileAvailabilityStore.getState().setPresence(users)
		})
		await engine.bootstrap({ skipNetwork: true })
		const api = new HuriroMobileApiClient({
			serverUrl: 'http://localhost:3001',
			workspaceId,
			platform: args.platform,
			getToken: () => null,
			httpAdapter: args.httpAdapter
		})
		return { engine, api, storage, isPreview: true, dispose: () => engine.dispose() }
	}

	const session = args.session
	const transport = new HttpSyncTransport({
		baseUrl: session.serverUrl,
		workspaceId: session.workspaceId,
		clientName: 'huriro-mobile',
		credentials: 'omit',
		getHeaders: () => ({
			authorization: `Bearer ${session.token}`,
			'x-huriro-platform': args.platform ?? 'ios'
		}),
		httpAdapter: args.httpAdapter
	})

	const engine = new HuriroSyncEngine({
		workspaceId: session.workspaceId,
		currentUserId: session.userId,
		storage,
		transport,
		wsUrl: deriveWsUrl(session.serverUrl),
		useRealtimeTicket: true,
		onPresence: (users) => useMobileAvailabilityStore.getState().setPresence(users)
	})
	await engine.bootstrap()

	const api = new HuriroMobileApiClient({
		serverUrl: session.serverUrl,
		workspaceId: session.workspaceId,
		platform: args.platform,
		getToken: () => session.token,
		httpAdapter: args.httpAdapter
	})

	return {
		engine,
		api,
		storage,
		isPreview: false,
		dispose: () => engine.dispose()
	}
}
