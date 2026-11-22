/**
 * Booted workspace context: the sync engine + HTTP/preview API bridge resolved
 * once by `bootstrapWorkspace()` in `__root`. Route components read it via
 * `useWorkspace()` instead of prop-drilling through the Outlet.
 */
import { createContext, type ReactNode, useContext } from 'react'
import type { BootstrappedWorkspace } from './sync-bootstrap'

const WorkspaceContext = createContext<BootstrappedWorkspace | null>(null)

export function WorkspaceProvider({
	boot,
	children
}: {
	readonly boot: BootstrappedWorkspace
	readonly children: ReactNode
}) {
	return <WorkspaceContext.Provider value={boot}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): BootstrappedWorkspace {
	const boot = useContext(WorkspaceContext)
	if (!boot) throw new Error('useWorkspace must be used inside WorkspaceProvider')
	return boot
}
