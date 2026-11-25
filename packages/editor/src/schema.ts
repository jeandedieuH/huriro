import { type AnyExtension, type Extensions, getSchema } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import type * as Y from 'yjs'
import {
	BlockIdExtension,
	BlockStyleExtension,
	BookmarkCardExtension,
	ButtonBlockExtension,
	CalloutExtension,
	ColumnExtension,
	ColumnsExtension,
	CommentAnchorMark,
	EmbedExtension,
	EntityMentionExtension,
	HuriroTableCell,
	HuriroTableHeader,
	MathBlockExtension,
	MathInlineExtension,
	MermaidBlockExtension,
	ReferenceBlockExtension,
	type SuggestionAuthorType,
	SuggestionDeleteMark,
	SuggestionInsertMark,
	SuggestionModeExtension,
	SyncedBlockExtension,
	TableUpgradesExtension,
	TocBlockExtension,
	ToggleExtension,
	ToggleHeadingExtension
} from './extensions'
import { isSafeUrl } from './sanitize'

export const DOCUMENT_SIZE_WARN_BYTES = 2 * 1024 * 1024 // 2 MB (§10.2)
export const DOCUMENT_SIZE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB (§10.2)

const lowlight = createLowlight(common)

export const HuriroCodeBlockExtension = CodeBlockLowlight.configure({
	lowlight
})

export interface HuriroExtensionsOptions {
	readonly collaborative?: boolean | undefined
	readonly ydoc?: Y.Doc | undefined
	readonly field?: string | undefined
	readonly provider?: unknown | undefined
	readonly user?: { readonly name: string; readonly color: string; readonly userId?: string } | undefined
	readonly placeholder?: string | undefined
	/** Localized node-view labels for the collapsible toggle (§17.8). */
	readonly toggleLabels?: { readonly arrow: string; readonly summary: string } | undefined
	readonly suggestionAuthor?:
		| { readonly authorType: SuggestionAuthorType; readonly authorId: string }
		| undefined
	/** Optional app-level extensions replacing matching extension names (e.g. React NodeViews). */
	readonly nodeViewOverrides?: readonly AnyExtension[] | undefined
}

export function createHuriroExtensions(options: HuriroExtensionsOptions = {}): Extensions {
	const collaborative = options.collaborative ?? Boolean(options.ydoc)
	const overrideByName = new Map((options.nodeViewOverrides ?? []).map((ext) => [ext.name, ext]))

	const pick = <T extends AnyExtension>(base: T): AnyExtension => overrideByName.get(base.name) ?? base

	const extensions: Extensions = [
		StarterKit.configure({
			undoRedo: collaborative ? false : {},
			codeBlock: false,
			link: {
				openOnClick: false,
				autolink: true,
				isAllowedUri: (url) => isSafeUrl(url)
			}
		}),
		pick(HuriroCodeBlockExtension),
		Table.configure({
			resizable: true
		}),
		TableRow,
		HuriroTableHeader,
		HuriroTableCell,
		TableUpgradesExtension,
		TaskList,
		TaskItem.configure({
			nested: true
		}),
		Image.configure({
			allowBase64: false
		}),
		Placeholder.configure({
			placeholder: ({ node }) => {
				if (node.type.name === 'heading') {
					const level = Number(node.attrs['level'] ?? 1)
					if (level === 1) return 'Heading 1'
					if (level === 2) return 'Heading 2'
					if (level === 3) return 'Heading 3'
				}
				return options.placeholder ?? "Write something, type '/' for commands…"
			}
		}),
		BlockIdExtension,
		BlockStyleExtension,
		ColumnExtension,
		ColumnsExtension,
		pick(CalloutExtension),
		ToggleExtension.configure({
			arrowLabel: options.toggleLabels?.arrow ?? 'Toggle collapsible section',
			summaryLabel: options.toggleLabels?.summary ?? 'Collapsible section title'
		}),
		ToggleHeadingExtension.configure({
			arrowLabel: options.toggleLabels?.arrow ?? 'Toggle heading section',
			summaryLabel: options.toggleLabels?.summary ?? 'Toggle heading title'
		}),
		EntityMentionExtension,
		pick(EmbedExtension),
		ReferenceBlockExtension,
		pick(SyncedBlockExtension),
		pick(MermaidBlockExtension),
		pick(MathInlineExtension),
		pick(MathBlockExtension),
		pick(TocBlockExtension),
		pick(BookmarkCardExtension),
		pick(ButtonBlockExtension),
		CommentAnchorMark,
		SuggestionInsertMark,
		SuggestionDeleteMark,
		SuggestionModeExtension.configure({
			enabled: false,
			authorType: options.suggestionAuthor?.authorType ?? 'user',
			authorId: options.suggestionAuthor?.authorId ?? options.user?.userId ?? ''
		})
	]

	if (options.ydoc) {
		extensions.push(
			Collaboration.configure({
				document: options.ydoc,
				field: options.field ?? 'default'
			})
		)
	}

	if (options.provider && options.user) {
		extensions.push(
			CollaborationCaret.configure({
				provider: options.provider,
				user: options.user
			})
		)
	}

	return extensions
}

let cachedSchema: Schema | null = null

export function createHeadlessProseMirrorSchema(): Schema {
	if (!cachedSchema) {
		cachedSchema = getSchema(createHuriroExtensions({ collaborative: false }))
	}
	return cachedSchema
}
