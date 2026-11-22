import { isChangeOrigin } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { filterSlashItems, type SlashItem } from './slash-items'

interface SlashCommandListHandle {
	onKeyDown(props: SuggestionKeyDownProps): boolean
}

/**
 * Floating block picker rendered by the "/" suggestion. Lives outside React's
 * tree (ReactRenderer) and is positioned by the plugin's Floating-UI mount.
 */
export const SlashCommandList = forwardRef<SlashCommandListHandle, SuggestionProps<SlashItem, SlashItem>>(
	function SlashCommandList({ items, query, command }, ref) {
		const [selectedIndex, setSelectedIndex] = useState(0)
		const listRef = useRef<HTMLDivElement>(null)

		// Re-highlight the first result whenever the query re-filters the list.
		const [lastQuery, setLastQuery] = useState(query)
		if (lastQuery !== query) {
			setLastQuery(query)
			setSelectedIndex(0)
		}

		// Keep the highlighted option visible while arrowing through the list.
		useEffect(() => {
			listRef.current?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
		}, [selectedIndex])

		useImperativeHandle(
			ref,
			() => ({
				onKeyDown({ event }) {
					if (items.length === 0) return false
					if (event.key === 'ArrowUp') {
						setSelectedIndex((index) => (index + items.length - 1) % items.length)
						return true
					}
					if (event.key === 'ArrowDown') {
						setSelectedIndex((index) => (index + 1) % items.length)
						return true
					}
					if (event.key === 'Enter') {
						const item = items[selectedIndex]
						if (item) command(item)
						return true
					}
					return false
				}
			}),
			[items, selectedIndex, command]
		)

		if (items.length === 0) {
			return (
				<div className="w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
					{t('docs.slash.empty')}
				</div>
			)
		}

		return (
			<div
				ref={listRef}
				role="listbox"
				aria-label={t('docs.slash.title')}
				className="max-h-72 w-56 space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
			>
				{items.map((item, index) => {
					const Icon = item.icon
					const selected = index === selectedIndex
					return (
						<button
							key={item.id}
							type="button"
							role="option"
							aria-selected={selected}
							// Prevent the editor losing focus before the click lands.
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => command(item)}
							onMouseMove={() => {
								if (!selected) setSelectedIndex(index)
							}}
							className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs ${
								selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground'
							}`}
						>
							<Icon className="size-3.5 text-muted-foreground" aria-hidden />
							<span>{item.label}</span>
						</button>
					)
				})}
			</div>
		)
	}
)

/**
 * TipTap extension that opens SlashCommandList when the user types "/".
 * Web-side by design — @huriro/editor stays headless and React-free.
 */
export function createSlashCommandExtension() {
	return Extension.create({
		name: 'huriroSlashCommand',

		addProseMirrorPlugins() {
			return [
				Suggestion<SlashItem, SlashItem>({
					editor: this.editor,
					pluginKey: new PluginKey('huriroSlashCommand'),
					char: '/',
					items: ({ query }) => filterSlashItems(query),
					// The selected item deletes the "/query" text then inserts its block.
					command: ({ editor, range, props: item }) => item.apply(editor, range),
					// Only open for locally-typed "/" — remote collab transactions (which
					// carry the ySyncPluginKey meta) must never trigger a local popup.
					shouldShow: ({ transaction }) => !isChangeOrigin(transaction),
					// Read-only viewers get no insert affordance.
					allow: ({ editor }) => editor.isEditable,
					render: () => {
						let renderer: ReactRenderer | undefined
						let unmount: (() => void) | undefined

						return {
							onStart: (props) => {
								renderer = new ReactRenderer(SlashCommandList, { editor: props.editor, props })
								unmount = props.mount(renderer.element)
							},
							onUpdate: (props) => {
								renderer?.updateProps(props)
							},
							onKeyDown: (props) =>
								(renderer?.ref as SlashCommandListHandle | null | undefined)?.onKeyDown(props) ?? false,
							onExit: () => {
								unmount?.()
								unmount = undefined
								renderer?.destroy()
								renderer = undefined
							}
						}
					}
				})
			]
		}
	})
}
