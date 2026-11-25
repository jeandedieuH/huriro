import { type Action, SYSTEM_ROLES, type SystemRoleKey } from '@huriro/domain'
import { type MessageId, t } from '@huriro/i18n'
import { Check, Minus, Search, Shield, UserPlus, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice,
	SettingsSkeleton
} from './settings-primitives'

const ROLE_BADGE_TONES: Record<string, 'default' | 'info' | 'secondary' | 'outline'> = {
	owner: 'default',
	admin: 'info',
	member: 'secondary',
	guest: 'outline'
}

const ROLE_LABEL_IDS: Record<SystemRoleKey, MessageId> = {
	owner: 'settings.members.role.owner',
	admin: 'settings.members.role.admin',
	member: 'settings.members.role.member',
	guest: 'settings.members.role.guest'
}

interface CapabilityRow {
	readonly id: string
	readonly labelId: MessageId
	readonly actions: readonly Action[]
}

const CAPABILITY_ROWS: readonly CapabilityRow[] = [
	{
		id: 'workspace',
		labelId: 'settings.members.cap.workspace',
		actions: ['workspace.manage', 'settings.manage']
	},
	{ id: 'billing', labelId: 'settings.members.cap.billing', actions: ['workspace.billing'] },
	{
		id: 'members',
		labelId: 'settings.members.cap.members',
		actions: ['member.invite', 'member.manage', 'role.manage']
	},
	{
		id: 'work',
		labelId: 'settings.members.cap.work',
		actions: ['project.write', 'issue.write', 'doc.write']
	},
	{ id: 'comms', labelId: 'settings.members.cap.comms', actions: ['channel.post', 'mail.send'] },
	{
		id: 'agents',
		labelId: 'settings.members.cap.agents',
		actions: ['agent.manage', 'approval.decide', 'ai.manage']
	}
]

