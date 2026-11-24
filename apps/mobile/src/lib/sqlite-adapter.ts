import {
	MemoryReplicaStorage,
	type ReplicaStorage,
	type SqliteDatabaseLike,
	SqliteReplicaStorage
} from '@huriro/sync-client'

export async function createMobileReplicaStorage(
	workspaceId: string,
	dbOverride?: SqliteDatabaseLike
): Promise<ReplicaStorage> {
	if (dbOverride) {
		return new SqliteReplicaStorage(dbOverride, workspaceId)
	}
	try {
		const sqliteMod = await import('expo-sqlite')
		if (typeof sqliteMod.openDatabaseAsync === 'function') {
			const db = await sqliteMod.openDatabaseAsync('huriro_replica_v1.db')
			return new SqliteReplicaStorage(
				{
					execAsync: (source) => db.execAsync(source),
					getFirstAsync: (source, ...params) =>
						db.getFirstAsync(source, ...(params as (string | number | null | Uint8Array)[])),
					getAllAsync: (source, ...params) =>
						db.getAllAsync(source, ...(params as (string | number | null | Uint8Array)[])),
					runAsync: (source, ...params) =>
						db.runAsync(source, ...(params as (string | number | null | Uint8Array)[]))
				},
				workspaceId
			)
		}
	} catch {
		// Fall back cleanly when running outside native Expo runtime (e.g. unit tests).
	}
	return new MemoryReplicaStorage()
}
