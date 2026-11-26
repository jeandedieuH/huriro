import { t } from '@huriro/i18n'
import { Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useHocuspocusProvider } from '@/lib/use-hocuspocus-provider'

export interface MailDraftCollabEditorProps {
	readonly draftId: string
	readonly workspaceId: string
	readonly value: string
	readonly onChange: (value: string) => void
	readonly onKeyDown?: ((ev: React.KeyboardEvent<HTMLTextAreaElement>) => void) | undefined
	readonly placeholder: string
	readonly ariaLabel: string
	readonly userDisplayName: string
	readonly currentUserId?: string | null | undefined
	readonly isPreview: boolean
	readonly api: TaskApiBridge
}

function readFragmentPlainText(fragment: Y.XmlFragment): string {
	const lines: string[] = []
	for (let i = 0; i < fragment.length; i++) {
		const node = fragment.get(i)
		if (node instanceof Y.XmlElement) {
			let line = ''
			for (let j = 0; j < node.length; j++) {
				const child = node.get(j)
				if (child instanceof Y.XmlText) line += child.toString()
			}
			lines.push(line)
		} else if (node instanceof Y.XmlText) {
			lines.push(node.toString())
		}
	}
	return lines.join('\n')
}

function writePlainTextToFragment(ydoc: Y.Doc, text: string): void {
	const fragment = ydoc.getXmlFragment('default')
	ydoc.transact(() => {
		if (fragment.length > 0) fragment.delete(0, fragment.length)
		const lines = text ? text.split('\n') : ['']
		const elements = lines.map((line) => {
			const para = new Y.XmlElement('paragraph')
			if (line.length > 0) para.insert(0, [new Y.XmlText(line)])
			return para
		})
		fragment.insert(0, elements)
	}, 'huriro:mail-draft-local')
}

/**
 * Lazy-loaded collaborative mail draft editor binding Yjs `default` XmlFragment
 * to Hocuspocus `/collab` (`mail_draft:<ws>:<draft>`) with presence indicator.
 */
export function MailDraftCollabEditor({
	draftId,
	workspaceId,
	value,
	onChange,
	onKeyDown,
	placeholder,
	ariaLabel,
	userDisplayName,
	currentUserId,
	isPreview,
	api
}: MailDraftCollabEditorProps) {
	const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
	const [peerCount, setPeerCount] = useState(1)
	const applyingRemoteRef = useRef(false)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const initialValueRef = useRef(value)

	const ydoc = useMemo(() => new Y.Doc({ guid: draftId }), [draftId])

	useEffect(() => {
		const fragment = ydoc.getXmlFragment('default')
		if (fragment.length === 0 && initialValueRef.current) {
			writePlainTextToFragment(ydoc, initialValueRef.current)
		}
	}, [ydoc])

	const provider = useHocuspocusProvider({
		enabled: !isPreview,
		documentName: `mail_draft:${workspaceId}:${draftId}`,
		document: ydoc,
		getToken: async () => {
			const issued = await api.issueMailDraftCollabTicket(draftId)
			return issued.ticket
		},
		onStatus: setStatus
	})

	useEffect(() => {
		if (!provider) return
		provider.setAwarenessField('user', {
			name: userDisplayName,
			id: currentUserId ?? 'self'
		})
		const handleAwareness = () => {
			const count = provider.awareness?.getStates().size ?? 1
			setPeerCount(Math.max(count, 1))
		}
		provider.awareness?.on('change', handleAwareness)
		handleAwareness()
		return () => {
			provider.awareness?.off('change', handleAwareness)
		}
	}, [currentUserId, provider, userDisplayName])

	useEffect(() => {
		const fragment = ydoc.getXmlFragment('default')
		const handleYjsChange = (_events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
			if (tr.origin === 'huriro:mail-draft-local') return
			const nextText = readFragmentPlainText(fragment)
			applyingRemoteRef.current = true
			onChangeRef.current(nextText)
			applyingRemoteRef.current = false
		}
		fragment.observeDeep(handleYjsChange)
		return () => {
			fragment.unobserveDeep(handleYjsChange)
			ydoc.destroy()
		}
	}, [ydoc])

	// Keep Y.Doc aligned when external helpers (AI insert, snippet) replace the draft text.
	useEffect(() => {
		if (applyingRemoteRef.current) return
		const currentYText = readFragmentPlainText(ydoc.getXmlFragment('default'))
		if (currentYText !== value) {
			writePlainTextToFragment(ydoc, value)
		}
	}, [value, ydoc])

	const statusLabel = isPreview
		? t('mail.collab.preview')
		: status === 'connected'
			? t('mail.collab.connected')
			: status === 'connecting'
				? t('mail.collab.connecting')
				: t('mail.collab.offline')

	return (
		<div className="min-w-0 flex-1 space-y-1.5" data-testid="mail-draft-collab-editor">
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<Badge tone={status === 'connected' || isPreview ? 'success' : 'secondary'}>{statusLabel}</Badge>
				<span className="inline-flex items-center gap-1">
					<Users className="size-3" aria-hidden />
					{peerCount > 1 ? t('mail.collab.peers', { count: peerCount }) : t('mail.collab.solo')}
				</span>
			</div>
			<Textarea
				aria-label={ariaLabel}
				value={value}
				onChange={(e) => {
					const next = e.target.value
					writePlainTextToFragment(ydoc, next)
					onChange(next)
				}}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				className="min-h-20 w-full"
			/>
		</div>
	)
}
