'use dom'

import { lightTheme } from '@huriro/design-tokens/rn-theme'
import {
	createHuriroExtensions,
	markdownToProseMirrorJson,
	proseMirrorJsonToMarkdown,
	sanitizeHtml
} from '@huriro/editor'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'

export interface DocDomEditorThemeColors {
	readonly background: string
	readonly foreground: string
	readonly primary: string
	readonly primaryForeground: string
}

export interface DocDomEditorProps {
	readonly dom?: { readonly matchContents?: boolean } | undefined
	readonly initialMarkdown: string
	readonly docId: string
	readonly readOnly?: boolean | undefined
	readonly themeColors?: DocDomEditorThemeColors | undefined
	readonly onSaveMarkdown?: (markdown: string) => void | Promise<void>
}

/**
 * Light mobile rich-text editor using Expo DOM component (`'use dom'`) +
 * shared `@huriro/editor` schema & sanitizer (§6.3, §18.2).
 */
// 'use dom' modules must have a single default export — Expo DOM components contract
export default function DocDomEditor({
	initialMarkdown,
	docId,
	readOnly = false,
	themeColors,
	onSaveMarkdown
}: DocDomEditorProps) {
	const resolved = themeColors ?? {
		background: lightTheme.colors['card'] ?? '#ffffff',
		foreground: lightTheme.colors['foreground'] ?? '#1d1f24',
		primary: lightTheme.colors['primary'] ?? '#d91f56',
		primaryForeground: lightTheme.colors['primary-foreground'] ?? '#fcfcfc'
	}
	const editor = useEditor({
		extensions: createHuriroExtensions({
			collaborative: false
		}),
		content: markdownToProseMirrorJson(initialMarkdown, docId) as Record<string, unknown>,
		editable: !readOnly
	})

	useEffect(() => {
		if (!editor) return
		editor.setEditable(!readOnly)
	}, [editor, readOnly])

	function handleSave() {
		if (!editor || !onSaveMarkdown) return
		const cleanHtml = sanitizeHtml(editor.getHTML())
		const md = proseMirrorJsonToMarkdown(editor.getJSON() as never)
		void cleanHtml
		void onSaveMarkdown(md)
	}

	return (
		<div
			style={{
				fontFamily: 'system-ui, -apple-system, sans-serif',
				padding: 14,
				backgroundColor: resolved.background,
				color: resolved.foreground
			}}
		>
			{!readOnly && onSaveMarkdown ? (
				<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
					<button
						type="button"
						onClick={handleSave}
						style={{
							padding: '8px 14px',
							borderRadius: 10,
							border: 'none',
							background: resolved.primary,
							color: resolved.primaryForeground,
							fontSize: 13,
							fontWeight: 600
						}}
					>
						Save Document
					</button>
				</div>
			) : null}
			<EditorContent editor={editor} />
		</div>
	)
}
