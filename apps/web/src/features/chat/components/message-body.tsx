import type { WorkspaceEmojiDto } from '@huriro/contracts'
import type { ReactNode } from 'react'
import { Fragment } from 'react'

export interface MessageBodyProps {
	readonly bodyText: string
	readonly workspaceEmojis?: readonly WorkspaceEmojiDto[] | undefined
	readonly onClickChannel?: ((channelName: string) => void) | undefined
}

type BlockSegment =
	| { readonly kind: 'code'; readonly content: string }
	| { readonly kind: 'text'; readonly content: string }

function splitFencedCodeBlocks(input: string): BlockSegment[] {
	const segments: BlockSegment[] = []
	const fenceRegex = /```(?:[a-z0-9_-]*\n)?([\s\S]*?)```/gi
	let cursor = 0
	for (const match of input.matchAll(fenceRegex)) {
		const idx = match.index ?? 0
		if (idx > cursor) {
			segments.push({ kind: 'text', content: input.slice(cursor, idx) })
		}
		segments.push({ kind: 'code', content: (match[1] ?? '').replace(/\n$/, '') })
		cursor = idx + match[0].length
	}
	if (cursor < input.length) {
		segments.push({ kind: 'text', content: input.slice(cursor) })
	}
	return segments
}

/** Render inline markdown, mentions, channel refs, and custom emojis without raw HTML. */
function renderInlineTokens(
	text: string,
	emojiMap: Map<string, WorkspaceEmojiDto>,
	onClickChannel?: (channelName: string) => void
): ReactNode[] {
	const tokenPattern =
		/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|`[^`\n]+`|:[a-zA-Z0-9_+-]+:|(?:^|(?<=\s))@[a-zA-Z0-9_.-]+|(?:^|(?<=\s))#[a-z0-9-]+)/g
	const nodes: ReactNode[] = []
	let lastIndex = 0
	let keyCounter = 0

	for (const match of text.matchAll(tokenPattern)) {
		const idx = match.index ?? 0
		if (idx > lastIndex) {
			nodes.push(text.slice(lastIndex, idx))
		}
		const token = match[0]
		const key = `tok-${keyCounter++}`

		if (token.startsWith('**') && token.endsWith('**')) {
			nodes.push(
				<strong key={key} className="font-semibold">
					{token.slice(2, -2)}
				</strong>
			)
		} else if (token.startsWith('*') && token.endsWith('*')) {
			nodes.push(
				<em key={key} className="italic">
					{token.slice(1, -1)}
				</em>
			)
		} else if (token.startsWith('~~') && token.endsWith('~~')) {
			nodes.push(
				<del key={key} className="text-muted-foreground line-through">
					{token.slice(2, -2)}
				</del>
			)
		} else if (token.startsWith('`') && token.endsWith('`')) {
			nodes.push(
				<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">
					{token.slice(1, -1)}
				</code>
			)
		} else if (token.startsWith(':') && token.endsWith(':')) {
			const shortcode = token.slice(1, -1)
			const custom = emojiMap.get(shortcode)
			if (custom) {
				nodes.push(
					<img
						key={key}
						src={`/api/v1/files/${encodeURIComponent(custom.fileId)}/download`}
						alt={token}
						title={token}
						className="inline-block size-4 rounded-xs object-contain align-text-bottom"
					/>
				)
			} else {
				nodes.push(token)
			}
		} else if (token.startsWith('@')) {
			nodes.push(
				<span key={key} className="rounded bg-primary/10 px-1 font-medium text-primary">
					{token}
				</span>
			)
		} else if (token.startsWith('#')) {
			const channelName = token.slice(1)
			nodes.push(
				onClickChannel ? (
					<button
						key={key}
						type="button"
						onClick={() => onClickChannel(channelName)}
						className="rounded bg-secondary px-1 font-medium text-secondary-foreground hover:underline"
					>
						{token}
					</button>
				) : (
					<span key={key} className="rounded bg-secondary px-1 font-medium text-secondary-foreground">
						{token}
					</span>
				)
			)
		} else {
			nodes.push(token)
		}

		lastIndex = idx + token.length
	}

	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex))
	}
	return nodes
}

function renderTextLines(
	content: string,
	emojiMap: Map<string, WorkspaceEmojiDto>,
	onClickChannel?: (channelName: string) => void
): ReactNode[] {
	const lines = content.split('\n')
	const out: ReactNode[] = []
	let i = 0

	while (i < lines.length) {
		const line = lines[i] ?? ''

		if (line.startsWith('> ')) {
			const quoteLines: string[] = []
			while (i < lines.length && (lines[i] ?? '').startsWith('> ')) {
				quoteLines.push((lines[i] ?? '').slice(2))
				i++
			}
			out.push(
				<blockquote
					key={`quote-${i}`}
					className="my-1 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground"
				>
					{quoteLines.map((ql, idx) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: sequential quote lines within static snapshot
						<Fragment key={idx}>
							{idx > 0 ? <br /> : null}
							{renderInlineTokens(ql, emojiMap, onClickChannel)}
						</Fragment>
					))}
				</blockquote>
			)
			continue
		}

		if (/^[-*]\s+/.test(line)) {
			const listItems: string[] = []
			while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
				listItems.push((lines[i] ?? '').replace(/^[-*]\s+/, ''))
				i++
			}
			out.push(
				<ul key={`list-${i}`} className="my-1 list-disc space-y-0.5 pl-5 text-sm leading-relaxed">
					{listItems.map((item, idx) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: ordered list items rendered inline
						<li key={idx}>{renderInlineTokens(item, emojiMap, onClickChannel)}</li>
					))}
				</ul>
			)
			continue
		}

		out.push(
			<p key={`line-${i}`} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
				{line.length > 0 ? renderInlineTokens(line, emojiMap, onClickChannel) : '\u00A0'}
			</p>
		)
		i++
	}

	return out
}

/** Safe React message renderer supporting markdown formatting, code blocks, mentions, and custom emojis. */
export function MessageBody({ bodyText, workspaceEmojis, onClickChannel }: MessageBodyProps) {
	const emojiMap = new Map<string, WorkspaceEmojiDto>()
	for (const item of workspaceEmojis ?? []) {
		emojiMap.set(item.shortcode, item)
	}

	const segments = splitFencedCodeBlocks(bodyText)

	return (
		<div className="mt-1 space-y-1">
			{segments.map((seg, idx) =>
				seg.kind === 'code' ? (
					<pre
						// biome-ignore lint/suspicious/noArrayIndexKey: ordered parsed message segments
						key={`code-${idx}`}
						className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground"
					>
						<code>{seg.content}</code>
					</pre>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: ordered parsed message segments
					<Fragment key={`seg-${idx}`}>{renderTextLines(seg.content, emojiMap, onClickChannel)}</Fragment>
				)
			)}
		</div>
	)
}
