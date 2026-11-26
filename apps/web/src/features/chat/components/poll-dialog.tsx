import type { CreatePollBody } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface PollDialogProps {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onCreatePoll: (body: CreatePollBody) => Promise<void> | void
}

const MAX_OPTIONS = 6

/** Modal composer for creating an interactive channel poll. */
export function PollDialog({ open, onOpenChange, onCreatePoll }: PollDialogProps) {
	const [question, setQuestion] = useState('')
	const [options, setOptions] = useState<string[]>(['', ''])
	const [multiChoice, setMultiChoice] = useState(false)
	const [anonymous, setAnonymous] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	function resetForm() {
		setQuestion('')
		setOptions(['', ''])
		setMultiChoice(false)
		setAnonymous(false)
	}

	const validOptions = options.map((opt) => opt.trim()).filter((opt) => opt.length > 0)
	const canSubmit = question.trim().length > 0 && validOptions.length >= 2 && !submitting

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		if (!canSubmit) return
		setSubmitting(true)
		try {
			await onCreatePoll({
				question: question.trim(),
				options: validOptions.map((label, idx) => ({
					id: `opt_${idx + 1}`,
					label
				})),
				multiChoice,
				anonymous
			})
			resetForm()
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) resetForm()
				onOpenChange(next)
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('chat.poll.title')}</DialogTitle>
					<DialogDescription className="sr-only">{t('chat.poll.question-placeholder')}</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="chat-poll-question" className="text-xs font-medium text-foreground">
							{t('chat.poll.question')}
						</label>
						<Input
							id="chat-poll-question"
							value={question}
							onChange={(ev) => setQuestion(ev.target.value)}
							placeholder={t('chat.poll.question-placeholder')}
							maxLength={500}
						/>
					</div>

					<div className="space-y-2">
						{options.map((opt, idx) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: ordered dynamic poll inputs keep focus stability by index
							<div key={idx} className="flex items-center gap-1.5">
								<Input
									value={opt}
									aria-label={t('chat.poll.option', { n: idx + 1 })}
									placeholder={t('chat.poll.option', { n: idx + 1 })}
									maxLength={200}
									onChange={(ev) => {
										const val = ev.target.value
										setOptions((prev) => prev.map((item, i) => (i === idx ? val : item)))
									}}
								/>
								{options.length > 2 ? (
									<Button
										size="icon"
										tone="ghost"
										type="button"
										aria-label={t('common.delete')}
										onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
									>
										<Trash2 className="size-3.5 text-muted-foreground" aria-hidden />
									</Button>
								) : null}
							</div>
						))}

						{options.length < MAX_OPTIONS ? (
							<Button
								size="sm"
								tone="outline"
								type="button"
								onClick={() => setOptions((prev) => [...prev, ''])}
							>
								<Plus className="size-3.5" aria-hidden />
								<span>{t('chat.poll.add-option')}</span>
							</Button>
						) : null}
					</div>

					<div className="flex flex-wrap gap-4 pt-1">
						<div className="inline-flex items-center gap-2">
							<Checkbox
								id="chat-poll-multi"
								checked={multiChoice}
								onCheckedChange={(v) => setMultiChoice(v === true)}
							/>
							<label htmlFor="chat-poll-multi" className="cursor-pointer text-xs text-foreground">
								{t('chat.poll.multi')}
							</label>
						</div>
						<div className="inline-flex items-center gap-2">
							<Checkbox
								id="chat-poll-anon"
								checked={anonymous}
								onCheckedChange={(v) => setAnonymous(v === true)}
							/>
							<label htmlFor="chat-poll-anon" className="cursor-pointer text-xs text-foreground">
								{t('chat.poll.anonymous')}
							</label>
						</div>
					</div>

					<DialogFooter>
						<Button size="sm" tone="outline" type="button" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button size="sm" type="submit" loading={submitting} disabled={!canSubmit}>
							{t('chat.poll.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
