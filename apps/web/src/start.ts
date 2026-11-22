import { createStart } from '@tanstack/react-start'

// §6 — authenticated app routes render client-only from the local replica;
// SSR/prerender is reserved for public share + auth pages when they land.
export const startInstance = createStart(() => ({
	defaultSsr: false
}))
