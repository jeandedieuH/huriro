import type { MailMacroDto, MailTemplateDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { FileText, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SnippetMacroBarProps {
	readonly templates: readonly MailTemplateDto[]
	readonly macros: readonly MailMacroDto[]
	readonly customerName?: string | null | undefined
	readonly snippetsOpenSignal?: number | undefined
	readonly macrosOpenSignal?: number | undefined
	readonly onInsertSnippet: (templateId: string, variables: Record<string, string>) => Promise<void>
	readonly onApplyMacro: (macroId: string) => Promise<void>
}

/**
 * Toolbar strip in the mail composer providing snippet insertion (server-rendered
 * merge variables) and one-click macro execution on the open conversation.
 */
export function SnippetMacroBar({
	templates,
	macros,
	customerName,
	snippetsOpenSignal = 0,
	macrosOpenSignal = 0,
	onInsertSnippet,
	onApplyMacro
}: SnippetMacroBarProps) {
	const [snippetsOpen, setSnippetsOpen] = useState(false)
	const [macrosOpen, setMacrosOpen] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (snippetsOpenSignal > 0) setSnippetsOpen(true)
	}, [snippetsOpenSignal])

	useEffect(() => {
		if (macrosOpenSignal > 0) setMacrosOpen(true)
	}, [macrosOpenSignal])

	const handleSelectSnippet = async (tpl: MailTemplateDto) => {
		if (busy) return
		setBusy(true)
		try {
			const vars: Record<string, string> = {}
			for (const variable of tpl.mergeVariables) {
				if (variable === 'customer') {
					vars[variable] = customerName || 'there'
				}
			}
			await onInsertSnippet(tpl.id, vars)
			setSnippetsOpen(false)
		} finally {
			setBusy(false)
		}
	}

	const handleApplyMacro = async (macroId: string) => {
		if (busy) return
		setBusy(true)
		try {
			await onApplyMacro(macroId)
			setMacrosOpen(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Popover open={snippetsOpen} onOpenChange={setSnippetsOpen}>
				<PopoverTrigger asChild>
					<Button size="sm" tone="outline" type="button">
						<FileText className="size-3.5" aria-hidden />
						<span>{t('mail.templates.insert')}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72 p-2" align="start">
					<p className="mb-1.5 px-1 text-xs font-semibold text-foreground">{t('mail.templates.title')}</p>
					{templates.length === 0 ? (
						<p className="px-1 py-2 text-xs text-muted-foreground">{t('mail.templates.empty')}</p>
					) : (
						<ul className="max-h-48 space-y-1 overflow-y-auto">
							{templates.map((tpl) => (
								<li key={tpl.id}>
									<button
										type="button"
										disabled={busy}
										onClick={() => void handleSelectSnippet(tpl)}
										className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
									>
										<span className="font-medium text-foreground">{tpl.name}</span>
										<code className="text-muted-foreground">{tpl.shortcut}</code>
									</button>
								</li>
							))}
						</ul>
					)}
				</PopoverContent>
			</Popover>

			<Popover open={macrosOpen} onOpenChange={setMacrosOpen}>
				<PopoverTrigger asChild>
					<Button size="sm" tone="outline" type="button">
						<Zap className="size-3.5" aria-hidden />
						<span>{t('mail.macros.run')}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-64 p-2" align="start">
					<p className="mb-1.5 px-1 text-xs font-semibold text-foreground">{t('mail.macros.title')}</p>
					{macros.length === 0 ? (
						<p className="px-1 py-2 text-xs text-muted-foreground">{t('mail.macros.empty')}</p>
					) : (
						<ul className="max-h-48 space-y-1 overflow-y-auto">
							{macros.map((macro) => (
								<li key={macro.id}>
									<button
										type="button"
										disabled={busy}
										onClick={() => void handleApplyMacro(macro.id)}
										className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
									>
										<span className="font-medium text-foreground">{macro.name}</span>
										<span className="text-muted-foreground">{macro.steps.length}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</PopoverContent>
			</Popover>
		</div>
	)
}
