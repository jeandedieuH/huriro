import type { DocSuggestionDto } from '@huriro/contracts'
import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { MemoryReplicaStorage, SyncProvider } from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import { createPreviewWorkspace } from '@/lib/preview-workspace'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { BacklinksSection } from './components/backlinks-section'
import { BlockGutterMenu } from './components/block-gutter-menu'
import { createBookmarkNodeViewExtension } from './components/bookmark-node-view'
import { createButtonNodeViewExtension } from './components/button-node-view'
import { CalloutNodeViewExtension } from './components/callout-node-view'
import { CodeBlockNodeViewExtension } from './components/code-block-node-view'
import { DocPublishDialog } from './components/doc-publish-dialog'
import { EditorShell } from './components/editor-shell'
import { KnowledgeGraphView } from './components/knowledge-graph-view'
import { MathBlockNodeViewExtension, MathInlineNodeViewExtension } from './components/math-node-view'
import { MermaidBlockNodeViewExtension } from './components/mermaid-node-view'
import { PageHeaderControls } from './components/page-header-controls'
import { SuggestionReviewPanel } from './components/suggestion-review-panel'
import { createSyncedBlockNodeViewExtension } from './components/synced-block-node-view'
import { TableToolbar } from './components/table-toolbar'
import { TeamspaceManagerDialog } from './components/teamspace-manager-dialog'
import { TocBlockNodeViewExtension } from './components/toc-node-view'

activateI18n('en')

