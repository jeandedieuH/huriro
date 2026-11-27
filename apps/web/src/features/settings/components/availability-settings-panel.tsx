import type {
	AvailabilityWindowDto,
	CreateAvailabilityWindowBody,
	UpdateAvailabilityWindowBody,
	UpdateMyAvailabilityBody,
	UserAvailabilityDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspaceAvailability } from '@/features/availability'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { useWorkspace } from '@/lib/workspace'
import { AvailabilityStatusCard } from './availability/availability-status-card'
import { AvailabilityWindowsCard } from './availability/availability-windows-card'
import { AvailabilityWorkingHoursCard } from './availability/availability-working-hours-card'
import { SettingsNotice, SettingsSkeleton } from './settings-primitives'

/** Settings > Personal > Availability panel backed by both local replica and direct REST API. */
export function AvailabilitySettingsPanel() {
	const { api, engine } = useWorkspace()
	const { myAvailability, hydrationError, refreshMyAvailability, updateMyAvailability } =
		useWorkspaceAvailability()
	const [loadedProfile, setLoadedProfile] = useState<UserAvailabilityDto | null>(null)
	const [windows, setWindows] = useState<AvailabilityWindowDto[] | null>(null)
	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)

	const loadAll = useCallback(async () => {
		setLoading(true)
		setLoadError(null)
		try {
			const [profile, windowRows, memberRows] = await Promise.all([
				api.getMyAvailability(),
				api.listAvailabilityWindows(),
				api.listMembers().catch(() => [])
			])
			await engine.syncUserAvailabilityRow(profile)
			setLoadedProfile(profile)
			setWindows(windowRows)
			setMembers(memberRows)
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : t('availability.settings.load-error'))
		} finally {
			setLoading(false)
		}
	}, [api, engine])

	useEffect(() => {
		void loadAll()
	}, [loadAll])

	const effectiveProfile = myAvailability ?? loadedProfile

	const handleSaveProfile = useCallback(
		async (patch: UpdateMyAvailabilityBody) => {
			const saved = await updateMyAvailability(patch)
			if (saved) setLoadedProfile(saved)
		},
		[updateMyAvailability]
	)

	const syncAfterWindowChange = useCallback(async () => {
		const [windowRows, profile] = await Promise.all([api.listAvailabilityWindows(), refreshMyAvailability()])
		setWindows(windowRows)
		if (profile) setLoadedProfile(profile)
	}, [api, refreshMyAvailability])

	const handleCreateWindow = useCallback(
		async (body: CreateAvailabilityWindowBody) => {
			const created = await api.createAvailabilityWindow(body)
			await syncAfterWindowChange()
			return created
		},
		[api, syncAfterWindowChange]
	)

	const handleUpdateWindow = useCallback(
		async (id: string, body: UpdateAvailabilityWindowBody) => {
			const updated = await api.updateAvailabilityWindow(id, body)
			await syncAfterWindowChange()
			return updated
		},
		[api, syncAfterWindowChange]
	)

	const handleDeleteWindow = useCallback(
		async (id: string) => {
			await api.deleteAvailabilityWindow(id)
			await syncAfterWindowChange()
		},
		[api, syncAfterWindowChange]
	)

	const activeError = loadError ?? (!effectiveProfile ? hydrationError : null)

	if (!effectiveProfile && loading) {
		return <SettingsSkeleton rows={4} />
	}

	if (!effectiveProfile) {
		return (
			<SettingsNotice
				tone="danger"
				title={t('availability.settings.load-error')}
				action={
					<Button type="button" tone="outline" size="sm" onClick={() => void loadAll()}>
						Retry
					</Button>
				}
			>
				{activeError ?? t('availability.settings.load-error')}
			</SettingsNotice>
		)
	}

	const displayWindows = windows ?? effectiveProfile.windows

	return (
		<div className="space-y-6">
			{activeError ? (
				<SettingsNotice
					tone="warning"
					action={
						<Button type="button" tone="outline" size="sm" onClick={() => void loadAll()}>
							Retry
						</Button>
					}
				>
					{activeError}
				</SettingsNotice>
			) : null}

			<AvailabilityStatusCard profile={effectiveProfile} onSave={handleSaveProfile} />
			<AvailabilityWorkingHoursCard profile={effectiveProfile} onSave={handleSaveProfile} />
			<AvailabilityWindowsCard
				profile={effectiveProfile}
				windows={displayWindows}
				members={members}
				onCreateWindow={handleCreateWindow}
				onUpdateWindow={handleUpdateWindow}
				onDeleteWindow={handleDeleteWindow}
			/>
		</div>
	)
}
