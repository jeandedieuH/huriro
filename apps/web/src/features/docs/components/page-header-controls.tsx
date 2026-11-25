import type {
	DocFontStyle,
	DocPageDto,
	DocVerificationDto,
	SetDocVerificationBody,
	UpdateDocPageBody
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	CheckCircle2,
	Download,
	Globe,
	Image as ImageIcon,
	Lock,
	MessageSquarePlus,
	MoveVertical,
	ShieldAlert,
	ShieldCheck,
	SlidersHorizontal,
	Smile,
	Unlock
} from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { COVER_GRADIENTS, getCoverGradient } from './cover-gradients'
import { PageIconPicker } from './page-icon-picker'

export interface PageHeaderControlsProps {
	readonly page: DocPageDto
	readonly verification: DocVerificationDto | null
	readonly canWrite: boolean
	readonly canShare: boolean
	readonly canVerify: boolean
	readonly canPublish: boolean
	readonly titleDraft?: string | undefined
	readonly onTitleChange?: ((value: string) => void) | undefined
	readonly onTitleCommit?: (() => void) | undefined
	readonly onTitleEnter?: (() => void) | undefined
	readonly onAddComment?: (() => void) | undefined
	readonly articleMaxWidth?: string | undefined
	readonly showStandaloneUtilities?: boolean | undefined
	readonly onUpdateMeta: (patch: Omit<UpdateDocPageBody, 'version'>) => Promise<void>
	readonly onVerify: (body: SetDocVerificationBody) => Promise<void>
	readonly onClearVerification: () => Promise<void>
	readonly onExportMarkdown: () => Promise<void>
	readonly onExportHtml: (print: boolean) => Promise<void>
	readonly onExportZip: () => Promise<void>
	readonly onOpenPublish: () => void
}

