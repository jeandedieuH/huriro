import type { DocDatabaseRowDto, IssueDto, MailConversationDto } from '@huriro/contracts'
import { createContext, useContext } from 'react'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'

export interface DatabaseWorkspaceContextValue {
	readonly allRows: readonly DocDatabaseRowDto[]
	readonly issues: readonly IssueDto[]
	readonly mailConversations: readonly MailConversationDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly uploadFile: TaskApiBridge['uploadFile'] | null
}

const DatabaseWorkspaceContext = createContext<DatabaseWorkspaceContextValue>({
	allRows: [],
	issues: [],
	mailConversations: [],
	members: [],
	uploadFile: null
})

export const DatabaseWorkspaceContextProvider = DatabaseWorkspaceContext.Provider

/** Cell editors use the workspace context for relation targets and people so
 * individual virtualized rows do not each need to hydrate a server scope. */
export function useDatabaseWorkspaceContext() {
	return useContext(DatabaseWorkspaceContext)
}
