// One-off migration: split master-development-plan.md into docs/plan/<section>.md
// per the plan-hygiene requirement (§23.5). Run once at M0 start: `bun scripts/split-plan.ts`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const source = readFileSync(join(root, 'master-development-plan.md'), 'utf8')
const lines = source.split('\n')

interface Section {
	readonly file: string
	readonly title: string
	readonly start: number // 1-based, inclusive
}

// Ordered boundaries discovered from the monolith (verified against `^## ` headings).
const sections: Section[] = [
	{ file: '01-executive-summary.md', title: 'Executive Summary', start: 51 },
	{ file: '02-product-definition.md', title: 'Product Definition & Scope', start: 102 },
	{
		file: '03-original-sketch-review.md',
		title: 'What We Keep, Change, and Reject From the Original Sketch',
		start: 169
	},
	{ file: '04-engineering-principles.md', title: 'Engineering Principles & Non-Negotiables', start: 194 },
	{ file: '05-architecture-overview.md', title: 'Architecture Overview', start: 240 },
	{ file: '06-technology-stack.md', title: 'Technology Stack & Version Policy', start: 377 },
	{ file: '07-monorepo-code-organization.md', title: 'Monorepo & Code Organization', start: 456 },
	{ file: '08-data-architecture.md', title: 'Data Architecture', start: 555 },
	{ file: '09-sync-realtime-offline.md', title: 'Sync, Real-Time & Offline', start: 950 },
	{ file: '10-collaborative-documents.md', title: 'Collaborative Documents', start: 1162 },
	{ file: '11-search-retrieval-ai.md', title: 'Search, Retrieval & AI', start: 1237 },
	{ file: '12-security-multi-tenancy.md', title: 'Security & Multi-Tenancy', start: 1344 },
	{ file: '13-ai-agents-mcp.md', title: 'AI Agents & MCP', start: 1544 },
	{ file: '14-mail-shared-inbox.md', title: 'Mail (Shared Inbox)', start: 1654 },
	{ file: '15-chat-notifications-presence.md', title: 'Chat, Notifications & Presence', start: 1858 },
	{ file: '16-api-design-contracts.md', title: 'API Design & Contracts', start: 1973 },
	{ file: '17-ui-ux-system.md', title: 'UI/UX System', start: 2048 },
	{ file: '18-client-platform-strategy.md', title: 'Client Platform Strategy', start: 2346 },
	{ file: '19-infrastructure-delivery.md', title: 'Infrastructure, Environments & Delivery', start: 2397 },
	{ file: '20-observability-reliability.md', title: 'Observability & Reliability', start: 2589 },
	{ file: '21-testing-quality-gates.md', title: 'Testing Strategy & Quality Gates', start: 2633 },
	{
		file: '22-privacy-compliance-governance.md',
		title: 'Privacy, Compliance & Data Governance',
		start: 2691
	},
	{ file: '23-roadmap-milestones.md', title: 'Roadmap, Milestones & Exit Criteria', start: 2749 },
	{ file: '24-risk-register-decisions.md', title: 'Risk Register & Open Decisions', start: 2893 },
	{ file: '25-appendix-a-defects.md', title: 'Appendix A — Defects in the Original Sketch', start: 2948 },
	{ file: '26-appendix-b-sources.md', title: 'Appendix B — Sources', start: 2996 },
	{ file: '27-appendix-c-revision-log.md', title: 'Appendix C — Revision log (v1.0 → v1.1)', start: 3083 }
]

const END = lines.length // 3118

// Promote markdown headings one level (`## X` → `# X`), skipping fenced code blocks.
function promoteHeadings(text: string): string {
	let inFence = false
	return text
		.split('\n')
		.map((line) => {
			if (/^```/.test(line.trimStart())) inFence = !inFence
			if (inFence || !line.startsWith('#')) return line
			return line.replace(/^(#{2,6}) /, (_m, hashes: string) => `${hashes.slice(1)} `)
		})
		.join('\n')
}

const outDir = join(root, 'docs', 'plan')
mkdirSync(outDir, { recursive: true })

for (let i = 0; i < sections.length; i++) {
	const s = sections[i]!
	const end = i + 1 < sections.length ? sections[i + 1]!.start - 1 : END
	// Drop the leading `## ` from the section heading, keep the body verbatim.
	const body = lines
		.slice(s.start - 1, end)
		.join('\n')
		.replace(/\n---\s*$/, '')
		.trimEnd()
	writeFileSync(join(outDir, s.file), `${promoteHeadings(body)}\n`)
	console.log(`wrote ${s.file} (lines ${s.start}-${end})`)
}

// Index: front matter (lines 1-18) + a regenerated table of contents.
const frontMatter = lines.slice(0, 18).join('\n').trimEnd()
const toc = sections.map((s, i) => `${i + 1}. [${s.title}](./${s.file})`).join('\n')

writeFileSync(
	join(outDir, 'README.md'),
	`${frontMatter}

> **Working copy.** This plan is maintained as one file per section (§23.5 "plan hygiene").
> Edit the section file, not the monolith. \`master-development-plan.md\` at the repo root is
> the original v1.1 document, kept for reference and superseded by these files.

## Table of Contents

${toc}
`
)
console.log('wrote README.md')