export function PageHeaderControls({
	page,
	verification,
	canWrite,
	canShare,
	canVerify,
	canPublish,
	titleDraft,
	onTitleChange,
	onTitleCommit,
	onTitleEnter,
	onAddComment,
	articleMaxWidth = 'max-w-3xl',
	showStandaloneUtilities = !onTitleChange,
	onUpdateMeta,
	onVerify,
	onClearVerification,
	onExportMarkdown,
	onExportHtml,
	onExportZip,
	onOpenPublish
}: PageHeaderControlsProps) {
	const [ttlDays, setTtlDays] = useState('90')
	const [verifyNote, setVerifyNote] = useState(verification?.note ?? '')
	const [verifyOpen, setVerifyOpen] = useState(false)
	const [coverPickerOpen, setCoverPickerOpen] = useState(false)
	const [repositioningCover, setRepositioningCover] = useState(false)
	const [styleOpen, setStyleOpen] = useState(false)
	const titleAreaRef = useRef<HTMLTextAreaElement>(null)
	const persistedCoverPos = page.coverPositionY ?? 50
	const [coverPosDraft, setCoverPosDraft] = useState(persistedCoverPos)
	const [syncedPersistedPos, setSyncedPersistedPos] = useState(persistedCoverPos)
	const pointerDraggingRef = useRef(false)

	if (syncedPersistedPos !== persistedCoverPos) {
		setSyncedPersistedPos(persistedCoverPos)
		setCoverPosDraft(persistedCoverPos)
	}

	function syncTitleHeight(el: HTMLTextAreaElement | null) {
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${el.scrollHeight}px`
	}

	function commitCoverPosition(nextPos: number) {
		if (nextPos === persistedCoverPos) return
		void onUpdateMeta({ coverPositionY: nextPos })
	}

	const activeGradient = getCoverGradient(page.coverGradient)
	const verificationStatus = verification?.status ?? page.verificationStatus ?? 'unverified'
	const effectiveEditable = canWrite && !page.isLocked
	const lockAllowed = canShare || canWrite
	const displayedTitle = titleDraft ?? page.title
	const showCoverSlider = repositioningCover || showStandaloneUtilities

	function handleTitleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>) {
		if (ev.key === 'Enter' && !ev.shiftKey) {
			ev.preventDefault()
			onTitleCommit?.()
			onTitleEnter?.()
		}
	}

	const coverSwatchPicker = (
		<Popover open={coverPickerOpen} onOpenChange={setCoverPickerOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					size="sm"
					tone={activeGradient ? 'outline' : 'ghost'}
					className={cn(
						'h-7 gap-1.5 px-2 text-xs',
						activeGradient
							? 'border-border/80 bg-popover/85 backdrop-blur-md hover:bg-popover'
							: 'text-muted-foreground hover:text-foreground'
					)}
				>
					<ImageIcon className="size-3.5" aria-hidden />
					<span>{activeGradient ? t('docs.cover.change') : t('docs.cover.add')}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align={activeGradient ? 'end' : 'start'}
				className="w-64 space-y-2 rounded-xl border-border/90 bg-popover/98 p-2.5 shadow-(--shadow-3) backdrop-blur-md"
			>
				<div className="flex items-center justify-between gap-2 px-1">
					<span className="text-xs font-medium text-muted-foreground">{t('docs.cover.choose')}</span>
					{activeGradient ? (
						<Button
							type="button"
							size="sm"
							tone="ghost"
							className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
							onClick={() => {
								void onUpdateMeta({ coverGradient: null })
								setCoverPickerOpen(false)
								setRepositioningCover(false)
							}}
						>
							{t('docs.cover.remove')}
						</Button>
					) : null}
				</div>
				<div className="grid grid-cols-1 gap-1.5">
					{COVER_GRADIENTS.map((g) => {
						const selected = activeGradient?.id === g.id
						return (
							<button
								key={g.id}
								type="button"
								onClick={() => {
									void onUpdateMeta({ coverGradient: g.id })
									setCoverPickerOpen(false)
								}}
								className={cn(
									'flex items-center gap-2.5 rounded-lg border p-1.5 text-left text-xs transition-colors',
									selected
										? 'border-primary bg-accent/60 font-medium text-foreground'
										: 'border-border/60 hover:bg-accent/50'
								)}
							>
								<span
									aria-hidden
									className="h-6 w-12 shrink-0 rounded-md border border-border/40"
									style={{ backgroundImage: g.background }}
								/>
								<span>{g.label()}</span>
							</button>
						)
					})}
				</div>
			</PopoverContent>
		</Popover>
	)

	return (
		<div className="w-full">
			{activeGradient ? (
				<div className="group/cover relative h-40 w-full overflow-hidden border-b border-border/40 sm:h-48">
					<div
						role="img"
						aria-label={activeGradient.label()}
						className="absolute inset-0 transition-[background-position] duration-(--motion-duration-fast)"
						style={{
							backgroundImage: activeGradient.background,
							backgroundPositionY: `${coverPosDraft}%`
						}}
					/>
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background/45 to-transparent"
					/>
					{effectiveEditable ? (
						<div
							className={cn(
								'absolute right-4 bottom-3 flex flex-wrap items-center gap-1.5 transition-opacity duration-(--motion-duration-fast)',
								repositioningCover || coverPickerOpen || showStandaloneUtilities
									? 'opacity-100'
									: 'opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100'
							)}
						>
							{coverSwatchPicker}

							{showCoverSlider ? (
								<div className="flex items-center gap-2 rounded-lg border border-border/80 bg-popover/90 px-2.5 py-1 backdrop-blur-md">
									<label className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{t('docs.cover.position', { pct: coverPosDraft })}</span>
										<input
											type="range"
											min={0}
											max={100}
											value={coverPosDraft}
											onPointerDown={() => {
												pointerDraggingRef.current = true
											}}
											onChange={(ev) => setCoverPosDraft(Number(ev.target.value))}
											onPointerUp={(ev) => {
												pointerDraggingRef.current = false
												const next = Number((ev.target as HTMLInputElement).value)
												setCoverPosDraft(next)
												commitCoverPosition(next)
											}}
											onBlur={(ev) => {
												if (!pointerDraggingRef.current) {
													const next = Number((ev.target as HTMLInputElement).value)
													commitCoverPosition(next)
												}
											}}
											className="w-20 accent-primary"
										/>
									</label>
									{!showStandaloneUtilities ? (
										<Button
											type="button"
											size="sm"
											tone="secondary"
											className="h-6 px-2 text-xs"
											onClick={() => setRepositioningCover(false)}
										>
											{t('docs.cover.done')}
										</Button>
									) : null}
								</div>
							) : (
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 gap-1 border-border/80 bg-popover/85 px-2 text-xs backdrop-blur-md hover:bg-popover"
									onClick={() => setRepositioningCover(true)}
								>
									<MoveVertical className="size-3.5" aria-hidden />
									<span>{t('docs.cover.reposition')}</span>
								</Button>
							)}

							<Button
								type="button"
								size="sm"
								tone="outline"
								className="h-7 border-border/80 bg-popover/85 px-2 text-xs backdrop-blur-md hover:bg-popover"
								onClick={() => {
									void onUpdateMeta({ coverGradient: null })
									setRepositioningCover(false)
								}}
							>
								{t('docs.cover.remove')}
							</Button>
						</div>
					) : null}
				</div>
			) : null}

			{page.isLocked ? (
				<div
					role="status"
					className="flex items-center justify-between gap-2 border-b border-(--warning)/30 bg-(--warning)/10 px-4 py-1.5 text-xs text-(--warning)"
				>
					<div className="flex items-center gap-2">
						<Lock className="size-3.5 shrink-0" aria-hidden />
						<span>{t('docs.lock.banner')}</span>
					</div>
					{lockAllowed ? (
						<Button
							type="button"
							size="sm"
							tone="ghost"
							className="h-6 gap-1 px-2 text-xs text-(--warning) hover:bg-(--warning)/15"
							onClick={() => void onUpdateMeta({ isLocked: false })}
						>
							<Unlock className="size-3.5" aria-hidden />
							<span>{t('docs.lock.unlock-page')}</span>
						</Button>
					) : null}
				</div>
			) : null}

			<div
				className={cn(
					'group/hero mx-auto px-12 pb-3 sm:px-16',
					articleMaxWidth,
					activeGradient ? 'pt-0' : 'pt-8 sm:pt-10'
				)}
			>
				{page.icon ? (
					<div className={cn('relative z-10 inline-flex', activeGradient ? '-mt-9 mb-2' : 'mb-2')}>
						<PageIconPicker
							icon={page.icon}
							disabled={!effectiveEditable}
							onSelect={(nextIcon) => void onUpdateMeta({ icon: nextIcon })}
							trigger={
								effectiveEditable ? (
									<button
										type="button"
										aria-label={t('docs.icon.change')}
										className="flex size-16 items-center justify-center rounded-2xl bg-background/90 text-5xl shadow-(--shadow-1) ring-1 ring-border/50 transition-colors hover:bg-muted"
									>
										<span aria-hidden>{page.icon}</span>
									</button>
								) : (
									<span className="flex size-16 items-center justify-center rounded-2xl bg-background/90 text-5xl shadow-(--shadow-1) ring-1 ring-border/50">
										{page.icon}
									</span>
								)
							}
						/>
					</div>
				) : null}

				<div className="mt-1 flex flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap items-center gap-1 opacity-75 transition-opacity duration-(--motion-duration-fast) group-hover/hero:opacity-100 focus-within:opacity-100">
						{!page.icon && effectiveEditable ? (
							<PageIconPicker
								icon={null}
								onSelect={(nextIcon) => void onUpdateMeta({ icon: nextIcon })}
								trigger={
									<Button
										type="button"
										size="sm"
										tone="ghost"
										className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
									>
										<Smile className="size-3.5" aria-hidden />
										<span>{t('docs.icon.add')}</span>
									</Button>
								}
							/>
						) : null}

						{!activeGradient && effectiveEditable ? coverSwatchPicker : null}

						<Popover open={verifyOpen} onOpenChange={setVerifyOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
								>
									{verificationStatus === 'verified' ? (
										<>
											<ShieldCheck className="size-3.5 text-(--success)" aria-hidden />
											<Badge tone="success">{t('docs.verify.badge.verified')}</Badge>
										</>
									) : verificationStatus === 'stale' ? (
										<>
											<ShieldAlert className="size-3.5 text-(--warning)" aria-hidden />
											<Badge tone="warning">{t('docs.verify.badge.stale')}</Badge>
										</>
									) : (
										<>
											<CheckCircle2 className="size-3.5 text-muted-foreground" aria-hidden />
											<span>{t('docs.verify.badge.unverified')}</span>
										</>
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="start"
								className="w-72 space-y-2.5 rounded-xl border-border/90 bg-popover/98 p-3 shadow-(--shadow-3) backdrop-blur-md"
							>
								<p className="text-xs font-semibold">{t('docs.verify.title')}</p>
								<div className="space-y-1">
									<label htmlFor="verify-ttl" className="text-xs text-muted-foreground">
										{t('docs.verify.ttl-days')}
									</label>
									<Input
										id="verify-ttl"
										type="number"
										min={1}
										max={3650}
										value={ttlDays}
										onChange={(ev) => setTtlDays(ev.target.value)}
										readOnly={!canVerify}
										className="h-7 text-xs"
									/>
								</div>
								<div className="space-y-1">
									<label htmlFor="verify-note" className="text-xs text-muted-foreground">
										{t('docs.verify.note')}
									</label>
									<Input
										id="verify-note"
										value={verifyNote}
										onChange={(ev) => setVerifyNote(ev.target.value)}
										readOnly={!canVerify}
										className="h-7 text-xs"
									/>
								</div>
								{canVerify ? (
									<div className="flex items-center justify-between gap-2 pt-1">
										<Button
											type="button"
											size="sm"
											tone="outline"
											className="h-7 text-xs"
											onClick={() => {
												void onClearVerification().then(() => setVerifyOpen(false))
											}}
										>
											{t('docs.verify.clear')}
										</Button>
										<Button
											type="button"
											size="sm"
											className="h-7 text-xs"
											onClick={() => {
												const parsedTtl = Number(ttlDays)
												void onVerify({
													status: 'verified',
													ttlDays: Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 90,
													note: verifyNote.trim()
												}).then(() => setVerifyOpen(false))
											}}
										>
											{t('docs.verify.confirm')}
										</Button>
									</div>
								) : null}
							</PopoverContent>
						</Popover>

						{onAddComment ? (
							<Button
								type="button"
								size="sm"
								tone="ghost"
								onClick={onAddComment}
								className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
							>
								<MessageSquarePlus className="size-3.5" aria-hidden />
								<span>{t('docs.hero.add-comment')}</span>
							</Button>
						) : null}
					</div>

					{showStandaloneUtilities ? (
						<div className="flex flex-wrap items-center gap-1">
							{canWrite ? (
								<Popover open={styleOpen} onOpenChange={setStyleOpen}>
									<PopoverTrigger asChild>
										<Button type="button" size="sm" tone="ghost" className="h-7 gap-1 px-2 text-xs">
											<SlidersHorizontal className="size-3.5" aria-hidden />
											<span>{t('docs.style.font')}</span>
										</Button>
									</PopoverTrigger>
									<PopoverContent align="end" className="w-64 space-y-2.5 p-3">
										<div className="space-y-1">
											<span className="text-xs text-muted-foreground">{t('docs.style.font')}</span>
											<Select
												value={page.fontStyle ?? 'sans'}
												onValueChange={(v) => void onUpdateMeta({ fontStyle: v as DocFontStyle })}
											>
												<SelectTrigger aria-label={t('docs.style.font')} className="h-8 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="sans">{t('docs.style.font.sans')}</SelectItem>
													<SelectItem value="serif">{t('docs.style.font.serif')}</SelectItem>
													<SelectItem value="mono">{t('docs.style.font.mono')}</SelectItem>
												</SelectContent>
											</Select>
										</div>
										<div className="flex items-center justify-between gap-2">
											<span className="text-xs">{t('docs.style.full-width')}</span>
											<Button
												type="button"
												size="sm"
												tone={page.fullWidth ? 'secondary' : 'outline'}
												className="h-7 px-2 text-xs"
												onClick={() => void onUpdateMeta({ fullWidth: !page.fullWidth })}
											>
												{page.fullWidth ? 'On' : 'Off'}
											</Button>
										</div>
										<div className="flex items-center justify-between gap-2">
											<span className="text-xs">{t('docs.style.small-text')}</span>
											<Button
												type="button"
												size="sm"
												tone={page.smallText ? 'secondary' : 'outline'}
												className="h-7 px-2 text-xs"
												onClick={() => void onUpdateMeta({ smallText: !page.smallText })}
											>
												{page.smallText ? 'On' : 'Off'}
											</Button>
										</div>
									</PopoverContent>
								</Popover>
							) : null}

							{lockAllowed && !page.isLocked ? (
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 gap-1 px-2 text-xs"
									onClick={() => void onUpdateMeta({ isLocked: true })}
								>
									<Lock className="size-3.5" aria-hidden />
									<span>{t('docs.lock.lock-page')}</span>
								</Button>
							) : null}

							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button type="button" size="sm" tone="ghost" className="h-7 gap-1 px-2 text-xs">
										<Download className="size-3.5" aria-hidden />
										<span>{t('docs.export.menu')}</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => void onExportMarkdown()}>
										{t('docs.export.markdown')}
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => void onExportHtml(false)}>
										{t('docs.export.html')}
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => void onExportHtml(true)}>
										{t('docs.export.pdf-html')}
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => void onExportZip()}>
										{t('docs.export.zip')}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>

							{canPublish ? (
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 gap-1 px-2 text-xs"
									onClick={onOpenPublish}
								>
									<Globe className="size-3.5" aria-hidden />
									<span>{t('docs.publish.button')}</span>
								</Button>
							) : null}
						</div>
					) : null}
				</div>

				{onTitleChange ? (
					<textarea
						ref={(el) => {
							titleAreaRef.current = el
							syncTitleHeight(el)
						}}
						rows={1}
						aria-label={t('docs.create.title-label')}
						value={displayedTitle}
						readOnly={!effectiveEditable}
						onChange={(ev) => {
							syncTitleHeight(ev.currentTarget)
							onTitleChange(ev.target.value.replace(/\r?\n/g, ' '))
						}}
						onBlur={() => onTitleCommit?.()}
						onKeyDown={handleTitleKeyDown}
						placeholder={t('docs.editor.title-placeholder')}
						className="mt-2 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-3xl leading-[1.15] font-bold tracking-tight text-foreground placeholder:text-(--ink-tertiary)/60 focus:outline-none focus-visible:outline-none sm:text-4xl"
					/>
				) : null}
			</div>
		</div>
	)
}
