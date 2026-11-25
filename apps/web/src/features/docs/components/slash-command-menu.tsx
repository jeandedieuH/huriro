import { isChangeOrigin } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
	filterSlashItems,
	getSlashCategoryLabel,
	SLASH_CATEGORY_ORDER,
	type SlashCategory,
	type SlashItem
} from './slash-items'

interface SlashCommandListHandle {
	onKeyDown(props: SuggestionKeyDownProps): boolean
}

interface GroupedSlashEntry {
	readonly item: SlashItem
	readonly flatIndex: number
}

interface SlashGroup {
	readonly category: SlashCategory
	readonly entries: readonly GroupedSlashEntry[]
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

		const { orderedItems, groups } = useMemo(() => {
			const byCat = new Map<SlashCategory, SlashItem[]>()
			for (const cat of SLASH_CATEGORY_ORDER) byCat.set(cat, [])
			for (const item of items) {
				byCat.get(item.category)?.push(item)
			}
			const flat: SlashItem[] = []
			const grouped: SlashGroup[] = []
			for (const cat of SLASH_CATEGORY_ORDER) {
				const list = byCat.get(cat) ?? []
				if (list.length === 0) continue
				const entries: GroupedSlashEntry[] = []
				for (const item of list) {
					entries.push({ item, flatIndex: flat.length })
					flat.push(item)
				}
				grouped.push({ category: cat, entries })
			}
			return { orderedItems: flat, groups: grouped }
		}, [items])

		// Keep the highlighted option visible while arrowing through the list.
		useEffect(() => {
			const activeEl = listRef.current?.querySelector(`[data-slash-index="${selectedIndex}"]`)
			if (activeEl instanceof HTMLElement) {
				activeEl.scrollIntoView({ block: 'nearest' })
			}
		}, [selectedIndex])

		useImperativeHandle(
			ref,
			() => ({
				onKeyDown({ event }) {
					if (orderedItems.length === 0) return false
					if (event.key === 'ArrowUp') {
						setSelectedIndex((index) => (index + orderedItems.length - 1) % orderedItems.length)
						return true
					}
					if (event.key === 'ArrowDown') {
						setSelectedIndex((index) => (index + 1) % orderedItems.length)
						return true
					}
					if (event.key === 'Enter') {
						const item = orderedItems[selectedIndex]
						if (item) command(item)
						return true
					}
					return false
				}
			}),
			[orderedItems, selectedIndex, command]
		)

		if (orderedItems.length === 0) {
			return (
				<div className="w-72 rounded-xl border border-border/90 bg-popover/98 px-3 py-2.5 text-xs text-muted-foreground shadow-(--shadow-3) backdrop-blur-md">
					{t('docs.slash.empty')}
				</div>
			)
		}

		return (
			<div
				ref={listRef}
				role="listbox"
				aria-label={t('docs.slash.title')}
				className="max-h-88 w-80 overflow-y-auto rounded-xl border border-border/90 bg-popover/98 p-1.5 text-popover-foreground shadow-(--shadow-3) backdrop-blur-md"
			>
				{groups.map((group) => (
					<fieldset key={group.category} className="m-0 border-0 p-0 py-1 first:pt-0 last:pb-0">
						<legend className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							{getSlashCategoryLabel(group.category)}
						</legend>
						<div className="space-y-0.5">
							{group.entries.map(({ item, flatIndex }) => {
								const Icon = item.icon
								const selected = flatIndex === selectedIndex
								return (
									<button
										key={item.id}
										type="button"
										role="option"
										aria-selected={selected}
										aria-label={item.label}
										data-slash-index={flatIndex}
										// Prevent the editor losing focus before the click lands.
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => command(item)}
										onMouseMove={() => {
											if (!selected) setSelectedIndex(flatIndex)
										}}
										className={cn(
											'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
											selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
										)}
									>
										<span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shadow-(--shadow-1)">
											<Icon className="size-4" aria-hidden />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-xs font-medium text-foreground">{item.label}</span>
											<span className="block truncate text-[11px] text-muted-foreground">
												{item.description}
											</span>
										</span>
										{item.shortcut ? (
											<kbd className="shrink-0 rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
												{item.shortcut}
											</kbd>
										) : null}
									</button>
								)
							})}
						</div>
					</fieldset>
				))}
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
