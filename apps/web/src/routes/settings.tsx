import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SettingsWorkspace } from '@/features/settings/components/settings-workspace'
import { isSettingsSection, resolveActiveSettingsSection } from '@/features/settings/settings-sections'
import { useWorkspace } from '@/lib/workspace'
import { type SettingsSection, useUiStore } from '@/stores/ui-store'

export interface SettingsSearchParams {
	readonly section?: SettingsSection | undefined
	readonly billing?: 'success' | 'cancel' | undefined
}

export const Route = createFileRoute('/settings')({
	validateSearch: (search: Record<string, unknown>): SettingsSearchParams => ({
		...(isSettingsSection(search['section']) ? { section: search['section'] } : {}),
		...(search['billing'] === 'success' || search['billing'] === 'cancel'
			? { billing: search['billing'] }
			: {})
	}),
	component: SettingsRoute
})

function SettingsRoute() {
	const search = Route.useSearch()
	const navigate = useNavigate({ from: '/settings' })
	const { mode } = useWorkspace()
	const settingsSection = useUiStore((s) => s.settingsSection)

	useEffect(() => {
		if (search.section) {
			const resolved = resolveActiveSettingsSection(search.section, mode)
			if (useUiStore.getState().settingsSection !== resolved) {
				useUiStore.setState({ settingsSection: resolved })
			}
		} else if (search.billing && mode === 'cloud') {
			if (useUiStore.getState().settingsSection !== 'billing') {
				useUiStore.setState({ settingsSection: 'billing' })
			}
		}
	}, [mode, search.billing, search.section])

	const activeSection = resolveActiveSettingsSection(settingsSection, mode)

	return (
		<SettingsWorkspace
			billingStatus={search.billing}
			onDismissBillingStatus={() =>
				void navigate({
					to: '/settings',
					search: { section: activeSection },
					replace: true
				})
			}
		/>
	)
}
