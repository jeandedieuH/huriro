import { HuriroCodeBlockExtension } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { NodeViewContent, type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CODE_LANGUAGES: readonly { readonly value: string; readonly label: string }[] = [
	{ value: 'plain', label: 'Plain text' },
	{ value: 'typescript', label: 'TypeScript' },
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'python', label: 'Python' },
	{ value: 'bash', label: 'Bash' },
	{ value: 'json', label: 'JSON' },
	{ value: 'sql', label: 'SQL' },
	{ value: 'css', label: 'CSS' },
	{ value: 'html', label: 'HTML' },
	{ value: 'markdown', label: 'Markdown' },
	{ value: 'go', label: 'Go' },
	{ value: 'rust', label: 'Rust' },
	{ value: 'yaml', label: 'YAML' }
]

const LANGUAGE_ALIASES: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	py: 'python',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	yml: 'yaml',
	md: 'markdown',
	plaintext: 'plain',
	text: 'plain'
}

function normalizeLanguage(raw: unknown): string {
	const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
	if (!value) return 'plain'
	return LANGUAGE_ALIASES[value] ?? value
}

function CodeBlockNodeView(props: NodeViewProps) {
	const normalizedLang = normalizeLanguage(props.node.attrs['language'])
	const [copied, setCopied] = useState(false)
	const timerRef = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current)
		}
	}, [])

	async function handleCopy() {
		try {
			await navigator.clipboard?.writeText(props.node.textContent)
			setCopied(true)
			if (timerRef.current !== null) window.clearTimeout(timerRef.current)
			timerRef.current = window.setTimeout(() => setCopied(false), 1800)
		} catch {
			// Clipboard permissions can deny writes in non-secure contexts.
		}
	}

	const options = CODE_LANGUAGES.some((item) => item.value === normalizedLang)
		? CODE_LANGUAGES
		: [...CODE_LANGUAGES, { value: normalizedLang, label: normalizedLang }]

	const activeLabel =
		normalizedLang === 'plain'
			? t('docs.code.plain')
			: (options.find((item) => item.value === normalizedLang)?.label ?? normalizedLang)

	return (
		<NodeViewWrapper
			data-code-block="true"
			className="group/code my-3.5 overflow-hidden rounded-xl border border-border/80 bg-(--surface-2)"
		>
			<div
				contentEditable={false}
				className="flex items-center justify-between gap-2 border-b border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground select-none"
			>
				{props.editor.isEditable ? (
					<Select
						value={normalizedLang}
						onValueChange={(next) => props.updateAttributes({ language: next === 'plain' ? null : next })}
					>
						<SelectTrigger
							aria-label={t('docs.code.language')}
							className="h-6 w-auto min-w-24 border-transparent bg-transparent px-1.5 py-0 text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((opt) => (
								<SelectItem key={opt.value} value={opt.value} className="text-xs">
									{opt.value === 'plain' ? t('docs.code.plain') : opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<span className="px-1 font-mono text-[11px] font-medium text-muted-foreground">{activeLabel}</span>
				)}

				<Button
					type="button"
					size="sm"
					tone="ghost"
					aria-label={copied ? t('docs.code.copied') : t('docs.code.copy')}
					onClick={() => void handleCopy()}
					className="h-6 gap-1 px-2 text-xs text-muted-foreground opacity-80 transition-opacity hover:text-foreground group-hover/code:opacity-100"
				>
					{copied ? (
						<>
							<Check className="size-3 text-(--success)" aria-hidden />
							<span className="text-(--success)">{t('docs.code.copied')}</span>
						</>
					) : (
						<>
							<Copy className="size-3" aria-hidden />
							<span>{t('docs.code.copy')}</span>
						</>
					)}
				</Button>
			</div>

			<pre className="m-0 overflow-x-auto border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed">
				<NodeViewContent<'code'> as="code" />
			</pre>
		</NodeViewWrapper>
	)
}

export const CodeBlockNodeViewExtension = HuriroCodeBlockExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(CodeBlockNodeView)
	}
})
