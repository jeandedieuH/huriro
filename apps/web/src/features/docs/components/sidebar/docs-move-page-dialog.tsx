import type { DocPageDto, TeamspaceDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenTreeForSelect } from './docs-sidebar-tree'

export interface DocsMovePageDialogProps {
	/** Page being moved; `null` keeps the dialog closed. */
	readonly page: DocPageDto | null
	readonly pages: readonly DocPageDto[]
	readonly teamspaces?: readonly TeamspaceDto[] | undefined
	readonly onClose: () => void
	readonly onMove: (page: DocPageDto, parentId: string | null, teamspaceId?: string | null) => Promise<void>
}

export function DocsMovePageDialog({ page, pages, teamspaces, onClose, onMove }: DocsMovePageDialogProps) {
	return (
		<Dialog open={page !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-sm">
				{/* Inner form remounts per page so the selection always starts at the current location. */}
				{page ? (
					<MovePageForm
						key={page.id}
						page={page}
						pages={pages}
						teamspaces={teamspaces}
						onClose={onClose}
						onMove={onMove}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	)
}

interface MovePageFormProps extends Omit<DocsMovePageDialogProps, 'page'> {
	readonly page: DocPageDto
}

const TEAMSPACE_PREFIX = 'teamspace:'

function MovePageForm({ page, pages, teamspaces, onClose, onMove }: MovePageFormProps) {
	const teamspaceList = teamspaces ?? []
	const initialDestination = page.parentId
		? page.parentId
		: page.teamspaceId && teamspaceList.some((ts) => ts.id === page.teamspaceId)
			? `${TEAMSPACE_PREFIX}${page.teamspaceId}`
			: 'root'

	const [nextDestination, setNextDestination] = useState(initialDestination)
	const [busy, setBusy] = useState(false)

	// Depth-first tree order excluding the page and its descendants.
	const flattenedParents = useMemo(() => flattenTreeForSelect(pages, page), [pages, page])
	const showTeamspaces = page.parentId === null && teamspaceList.length > 0
	const unchanged = nextDestination === initialDestination

	async function handleConfirm() {
		setBusy(true)
		if (nextDestination === 'root') {
			await onMove(page, null, page.parentId === null ? null : undefined)
		} else if (nextDestination.startsWith(TEAMSPACE_PREFIX)) {
			await onMove(page, null, nextDestination.slice(TEAMSPACE_PREFIX.length))
		} else {
			await onMove(page, nextDestination)
		}
		setBusy(false)
		onClose()
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>{t('docs.move.title')}</DialogTitle>
			</DialogHeader>
			<Select value={nextDestination} onValueChange={setNextDestination}>
				<SelectTrigger aria-label={t('docs.create.parent-label')}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="root">{t('docs.create.root-option')}</SelectItem>
					{showTeamspaces
						? teamspaceList.map((ts) => (
								<SelectItem key={ts.id} value={`${TEAMSPACE_PREFIX}${ts.id}`}>
									{ts.icon ? `${ts.icon} ` : ''}
									{ts.name}
								</SelectItem>
							))
						: null}
					{flattenedParents.map(({ page: parent, depth }) => (
						<SelectItem key={parent.id} value={parent.id}>
							{'\u00A0\u00A0'.repeat(depth)}
							{parent.icon ? `${parent.icon} ` : ''}
							{parent.title}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<DialogFooter>
				<Button type="button" tone="outline" onClick={onClose}>
					{t('common.cancel')}
				</Button>
				<Button type="button" disabled={unchanged} loading={busy} onClick={() => void handleConfirm()}>
					{t('docs.move.confirm')}
				</Button>
			</DialogFooter>
		</>
	)
}