function getInitials(name: string): string {
	const parts = name
		.replace(/\s*\(.*?\)\s*/g, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
	if (parts.length >= 2) {
		return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
	}
	return (parts[0] ?? 'U').slice(0, 2).toUpperCase()
}

function getRoleLabel(role: string): string {
	if (role in ROLE_LABEL_IDS) {
		return t(ROLE_LABEL_IDS[role as SystemRoleKey])
	}
	return role
}

export function MembersSettingsPanel() {
	const { api, currentUserId } = useWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)

	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [query, setQuery] = useState('')
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [inviteEmail, setInviteEmail] = useState('')
	const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'guest'>('member')
	const [inviting, setInviting] = useState(false)
	const [inviteNotice, setInviteNotice] = useState<{
		readonly tone: 'success' | 'info' | 'warning' | 'danger'
		readonly message: string
	} | null>(null)

	async function handleInvite(ev: React.FormEvent) {
		ev.preventDefault()
		const cleanEmail = inviteEmail.trim()
		if (!cleanEmail || inviting) return
		setInviting(true)
		setInviteNotice(null)
		try {
			const res = await api.createInvitation({ email: cleanEmail, role: inviteRole })
			// The server distinguishes a missing provider from a failed delivery —
			// surface each honestly: a failure reads as a warning (the invite itself
			// was created), not as the neutral "share manually" info state.
			const outcome = {
				sent: {
					noticeTone: 'success' as const,
					toastTone: 'success' as const,
					message: t('settings.members.invite-sent-email', { email: cleanEmail, provider: res.emailProvider })
				},
				not_configured: {
					noticeTone: 'info' as const,
					toastTone: 'default' as const,
					message: t('settings.members.invite-sent-manual', { email: cleanEmail, token: res.token })
				},
				failed: {
					noticeTone: 'warning' as const,
					toastTone: 'warning' as const,
					message: t('settings.members.invite-sent-failed', {
						email: cleanEmail,
						provider: res.emailProvider,
						token: res.token
					})
				}
			}[res.emailStatus]
			setInviteNotice({ tone: outcome.noticeTone, message: outcome.message })
			setInviteEmail('')
			pushToast({
				tone: outcome.toastTone,
				title: res.emailStatus === 'not_configured' ? t('settings.members.invite-title') : outcome.message
			})
		} catch (err) {
			setInviteNotice({
				tone: 'danger',
				message: err instanceof Error ? err.message : t('settings.members.invite-error')
			})
		} finally {
			setInviting(false)
		}
	}

	const loadMembers = useCallback(() => {
		setLoading(true)
		setError(null)
		void api
			.listMembers()
			.then((rows) => {
				setMembers(rows)
				setLoading(false)
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : t('settings.members.error'))
				setLoading(false)
			})
	}, [api])

	useEffect(() => {
		loadMembers()
	}, [loadMembers])

	const filteredMembers = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (!needle) return members
		return members.filter(
			(member) =>
				member.displayName.toLowerCase().includes(needle) ||
				member.email.toLowerCase().includes(needle) ||
				member.role.toLowerCase().includes(needle)
		)
	}, [members, query])

	return (
		<div className="space-y-5">
			{loading ? (
				<SettingsSkeleton rows={3} />
			) : (
				<SettingsCard labelledBy="members-directory-heading">
					<SettingsCardHeader
						headingId="members-directory-heading"
						icon={<Users className="size-4" />}
						title={t('settings.members.directory-title')}
						description={t('settings.members.directory-desc')}
						badge={
							<Badge tone="secondary" className="tnum">
								{t('settings.members.count', { count: members.length })}
							</Badge>
						}
					/>
					<SettingsCardBody>
						{error ? (
							<SettingsNotice
								tone="danger"
								action={
									<Button type="button" size="sm" tone="outline" onClick={loadMembers}>
										{t('error.retry')}
									</Button>
								}
							>
								{error}
							</SettingsNotice>
						) : (
							<>
								<div className="relative">
									<Search
										className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
										aria-hidden
									/>
									<Input
										value={query}
										onChange={(ev) => setQuery(ev.target.value)}
										placeholder={t('settings.members.search-placeholder')}
										aria-label={t('settings.members.search-placeholder')}
										className="pl-9"
									/>
								</div>

								{filteredMembers.length === 0 ? (
									<SettingsEmptyState
										icon={<Users className="size-4" />}
										message={t('settings.members.search-empty')}
										action={
											query ? (
												<Button type="button" size="sm" tone="outline" onClick={() => setQuery('')}>
													{t('settings.search.clear')}
												</Button>
											) : undefined
										}
									/>
								) : (
									<ul className="divide-y divide-border rounded-lg border border-border bg-surface-2/30">
										{filteredMembers.map((member) => {
											const isSelf = member.userId === currentUserId
											const tone = ROLE_BADGE_TONES[member.role] ?? 'outline'
											return (
												<li
													key={member.userId}
													className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
												>
													<div className="flex min-w-0 items-center gap-3">
														<Avatar className="size-9 border border-border">
															<AvatarFallback>{getInitials(member.displayName)}</AvatarFallback>
														</Avatar>
														<div className="min-w-0">
															<div className="flex flex-wrap items-center gap-2">
																<span className="truncate text-sm font-medium text-foreground">
																	{member.displayName}
																</span>
																{isSelf ? <Badge tone="outline">{t('settings.members.you')}</Badge> : null}
															</div>
															<p className="truncate font-mono text-xs text-muted-foreground">
																{member.email}
															</p>
														</div>
													</div>
													<Badge tone={tone}>{getRoleLabel(member.role)}</Badge>
												</li>
											)
										})}
									</ul>
								)}
							</>
						)}
					</SettingsCardBody>
				</SettingsCard>
			)}

			<SettingsCard labelledBy="members-invite-heading">
				<SettingsCardHeader
					headingId="members-invite-heading"
					icon={<UserPlus className="size-4" />}
					title={t('settings.members.invite-title')}
					description={t('settings.members.invite-desc')}
				/>
				<SettingsCardBody>
					<form
						onSubmit={(ev) => void handleInvite(ev)}
						className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end"
					>
						<div className="space-y-1.5">
							<label htmlFor="members-invite-email" className="block text-xs font-medium text-foreground">
								{t('settings.members.invite-email')}
							</label>
							<Input
								id="members-invite-email"
								type="email"
								required
								value={inviteEmail}
								onChange={(ev) => setInviteEmail(ev.target.value)}
								placeholder={t('settings.members.invite-email-placeholder')}
							/>
						</div>
						<div className="space-y-1.5">
							<span id="members-invite-role-label" className="block text-xs font-medium text-foreground">
								{t('settings.members.invite-role')}
							</span>
							<Select
								value={inviteRole}
								onValueChange={(v) => setInviteRole(v as 'admin' | 'member' | 'guest')}
							>
								<SelectTrigger
									id="members-invite-role"
									aria-labelledby="members-invite-role-label"
									aria-label={t('settings.members.invite-role')}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="member">{t('settings.members.role.member')}</SelectItem>
									<SelectItem value="admin">{t('settings.members.role.admin')}</SelectItem>
									<SelectItem value="guest">{t('settings.members.role.guest')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button type="submit" size="sm" loading={inviting} disabled={!inviteEmail.trim()}>
							<UserPlus className="size-3.5" aria-hidden />
							<span>
								{inviting ? t('settings.members.invite-submitting') : t('settings.members.invite-submit')}
							</span>
						</Button>
					</form>
					{inviteNotice ? (
						<SettingsNotice tone={inviteNotice.tone}>{inviteNotice.message}</SettingsNotice>
					) : null}
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="members-roles-heading">
				<SettingsCardHeader
					headingId="members-roles-heading"
					icon={<Shield className="size-4" />}
					title={t('settings.members.roles-title')}
					description={t('settings.members.roles-desc')}
				/>
				<SettingsCardBody>
					<div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
						{SYSTEM_ROLES.map((role) => (
							<div
								key={role.key}
								className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface-2/40 p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-semibold text-foreground">{getRoleLabel(role.key)}</span>
									<Badge tone={ROLE_BADGE_TONES[role.key] ?? 'outline'}>{role.key}</Badge>
								</div>
								<p className="text-xs text-muted-foreground tnum">
									{role.permissions.length === 0
										? t('settings.members.role-guest-note')
										: t('settings.members.role-permissions-count', { count: role.permissions.length })}
								</p>
							</div>
						))}
					</div>

					<div className="overflow-x-auto rounded-lg border border-border">
						<table className="w-full border-collapse text-left text-xs">
							<thead>
								<tr className="border-b border-border bg-surface-2/70">
									<th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
										{t('settings.members.roles-title')}
									</th>
									{SYSTEM_ROLES.map((role) => (
										<th
											key={role.key}
											scope="col"
											className="px-3 py-2.5 text-center font-semibold text-foreground"
										>
											{getRoleLabel(role.key)}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{CAPABILITY_ROWS.map((row) => (
									<tr key={row.id} className="hover:bg-surface-2/30">
										<th scope="row" className="px-3.5 py-2.5 font-medium text-foreground">
											{t(row.labelId)}
										</th>
										{SYSTEM_ROLES.map((role) => {
											const allowed = row.actions.some((action) => role.permissions.includes(action))
											return (
												<td key={role.key} className="px-3 py-2.5 text-center">
													<span
														className="inline-flex items-center justify-center gap-1"
														title={
															allowed
																? t('settings.members.cap.allowed')
																: t('settings.members.cap.restricted')
														}
													>
														{allowed ? (
															<>
																<Check className="size-3.5 text-(--success)" aria-hidden />
																<span className="sr-only">{t('settings.members.cap.allowed')}</span>
															</>
														) : (
															<>
																<Minus className="size-3.5 text-muted-foreground/60" aria-hidden />
																<span className="sr-only">{t('settings.members.cap.restricted')}</span>
															</>
														)}
													</span>
												</td>
											)
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
