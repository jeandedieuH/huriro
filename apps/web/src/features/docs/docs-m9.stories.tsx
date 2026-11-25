import { activateI18n } from '@huriro/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PageHeaderControls } from './components/page-header-controls'
import { SuggestionReviewPanel } from './components/suggestion-review-panel'

activateI18n('en')

const meta: Meta<typeof PageHeaderControls> = {
	title: 'Docs/M9 Controls & Suggestions',
	component: PageHeaderControls
}
export default meta
type Story = StoryObj<typeof PageHeaderControls>

export const HeaderControls: Story = {
	render: () => (
		<div className="rounded-lg border border-border bg-background">
			<PageHeaderControls
				page={{
					id: '0190a0b1-0000-7000-8000-000000000601',
					workspaceId: '0190a0b1-0000-7000-8000-000000000001',
					parentId: null,
					teamspaceId: null,
					path: '0190a0b1-0000-7000-8000-000000000601',
					depth: 0,
					slug: 'engineering-handbook',
					title: 'Engineering Handbook',
					icon: '📘',
					coverFileId: null,
					coverGradient: 'ocean',
					coverPositionY: 50,
					fontStyle: 'sans',
					fullWidth: false,
					smallText: false,
					isLocked: false,
					lockedBy: null,
					lockedAt: null,
					verificationStatus: 'verified',
					verificationExpiresAt: '2027-02-20T12:00:00Z',
					visibility: 'workspace',
					isTemplate: false,
					isFavorite: true,
					position: 'F',
					createdBy: '0190a0b1-0000-7000-8000-000000000002',
					archivedAt: null,
					createdAt: '2026-11-22T12:00:00Z',
					updatedAt: '2026-11-22T12:00:00Z',
					version: 1,
					byteSize: 512
				}}
				verification={{
					id: '0190a0b1-0000-7000-8000-000000000695',
					workspaceId: '0190a0b1-0000-7000-8000-000000000001',
					pageId: '0190a0b1-0000-7000-8000-000000000601',
					status: 'verified',
					verifiedBy: '0190a0b1-0000-7000-8000-000000000002',
					verifiedAt: '2026-11-22T12:00:00Z',
					expiresAt: '2027-02-20T12:00:00Z',
					note: 'Q4 architecture review',
					createdAt: '2026-11-22T12:00:00Z',
					updatedAt: '2026-11-22T12:00:00Z',
					version: 1
				}}
				canWrite={true}
				canShare={true}
				canVerify={true}
				canPublish={true}
				onUpdateMeta={async () => {}}
				onVerify={async () => {}}
				onClearVerification={async () => {}}
				onExportMarkdown={async () => {}}
				onExportHtml={async () => {}}
				onExportZip={async () => {}}
				onOpenPublish={() => {}}
			/>
		</div>
	)
}

export const NotionHeroHeader: Story = {
	render: function RenderNotionHero() {
		const [title, setTitle] = useState('Engineering Handbook')
		const [icon, setIcon] = useState<string | null>('📘')
		const [cover, setCover] = useState<string | null>('ocean')
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-background">
				<PageHeaderControls
					page={{
						id: '0190a0b1-0000-7000-8000-000000000601',
						workspaceId: '0190a0b1-0000-7000-8000-000000000001',
						parentId: null,
						teamspaceId: null,
						path: '0190a0b1-0000-7000-8000-000000000601',
						depth: 0,
						slug: 'engineering-handbook',
						title,
						icon,
						coverFileId: null,
						coverGradient: cover,
						coverPositionY: 50,
						fontStyle: 'sans',
						fullWidth: false,
						smallText: false,
						isLocked: false,
						lockedBy: null,
						lockedAt: null,
						verificationStatus: 'verified',
						verificationExpiresAt: '2027-02-20T12:00:00Z',
						visibility: 'workspace',
						isTemplate: false,
						isFavorite: true,
						position: 'F',
						createdBy: '0190a0b1-0000-7000-8000-000000000002',
						archivedAt: null,
						createdAt: '2026-11-22T12:00:00Z',
						updatedAt: '2026-11-22T12:00:00Z',
						version: 1,
						byteSize: 512
					}}
					verification={null}
					canWrite={true}
					canShare={true}
					canVerify={true}
					canPublish={true}
					titleDraft={title}
					onTitleChange={setTitle}
					onAddComment={() => {}}
					onUpdateMeta={async (patch) => {
						if (patch.icon !== undefined) setIcon(patch.icon)
						if (patch.coverGradient !== undefined) setCover(patch.coverGradient)
					}}
					onVerify={async () => {}}
					onClearVerification={async () => {}}
					onExportMarkdown={async () => {}}
					onExportHtml={async () => {}}
					onExportZip={async () => {}}
					onOpenPublish={() => {}}
				/>
			</div>
		)
	}
}

export const SuggestionsPanel: Story = {
	render: () => (
		<div className="max-w-sm rounded-lg border border-border bg-card">
			<SuggestionReviewPanel
				suggestions={[
					{
						id: '0190a0b1-0000-7000-8000-000000000701',
						workspaceId: '0190a0b1-0000-7000-8000-000000000001',
						pageId: '0190a0b1-0000-7000-8000-000000000601',
						groupId: 'grp-story-1',
						kind: 'replace',
						authorType: 'user',
						authorId: '0190a0b1-0000-7000-8000-000000000002',
						anchorBlockId: null,
						beforeText: 'eventual sync',
						afterText: 'contiguous transactional sync',
						status: 'open',
						resolvedBy: null,
						resolvedAt: null,
						createdAt: '2026-11-22T12:00:00Z',
						updatedAt: '2026-11-22T12:00:00Z',
						version: 1
					}
				]}
				canWrite={true}
				canComment={true}
				onDecide={async () => {}}
				onDecideAll={async () => {}}
				onPropose={async () => {}}
			/>
		</div>
	)
}
