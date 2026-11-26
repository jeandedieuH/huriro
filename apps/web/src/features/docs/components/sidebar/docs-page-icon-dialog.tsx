import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageIconPickerPanel } from '../page-icon-picker'

export interface DocsPageIconDialogProps {
	/** Page whose icon is being edited; `null` keeps the dialog closed. */
	readonly page: DocPageDto | null
	readonly onClose: () => void
	readonly onSelect: (page: DocPageDto, icon: string | null) => Promise<void>
}

/** Sidebar-hosted icon chooser — reuses the header picker body inside a dialog. */
export function DocsPageIconDialog({ page, onClose, onSelect }: DocsPageIconDialogProps) {
	return (
		<Dialog open={page !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-sm space-y-3">
				<DialogHeader>
					<DialogTitle>{t('docs.sidebar.change-icon')}</DialogTitle>
				</DialogHeader>
				{page ? (
					<PageIconPickerPanel
						icon={page.icon}
						onSelect={(icon) => {
							void onSelect(page, icon)
							onClose()
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	)
}
