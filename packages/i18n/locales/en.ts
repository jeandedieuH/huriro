/**
 * English source catalog (§17.8) — every user-facing string lives here.
 * New string? Add it here; `bun run gen` rebuilds locales/pseudo.ts and
 * `gen:check` fails CI on drift. `pseudo` is generated, never hand-edited.
 */
export const en = {
	// app shell
	'app.name': 'Huriro',
	'nav.inbox': 'Inbox',
	'nav.tasks': 'Tasks',
	'nav.docs': 'Docs',
	'nav.chat': 'Chat',
	'nav.mail': 'Mail',
	'nav.search': 'Search',
	'nav.settings': 'Settings',
	'shell.new': 'New',
	'shell.command-palette': 'Command palette',
	'shell.profile': 'Profile',
	'shell.skip-to-content': 'Skip to content',
	// components
	'button.loading': 'Loading',
	'empty.title': 'Nothing here yet',
	'empty.hint': 'When items appear, they will show up here.',
	'error.title': 'Something went wrong',
	'error.retry': 'Retry',
	'search.placeholder': 'Search or type a command',
	// setup
	'setup.title': 'Set up your Huriro instance',
	'setup.submit': 'Create instance'
} as const

export type MessageId = keyof typeof en
