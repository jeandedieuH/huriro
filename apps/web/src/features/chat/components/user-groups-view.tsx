import type { CreateUserGroupBody, UserGroupDto, WorkspaceEmojiDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'

export interface UserGroupsViewProps {
	readonly userGroups: readonly UserGroupDto[]
	readonly workspaceEmojis: readonly WorkspaceEmojiDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly onCreateGroup: (body: CreateUserGroupBody) => Promise<void> | void
	readonly onSetGroupMembers: (groupId: string, memberIds: readonly string[]) => Promise<void> | void
	readonly onCreateEmoji: (shortcode: string, file: File) => Promise<void> | void
	readonly onDeleteEmoji: (id: string) => Promise<void> | void
}

function normalizeHandle(raw: string): string {
	return raw
		.trim()
		.replace(/^@/, '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 64)
}

function normalizeShortcode(raw: string): string {
	return raw
		.trim()
		.replace(/^:+|:+$/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9_+-]/g, '')
		.slice(0, 64)
}

/** Workspace view for managing @usergroups and custom :emojis:. */
export function UserGroupsView({
	userGroups,
	workspaceEmojis,
	members,
	onCreateGroup,
	onSetGroupMembers,
	onCreateEmoji,
	onDeleteEmoji
}: UserGroupsViewProps) {
	const [tab, setTab] = useState<'groups' | 'emojis'>('groups')
	const [handleInput, setHandleInput] = useState('')
	const [nameInput, setNameInput] = useState('')
	const [groupBusy, setGroupBusy] = useState(false)

	const [shortcodeInput, setShortcodeInput] = useState('')
	const [emojiFile, setEmojiFile] = useState<File | null>(null)
	const [emojiBusy, setEmojiBusy] = useState(false)
	const fileInputRef = useRef<HTMLInputElement | null>(null)

	const cleanHandle = normalizeHandle(handleInput)
	const canCreateGroup = cleanHandle.length >= 2 && nameInput.trim().length > 0 && !groupBusy

	const cleanShortcode = normalizeShortcode(shortcodeInput)
	const canCreateEmoji = cleanShortcode.length >= 1 && emojiFile !== null && !emojiBusy

	async function handleCreateGroup(ev: React.FormEvent) {
		ev.preventDefault()
		if (!canCreateGroup) return
		setGroupBusy(true)
		try {
			await onCreateGroup({
				handle: cleanHandle,
				name: nameInput.trim()
			})
			setHandleInput('')
			setNameInput('')
		} finally {
			setGroupBusy(false)
		}
	}

	async function handleCreateEmoji(ev: React.FormEvent) {
		ev.preventDefault()
		if (!canCreateEmoji || !emojiFile) return
		setEmojiBusy(true)
		try {
			await onCreateEmoji(cleanShortcode, emojiFile)
			setShortcodeInput('')
			setEmojiFile(null)
			if (fileInputRef.current) fileInputRef.current.value = ''
		} finally {
			setEmojiBusy(false)
		}
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto w-full max-w-3xl space-y-4">
				<h1 className="text-lg font-semibold text-foreground">{t('chat.groups.title')}</h1>

				<Tabs value={tab} onValueChange={(v) => setTab(v as 'groups' | 'emojis')}>
					<TabsList>
						<TabsTrigger value="groups">{t('chat.groups.tab-groups')}</TabsTrigger>
						<TabsTrigger value="emojis">{t('chat.groups.tab-emojis')}</TabsTrigger>
					</TabsList>

					<TabsContent value="groups" className="space-y-4">
						<form
							onSubmit={(ev) => void handleCreateGroup(ev)}
							className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
						>
							<Input
								value={handleInput}
								onChange={(ev) => setHandleInput(ev.target.value)}
								placeholder={t('chat.groups.handle')}
								aria-label={t('chat.groups.handle')}
								className="w-40"
								maxLength={64}
							/>
							<Input
								value={nameInput}
								onChange={(ev) => setNameInput(ev.target.value)}
								placeholder={t('chat.groups.name')}
								aria-label={t('chat.groups.name')}
								className="min-w-44 flex-1"
								maxLength={120}
							/>
							<Button size="sm" type="submit" loading={groupBusy} disabled={!canCreateGroup}>
								<Plus className="size-3.5" aria-hidden />
								<span>{t('chat.groups.create')}</span>
							</Button>
						</form>

						{userGroups.length === 0 ? (
							<EmptyState title={t('chat.groups.empty')} />
						) : (
							<div className="space-y-3">
								{userGroups.map((group) => {
									const memberSet = new Set(group.memberIds)
									return (
										<div key={group.id} className="space-y-2.5 rounded-lg border border-border bg-card p-3.5">
											<div className="flex items-center justify-between gap-2">
												<div className="flex items-center gap-2">
													<Badge tone="secondary">@{group.handle}</Badge>
													<span className="text-sm font-semibold text-foreground">{group.name}</span>
												</div>
												<span className="text-xs text-muted-foreground tnum">
													{t('chat.groups.members')}: {group.memberIds.length}
												</span>
											</div>

											{members.length > 0 ? (
												<div className="flex flex-wrap gap-3 border-t border-border/60 pt-2">
													{members.map((m) => {
														const checked = memberSet.has(m.userId)
														const memberCheckboxId = `group-${group.id}-member-${m.userId}`
														return (
															<div key={m.userId} className="inline-flex items-center gap-1.5">
																<Checkbox
																	id={memberCheckboxId}
																	checked={checked}
																	onCheckedChange={(v) => {
																		const next = new Set(memberSet)
																		if (v === true) next.add(m.userId)
																		else next.delete(m.userId)
																		void onSetGroupMembers(group.id, [...next])
																	}}
																/>
																<label
																	htmlFor={memberCheckboxId}
																	className="cursor-pointer text-xs text-foreground"
																>
																	{m.displayName || m.email}
																</label>
															</div>
														)
													})}
												</div>
											) : null}
										</div>
									)
								})}
							</div>
						)}
					</TabsContent>

					<TabsContent value="emojis" className="space-y-4">
						<form
							onSubmit={(ev) => void handleCreateEmoji(ev)}
							className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
						>
							<Input
								value={shortcodeInput}
								onChange={(ev) => setShortcodeInput(ev.target.value)}
								placeholder={t('chat.emojis.shortcode')}
								aria-label={t('chat.emojis.shortcode')}
								className="w-44"
								maxLength={64}
							/>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								aria-label={t('chat.emojis.upload')}
								onChange={(ev) => setEmojiFile(ev.target.files?.[0] ?? null)}
								className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1 file:text-xs file:font-medium"
							/>
							<Button size="sm" type="submit" loading={emojiBusy} disabled={!canCreateEmoji}>
								<Upload className="size-3.5" aria-hidden />
								<span>{t('chat.emojis.upload')}</span>
							</Button>
						</form>

						{workspaceEmojis.length === 0 ? (
							<EmptyState title={t('chat.emojis.empty')} />
						) : (
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{workspaceEmojis.map((em) => (
									<div
										key={em.id}
										className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
									>
										<div className="flex items-center gap-2.5">
											<img
												src={`/api/v1/files/${encodeURIComponent(em.fileId)}/download`}
												alt={`:${em.shortcode}:`}
												className="size-6 rounded-xs object-contain"
											/>
											<span className="font-mono text-xs font-medium text-foreground">:{em.shortcode}:</span>
										</div>
										<Button
											size="icon"
											tone="ghost"
											type="button"
											aria-label={t('common.delete')}
											onClick={() => void onDeleteEmoji(em.id)}
										>
											<Trash2 className="size-3.5 text-destructive" aria-hidden />
										</Button>
									</div>
								))}
							</div>
						)}
					</TabsContent>
				</Tabs>
			</div>
		</div>
	)
}
