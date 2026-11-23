import type { FileDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Paperclip, Send, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface MessageComposerProps {
	readonly placeholder: string
	readonly onSend: (bodyText: string, attachmentFileIds: string[]) => Promise<void>
	readonly onUploadFile?: ((file: File) => Promise<FileDto>) | undefined
	readonly onTyping?: (() => void) | undefined
	readonly disabled?: boolean | undefined
}

export function MessageComposer({
	placeholder,
	onSend,
	onUploadFile,
	onTyping,
	disabled
}: MessageComposerProps) {
	const [text, setText] = useState('')
	const [uploadedFiles, setUploadedFiles] = useState<FileDto[]>([])
	const [uploading, setUploading] = useState(false)
	const [sending, setSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const lastTypingAt = useRef(0)

	async function submit() {
		const trimmed = text.trim()
		if (!trimmed && uploadedFiles.length === 0) return
		if (sending || disabled) return
		setSending(true)
		setError(null)
		try {
			await onSend(
				trimmed || uploadedFiles.map((f) => f.filename).join(', '),
				uploadedFiles.map((f) => f.id)
			)
			setText('')
			setUploadedFiles([])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send message')
		} finally {
			setSending(false)
		}
	}

	async function handleFileSelect(files: FileList | null) {
		if (!files || !onUploadFile || files.length === 0) return
		setUploading(true)
		setError(null)
		try {
			const uploaded: FileDto[] = []
			for (const file of Array.from(files)) {
				uploaded.push(await onUploadFile(file))
			}
			setUploadedFiles((prev) => [...prev, ...uploaded])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Attachment upload failed')
		} finally {
			setUploading(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	return (
		<div className="space-y-2 rounded-lg border border-border bg-card p-2.5">
			{uploadedFiles.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{uploadedFiles.map((f) => (
						<Badge key={f.id} tone="secondary" className="gap-1">
							<span>{f.filename}</span>
							<button
								type="button"
								aria-label={`Remove ${f.filename}`}
								onClick={() => setUploadedFiles((prev) => prev.filter((item) => item.id !== f.id))}
								className="rounded hover:text-destructive"
							>
								<X className="size-3" aria-hidden />
							</button>
						</Badge>
					))}
				</div>
			) : null}

			<Textarea
				value={text}
				disabled={disabled}
				onChange={(ev) => {
					setText(ev.target.value)
					const now = Date.now()
					if (onTyping && now - lastTypingAt.current > 3_000) {
						lastTypingAt.current = now
						onTyping()
					}
				}}
				onKeyDown={(ev) => {
					if (ev.key === 'Enter' && !ev.shiftKey) {
						ev.preventDefault()
						void submit()
					}
				}}
				placeholder={placeholder}
				aria-label={placeholder}
				rows={2}
				className="min-h-14 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
			/>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1">
					{onUploadFile ? (
						<>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								aria-label={t('chat.composer.attach')}
								className="hidden"
								onChange={(ev) => void handleFileSelect(ev.target.files)}
							/>
							<Button
								size="sm"
								tone="ghost"
								type="button"
								disabled={disabled || uploading}
								onClick={() => fileInputRef.current?.click()}
							>
								<Paperclip className="size-3.5" aria-hidden />
								<span>{uploading ? t('chat.composer.uploading') : t('chat.composer.attach')}</span>
							</Button>
						</>
					) : null}
				</div>

				<Button
					size="sm"
					type="button"
					loading={sending}
					disabled={disabled || uploading || (!text.trim() && uploadedFiles.length === 0)}
					onClick={() => void submit()}
				>
					<Send className="size-3.5" aria-hidden />
					<span>{t('chat.composer.send')}</span>
				</Button>
			</div>
		</div>
	)
}
