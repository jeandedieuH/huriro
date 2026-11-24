import { type MessageId, t } from '@huriro/i18n'
import {
	Bell,
	Bot,
	CheckCheck,
	CreditCard,
	Download,
	GitBranch,
	type LucideIcon,
	Mail,
	Palette,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	Users,
	Webhook
} from 'lucide-react'
import type { SettingsSection } from '@/stores/ui-store'

export type SettingsGroupId = 'workspace' | 'integrations' | 'automation' | 'personal'

export interface SettingsGroupMeta {
	readonly id: SettingsGroupId
	readonly labelId: MessageId
}

export interface SettingsSectionMeta {
	readonly id: SettingsSection
	readonly group: SettingsGroupId
	readonly labelId: MessageId
	readonly descriptionId: MessageId
	readonly icon: LucideIcon
	readonly keywords: readonly string[]
	readonly cloudOnly?: boolean
}

export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
	{ id: 'workspace', labelId: 'settings.group.workspace' },
	{ id: 'integrations', labelId: 'settings.group.integrations' },
	{ id: 'automation', labelId: 'settings.group.automation' },
	{ id: 'personal', labelId: 'settings.group.personal' }
]

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
	{
		id: 'general',
		group: 'workspace',
		labelId: 'settings.sidebar.general',
		descriptionId: 'settings.desc.general',
		icon: SlidersHorizontal,
		keywords: ['workspace', 'profile', 'sync', 'replica', 'id', 'mode', 'status']
	},
	{
		id: 'members',
		group: 'workspace',
		labelId: 'settings.sidebar.members',
		descriptionId: 'settings.desc.members',
		icon: Users,
		keywords: ['members', 'roles', 'permissions', 'team', 'owner', 'admin', 'guest', 'directory']
	},
	{
		id: 'imports',
		group: 'workspace',
		labelId: 'settings.sidebar.imports',
		descriptionId: 'settings.desc.imports',
		icon: Download,
		keywords: ['import', 'linear', 'github', 'jira', 'notion', 'markdown', 'slack', 'migrate']
	},
	{
		id: 'billing',
		group: 'workspace',
		labelId: 'settings.sidebar.billing',
		descriptionId: 'settings.desc.billing',
		icon: CreditCard,
		keywords: ['billing', 'subscription', 'plan', 'polar', 'irembopay', 'momo', 'rwf', 'seats'],
		cloudOnly: true
	},
	{
		id: 'governance',
		group: 'workspace',
		labelId: 'settings.sidebar.governance',
		descriptionId: 'settings.desc.governance',
		icon: ShieldCheck,
		keywords: ['privacy', 'governance', 'export', 'gdpr', 'erase', 'delete', 'account', 'json']
	},
	{
		id: 'mail',
		group: 'integrations',
		labelId: 'nav.mail',
		descriptionId: 'settings.desc.mail',
		icon: Mail,
		keywords: ['mail', 'email', 'inbox', 'imap', 'gmail', 'graph', 'dns', 'spf', 'dkim']
	},
	{
		id: 'integrations',
		group: 'integrations',
		labelId: 'settings.sidebar.integrations',
		descriptionId: 'settings.desc.integrations',
		icon: GitBranch,
		keywords: ['github', 'repository', 'sync', 'issues', 'installation']
	},
	{
		id: 'webhooks',
		group: 'integrations',
		labelId: 'settings.sidebar.webhooks',
		descriptionId: 'settings.desc.webhooks',
		icon: Webhook,
		keywords: ['webhooks', 'hmac', 'events', 'deliveries', 'replay', 'signing']
	},
	{
		id: 'ai',
		group: 'automation',
		labelId: 'settings.sidebar.ai',
		descriptionId: 'settings.desc.ai',
		icon: Sparkles,
		keywords: ['ai', 'llm', 'openai', 'ollama', 'embedding', 'model', 'trace', 'semantic']
	},
	{
		id: 'agents',
		group: 'automation',
		labelId: 'settings.sidebar.agents',
		descriptionId: 'settings.desc.agents',
		icon: Bot,
		keywords: ['agents', 'api', 'keys', 'oauth', 'connected', 'apps', 'hrk', 'mcp', 'scopes']
	},
	{
		id: 'approvals',
		group: 'automation',
		labelId: 'settings.sidebar.approvals',
		descriptionId: 'settings.desc.approvals',
		icon: CheckCheck,
		keywords: ['approvals', 'review', 'pending', 'history', 'r2', 'deny']
	},
	{
		id: 'appearance',
		group: 'personal',
		labelId: 'settings.sidebar.appearance',
		descriptionId: 'settings.desc.appearance',
		icon: Palette,
		keywords: ['appearance', 'theme', 'dark', 'light', 'density', 'compact', 'comfortable', 'shortcuts']
	},
	{
		id: 'notifications',
		group: 'personal',
		labelId: 'settings.sidebar.notifications',
		descriptionId: 'settings.desc.notifications',
		icon: Bell,
		keywords: ['notifications', 'push', 'vapid', 'digest', 'quiet', 'timezone', 'alerts']
	}
]

const VALID_SECTIONS = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id))

export function isSettingsSection(value: unknown): value is SettingsSection {
	return typeof value === 'string' && VALID_SECTIONS.has(value)
}

export function getVisibleSettingsSections(mode: 'selfhost' | 'cloud'): readonly SettingsSectionMeta[] {
	return SETTINGS_SECTIONS.filter((section) => !section.cloudOnly || mode === 'cloud')
}

const DEFAULT_SECTION_META: SettingsSectionMeta = SETTINGS_SECTIONS[0] ?? {
	id: 'general',
	group: 'workspace',
	labelId: 'settings.sidebar.general',
	descriptionId: 'settings.desc.general',
	icon: SlidersHorizontal,
	keywords: []
}

export function getSettingsSectionMeta(id: SettingsSection): SettingsSectionMeta {
	return SETTINGS_SECTIONS.find((section) => section.id === id) ?? DEFAULT_SECTION_META
}

export function resolveActiveSettingsSection(
	section: SettingsSection,
	mode: 'selfhost' | 'cloud'
): SettingsSection {
	if (section === 'billing' && mode !== 'cloud') return 'general'
	return isSettingsSection(section) ? section : 'general'
}

export function filterSettingsSections(
	sections: readonly SettingsSectionMeta[],
	query: string
): readonly SettingsSectionMeta[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return sections
	return sections.filter((section) => {
		const label = t(section.labelId).toLowerCase()
		const description = t(section.descriptionId).toLowerCase()
		if (label.includes(needle) || description.includes(needle) || section.id.includes(needle)) {
			return true
		}
		return section.keywords.some((kw) => kw.toLowerCase().includes(needle))
	})
}