describe('M9 Docs Notion authoring & wiki surfaces', () => {
	it('renders Mermaid, KaTeX math, ToC, Bookmark, and Button NodeViews with zero axe violations', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return

			const editor = new Editor({
				extensions: createHuriroExtensions({
					collaborative: false,
					nodeViewOverrides: [
						MermaidBlockNodeViewExtension,
						MathBlockNodeViewExtension,
						MathInlineNodeViewExtension,
						TocBlockNodeViewExtension,
						createBookmarkNodeViewExtension(boot.api),
						createButtonNodeViewExtension({ api: boot.api, pageId: page.id }),
						createSyncedBlockNodeViewExtension({
							api: boot.api,
							workspaceId: page.workspaceId,
							pageId: page.id,
							isPreview: true,
							userDisplayName: boot.userDisplayName
						})
					]
				}),
				content: '<p></p>',
				editorProps: { attributes: { 'aria-label': 'M9 test editor' } }
			})

			const { container, unmount } = render(<EditorContent editor={editor} />)
			try {
				await act(async () => {
					editor.commands.setContent({
						type: 'doc',
						content: [
							{
								type: 'heading',
								attrs: { level: 1, blockId: 'h-m9-1' },
								content: [{ type: 'text', text: 'Architecture' }]
							},
							{ type: 'tocBlock', attrs: { maxLevel: 3 } },
							{
								type: 'mermaidBlock',
								attrs: {
									code: 'flowchart TD\n  A[Start] --> B[End]',
									alt: 'Flow',
									viewMode: 'split'
								}
							},
							{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
							{
								type: 'bookmarkCard',
								attrs: {
									url: 'https://example.com',
									title: 'Example Docs',
									description: 'Reference documentation',
									siteName: 'example.com'
								}
							},
							{
								type: 'buttonBlock',
								attrs: {
									buttonId: 'btn-1',
									label: 'Insert checklist',
									actionKind: 'append_template',
									templateMarkdown: '- [ ] Verify'
								}
							}
						]
					})
				})

				await waitFor(
					() => {
						expect(container.querySelector('[data-mermaid-block] svg')).not.toBeNull()
						expect(container.querySelector('[data-math="block"] .katex')).not.toBeNull()
					},
					// Upstream Mermaid is intentionally lazy-loaded and is much heavier than the old subset renderer.
					{ timeout: 10_000 }
				)

				expect(container.querySelector('[data-toc="true"]')).not.toBeNull()
				expect(container.querySelector('[data-bookmark="true"]')).not.toBeNull()
				expect(screen.getByRole('button', { name: 'Insert checklist' })).toBeInTheDocument()

				await act(async () => {
					fireEvent.click(screen.getByRole('button', { name: 'Insert checklist' }))
				})

				expect(editor.getText()).toContain('Verify')
				await expectNoViolations(container)
			} finally {
				unmount()
				editor.destroy()
			}
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders PageHeaderControls, BlockGutterMenu, TableToolbar, and SuggestionReviewPanel cleanly', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return

			const onUpdateMeta = vi.fn(async () => {})
			const onDecide = vi.fn(async () => {})
			const onDecideAll = vi.fn(async () => {})
			const onPropose = vi.fn(async () => {})

			const editor = new Editor({
				extensions: createHuriroExtensions({ collaborative: false }),
				content: '<p>Initial text</p>'
			})

			const suggestions: DocSuggestionDto[] = [
				{
					id: '0190a0b1-0000-7000-8000-000000000701',
					workspaceId: page.workspaceId,
					pageId: page.id,
					groupId: 'grp-1',
					kind: 'replace',
					authorType: 'user',
					authorId: boot.currentUserId,
					anchorBlockId: null,
					beforeText: 'old phrasing',
					afterText: 'crisp phrasing',
					status: 'open',
					resolvedBy: null,
					resolvedAt: null,
					createdAt: '2026-11-22T12:00:00Z',
					updatedAt: '2026-11-22T12:00:00Z',
					version: 1
				}
			]

			const { container, unmount } = render(
				<div>
					<PageHeaderControls
						page={{ ...page, isLocked: true }}
						verification={null}
						canWrite={true}
						canShare={true}
						canVerify={true}
						canPublish={true}
						onUpdateMeta={onUpdateMeta}
						onVerify={async () => {}}
						onClearVerification={async () => {}}
						onExportMarkdown={async () => {}}
						onExportHtml={async () => {}}
						onExportZip={async () => {}}
						onOpenPublish={() => {}}
					/>
					<BlockGutterMenu editor={editor} canWrite={true} />
					<TableToolbar editor={editor} canWrite={true} />
					<SuggestionReviewPanel
						suggestions={suggestions}
						canWrite={true}
						canComment={true}
						onDecide={onDecide}
						onDecideAll={onDecideAll}
						onPropose={onPropose}
					/>
					<BacklinksSection api={boot.api} pageId={page.id} pages={[page]} onSelectSlug={() => {}} />
				</div>
			)

			try {
				expect(screen.getByText('This page is locked for editing.')).toBeInTheDocument()
				fireEvent.click(screen.getByRole('button', { name: 'Unlock page' }))
				expect(onUpdateMeta).toHaveBeenCalledWith({ isLocked: false })

				fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
				expect(onDecide).toHaveBeenCalledWith('grp-1', 'accept')

				await act(async () => {
					editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
				})
				await waitFor(() => {
					expect(screen.getByRole('toolbar', { name: 'Table actions' })).toBeInTheDocument()
				})

				await expectNoViolations(container)
			} finally {
				unmount()
				editor.destroy()
			}
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders TeamspaceManagerDialog, DocPublishDialog, KnowledgeGraphView, and EditorShell with lock & suggestion mode', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return
			const detail = await boot.api.getDocBySlug(page.slug)
			const members = await boot.api.listMembers()

			useUiStore.setState({
				teamspaceManagerOpen: false,
				docPublishOpen: false,
				docsGraphOpen: false
			})

			const onSelectSlug = vi.fn()
			const { unmount } = render(
				<SyncProvider engine={boot.engine}>
					<EditorShell
						detail={detail}
						api={boot.api}
						isPreview={true}
						userDisplayName={boot.userDisplayName}
						currentUserId={boot.currentUserId}
						pages={[page]}
						onSelectSlug={onSelectSlug}
						onUpdateTitle={async () => {}}
						onToggleFavorite={async () => {}}
						onExportMarkdown={async () => {}}
						onSplitPage={async () => {}}
						onStartAnchoredComment={() => {}}
						onHeadingsChange={() => {}}
					/>
					<TeamspaceManagerDialog api={boot.api} members={members} />
					<DocPublishDialog api={boot.api} page={page} />
					<KnowledgeGraphView api={boot.api} onSelectSlug={onSelectSlug} />
				</SyncProvider>
			)

			try {
				const modeToggle = screen.getByRole('button', { name: 'Editing' })
				fireEvent.click(modeToggle)
				expect(screen.getByRole('button', { name: 'Suggesting' })).toBeInTheDocument()

				await act(async () => {
					useUiStore.setState({ teamspaceManagerOpen: true })
				})
				await waitFor(() => {
					expect(screen.getByText('Manage teamspaces')).toBeInTheDocument()
				})

				await act(async () => {
					useUiStore.setState({ teamspaceManagerOpen: false, docPublishOpen: true })
				})
				await waitFor(() => {
					expect(screen.getByText('Publish to web')).toBeInTheDocument()
				})

				await act(async () => {
					useUiStore.setState({ docPublishOpen: false, docsGraphOpen: true })
				})
				await waitFor(() => {
					expect(screen.getByText('Workspace Knowledge Graph')).toBeInTheDocument()
				})
			} finally {
				unmount()
				useUiStore.setState({
					teamspaceManagerOpen: false,
					docPublishOpen: false,
					docsGraphOpen: false
				})
			}
		} finally {
			boot.engine.dispose()
		}
	})

	it('commits cover focal position once on pointer release or blur without spamming updates while dragging', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return

			const onUpdateMeta = vi.fn(async () => {})
			const { unmount } = render(
				<PageHeaderControls
					page={{ ...page, coverGradient: 'ocean', coverPositionY: 50, isLocked: false }}
					verification={null}
					canWrite={true}
					canShare={true}
					canVerify={true}
					canPublish={true}
					onUpdateMeta={onUpdateMeta}
					onVerify={async () => {}}
					onClearVerification={async () => {}}
					onExportMarkdown={async () => {}}
					onExportHtml={async () => {}}
					onExportZip={async () => {}}
					onOpenPublish={() => {}}
				/>
			)

			try {
				const slider = screen.getByRole('slider')
				expect(screen.getByText('Cover focal position (50%)')).toBeInTheDocument()

				fireEvent.pointerDown(slider)
				for (let i = 1; i <= 20; i += 1) {
					const val = Math.round(50 + (i * 30) / 20)
					fireEvent.change(slider, { target: { value: String(val) } })
				}
				expect(screen.getByText('Cover focal position (80%)')).toBeInTheDocument()
				expect(onUpdateMeta).not.toHaveBeenCalled()

				fireEvent.pointerUp(slider)
				await waitFor(() => {
					expect(onUpdateMeta).toHaveBeenCalledTimes(1)
				})
				expect(onUpdateMeta).toHaveBeenLastCalledWith({ coverPositionY: 80 })

				// Dragging away and returning to the persisted value should not commit a no-op mutation.
				fireEvent.pointerDown(slider)
				fireEvent.change(slider, { target: { value: '70' } })
				fireEvent.change(slider, { target: { value: '50' } })
				fireEvent.pointerUp(slider)
				expect(onUpdateMeta).toHaveBeenCalledTimes(1)

				// Keyboard/non-pointer change flushes immediately on blur.
				fireEvent.change(slider, { target: { value: '65' } })
				expect(onUpdateMeta).toHaveBeenCalledTimes(1)
				fireEvent.blur(slider)
				await waitFor(() => {
					expect(onUpdateMeta).toHaveBeenCalledTimes(2)
				})
				expect(onUpdateMeta).toHaveBeenLastCalledWith({ coverPositionY: 65 })
			} finally {
				unmount()
			}
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders Callout & CodeBlock NodeViews and Notion EditorShell hero/settings interactions cleanly', async () => {
		const boot = await createPreviewWorkspace(new MemoryReplicaStorage())
		try {
			const page = boot.engine.collections.docPages.toArray[0]
			expect(page).toBeDefined()
			if (!page) return
			const detail = await boot.api.getDocBySlug(page.slug)

			const nodeEditor = new Editor({
				extensions: createHuriroExtensions({
					collaborative: false,
					nodeViewOverrides: [CalloutNodeViewExtension, CodeBlockNodeViewExtension]
				}),
				content: '<p></p>',
				editorProps: { attributes: { 'aria-label': 'Callout and code test editor' } }
			})

			const writeText = vi.fn(async () => {})
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText }
			})

			const nvRender = render(<EditorContent editor={nodeEditor} />)
			try {
				await act(async () => {
					nodeEditor.commands.setContent({
						type: 'doc',
						content: [
							{
								type: 'callout',
								attrs: { tone: 'info' },
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Important note' }] }]
							},
							{
								type: 'codeBlock',
								attrs: { language: 'typescript' },
								content: [{ type: 'text', text: 'const x: number = 1' }]
							}
						]
					})
				})
				await waitFor(() => {
					expect(nvRender.container.querySelector('[data-callout="true"]')).not.toBeNull()
					expect(nvRender.container.querySelector('[data-code-block="true"]')).not.toBeNull()
				})

				fireEvent.click(screen.getByRole('button', { name: 'Callout style' }))
				const warningOption = await screen.findByRole('button', { name: 'Warning' })
				fireEvent.click(warningOption)
				expect(nodeEditor.getJSON().content?.[0]?.attrs?.['tone']).toBe('warning')

				await act(async () => {
					fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
				})
				expect(writeText).toHaveBeenCalledWith('const x: number = 1')

				await expectNoViolations(nvRender.container)
			} finally {
				nvRender.unmount()
				nodeEditor.destroy()
			}

			const onUpdateMeta = vi.fn(async () => {})
			const onUpdateTitle = vi.fn(async () => {})
			const shellRender = render(
				<SyncProvider engine={boot.engine}>
					<EditorShell
						detail={detail}
						api={boot.api}
						isPreview={true}
						userDisplayName={boot.userDisplayName}
						currentUserId={boot.currentUserId}
						pages={[page]}
						onUpdateTitle={onUpdateTitle}
						onToggleFavorite={async () => {}}
						onExportMarkdown={async () => {}}
						onUpdatePageMeta={onUpdateMeta}
						onSplitPage={async () => {}}
						onStartAnchoredComment={() => {}}
						onHeadingsChange={() => {}}
					/>
				</SyncProvider>
			)
			try {
				// Canvas title editing + Enter commits and focuses editor
				const titleInput = screen.getByLabelText('Title')
				fireEvent.change(titleInput, { target: { value: 'Updated Notion Title' } })
				fireEvent.keyDown(titleInput, { key: 'Enter' })
				expect(onUpdateTitle).toHaveBeenCalledWith('Updated Notion Title')

				// Page settings popover typography & layout switches
				fireEvent.click(screen.getByRole('button', { name: 'Page settings' }))
				const serifBtn = await screen.findByRole('button', { name: /Serif/i })
				fireEvent.click(serifBtn)
				expect(onUpdateMeta).toHaveBeenCalledWith({ fontStyle: 'serif' })

				const fullWidthSwitch = screen.getByRole('switch', { name: 'Full width' })
				fireEvent.click(fullWidthSwitch)
				expect(onUpdateMeta).toHaveBeenCalledWith({ fullWidth: !detail.page.fullWidth })

				await expectNoViolations(shellRender.container)
			} finally {
				shellRender.unmount()
			}
		} finally {
			boot.engine.dispose()
		}
	})
})
