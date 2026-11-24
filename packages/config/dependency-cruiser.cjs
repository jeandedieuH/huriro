/**
 * Module-boundary rules (§5.4, §7.2).
 *
 * Enforced invariants:
 *  - no app imports another app
 *  - packages/domain stays pure (no I/O-capable imports, no other workspace packages)
 *  - a server module may not import another module's repo/service/policy internals —
 *    cross-module access goes through the other module's exported service seam
 *  - no circular dependencies anywhere in our code
 *  - server-only packages (@huriro/db) may not be imported by client bundles (apps/web,
 *    apps/mobile) when those exist — rule lives here already so it can't be forgotten
 */

// Server modules and the schema file each one owns in packages/db.
// New module? Add it here AND give it a schema file — one place per kind of code.
const MODULE_SCHEMA_OWNERSHIP = {
	identity: ['identity'],
	tenancy: ['tenancy'],
	tasks: ['tasks'],
	docs: ['docs'],
	chat: ['chat'],
	mail: ['mail'],
	notifications: ['notifications'],
	search: ['search'],
	ai: ['ai'],
	agents: ['agents'],
	imports: ['imports'],
	files: ['files'],
	webhooks: ['webhooks'],
	integrations: ['integrations'],
	billing: ['billing'],
	governance: ['governance'],
	audit: ['audit'],
	sync: ['sync']
}

const modules = Object.keys(MODULE_SCHEMA_OWNERSHIP)

// Backreference rules (apps/(?!\1)...) proved unreliable across cruiser
// versions — enumerate the apps/ directory and emit one rule per app pair so
// "no app imports another app" stays exact and readable in the report.
const fs = require('node:fs')
const path = require('node:path')
const appsDir = path.resolve(__dirname, '../../apps')
const appNames = fs.existsSync(appsDir)
	? fs
			.readdirSync(appsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
	: []
const appPairRules = appNames.flatMap((a) =>
	appNames
		.filter((b) => b !== a)
		.map((b) => ({
			name: `no-app-to-app-${a}-to-${b}`,
			severity: 'error',
			comment: `apps/${a} must not import apps/${b}; shared code lives in packages/* (§7.2)`,
			from: { path: `apps/${a}/` },
			to: { path: `apps/${b}/` }
		}))
)

// For module X: forbid importing db schema files that belong to other modules.
const schemaBoundaryRules = modules.map((mod) => {
	const owned = MODULE_SCHEMA_OWNERSHIP[mod].join('|')
	return {
		name: `module-${mod}-schema-boundary`,
		severity: 'error',
		comment: `modules/${mod} may only use @huriro/db schema files it owns (${MODULE_SCHEMA_OWNERSHIP[mod].join(', ')})`,
		from: { path: `apps/server/src/modules/${mod}/` },
		to: { path: `packages/db/src/schema/(?!${owned}\\.ts)[a-z]+\\.ts` }
	}
})

// For module X: forbid reaching into another module's internals (repo/service/policy).
const moduleInternalRules = modules.map((mod) => {
	const others = modules.filter((m) => m !== mod).join('|')
	return {
		name: `module-${mod}-no-foreign-internals`,
		severity: 'error',
		comment: `modules/${mod} must not import another module's internals; use its exported service (§7.3)`,
		from: { path: `apps/server/src/modules/${mod}/` },
		to: { path: `apps/server/src/modules/(${others})/(repo|policy|service|schema|events)\\.ts` }
	}
})

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'No circular dependencies (§7.2 — they break tree-shaking and reasoning)',
			from: {},
			to: { circular: true }
		},
		{
			name: 'domain-is-pure',
			severity: 'error',
			comment: 'packages/domain is pure: no I/O, no workspace packages, no node builtins (§7.2)',
			from: {
				path: 'packages/domain/src/',
				// Test files may pull in bun:test — dev-only, never shipped.
				pathNot: '\\.test\\.ts$'
			},
			to: {
				path: '^(?!packages/domain/).+',
				pathNot: '\\.(css|json)$'
			}
		},
		{
			name: 'no-server-only-in-clients',
			severity: 'error',
			comment: 'Server-only code must never reach a client bundle (§7.4)',
			from: { path: '(apps/(web|mobile)|packages/(sync-client|editor))/' },
			to: { path: '(packages/(db|test-utils)|apps/server)/' }
		},
		{
			name: 'cli-is-client-only',
			severity: 'error',
			comment:
				'packages/cli ships as the public `huriro` client: only the agent-tools manifest, no server internals (ADR-0021)',
			from: { path: 'packages/cli/' },
			to: { path: '(packages/(db|test-utils|env)|apps/)/' }
		},
		...appPairRules,
		...moduleInternalRules,
		...schemaBoundaryRules
	],
	options: {
		// Generated/bundled artifacts are not source: Nitro output (apps/web/.output),
		// the static Storybook bundle, Expo native build dirs, and TanStack's
		// generated route tree (type-only back-imports by design).
		exclude: { path: '\\.output/|storybook-static/|\\.expo/|android/|ios/|routeTree\\.gen\\.[tj]sx?$' },
		doNotFollow: { path: 'node_modules' },
		tsPreCompilationDeps: true,
		enhancedResolveOptions: {
			exportsFields: ['exports'],
			conditionNames: ['import', 'require', 'default', 'types']
		},
		reporterOptions: {
			text: { highlightFocused: true }
		}
	}
}
