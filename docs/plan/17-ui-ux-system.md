# 17. UI/UX System

> The product's differentiator is not the feature list — competitors have the same features. It is **speed of thought**: the app must feel like a native instrument. Every decision below serves that.

## 17.1 Experience principles

1. **Latency is a design material.** Local writes render in ≤ 1 frame; nothing waits on the network that the user already knows the answer to. (NN/g's 0.1 s "instantaneous", 1 s "flow", 10 s "attention" limits are the budget, see Appendix B.)
2. **Density with air.** Show more per screen, but with a strict rhythm: one dominant column, one subordinate panel, generous line height in prose, tight rows in tables.
3. **Keyboard is the primary input; pointer is the discovery mechanism.** Every action reachable by keyboard, every shortcut discoverable in the UI (not buried in docs).
4. **One canonical place per concept.** Inbox is _your_ triage, Issues is issues, Docs is docs, Chat is chat. Cross-linking is a feature; duplication of surfaces is not.
5. **Optimistic, reversible, explained.** Every mutation is instant, undoable where feasible (`Mod+Z` toast with 5 s window), and failures are specific.
6. **No dead ends.** Every empty state teaches; every error offers a next step; every permission denial explains who can grant it.
7. **Respect the user's context.** Restore scroll, filters, and open panels on back navigation; never reset the nav stack.
8. **Accessible by construction, not audit.** WCAG 2.2 AA is the floor, built into components, not patched later.

## 17.2 Information architecture

```text
Workspace
├── Inbox        (two sidebar groups:
│                  For me  — notifications · mentions · assigned to me · agent approvals
│                  Shared  — one entry per shared mail inbox (Support, Sales…), only for its members)
├── Issues       (projects → views: Board · List · Timeline · Backlog · My work)
├── Docs         (page tree; pinned/favorites; templates)
├── Chat         (channels; DMs; threads)
└── Settings     (workspace: members/roles, integrations, mail accounts,
                  AI & agents, billing · personal: profile, notifications,
                  shortcuts, appearance, connected apps)
```

Navigation laws:

- **Five primary destinations**, no more: Inbox · Issues · Docs · Chat · Settings. "My work" is a **default saved view** inside Issues (also one palette action away), not a sixth destination.
- **Personal triage and customer mail are separate groups inside Inbox** (changed in v1.1). v1.0 merged them into one list, which would bury an engineer's mentions under support traffic and show mail UI to people with no mail access. A conversation _assigned to you_ appears in both places; everything else stays in its shared inbox.
- **Agents are visible, not hidden.** Agent activity uses the same timeline components as people, with an agent badge and "on behalf of" attribution; _Inbox → For me → Approvals_ holds R2 requests (§13.5).
- **Contextual sidebar** per destination (projects list under Issues; page tree under Docs; channels under Chat) — consistent position across destinations.
- **Right panel** is reserved for _detail of the selected thing_ (issue properties, doc comments, mail metadata) and is toggleable with `Mod+J`, remembered per destination.
- **Breadcrumbs** appear once nesting exceeds two levels (Docs, settings pages).
- **Deep links everywhere:** every issue, doc, message, and conversation has a stable URL that restores the exact view.

## 17.3 App shell and layout

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ ① top bar: workspace switcher · global search (Mod+K) · create · account  │ 48px
├──────────┬───────────────────────────────────────────┬────────────────────┤
│ ② nav    │ ③ view header: title · view tabs · filters │ ④ detail panel     │
│ 220px    │───────────────────────────────────────────│ 320–420px (opt)    │
│          │ ⑤ content (virtualized lists / editor)     │                    │
│          │                                            │                    │
└──────────┴───────────────────────────────────────────┴────────────────────┘
```

- **Grid:** 4 px base unit; spacing scale 4/8/12/16/24/32/48/64. Sidebar 220–280 px (resizable, persisted), detail panel 320–420 px, content max-width 72 ch for prose, full-bleed for boards.
- **Row heights (density setting):** comfortable 36 px, compact 32 px, dense 28 px. Default compact for power users, comfortable for new users.
- **Fixed chrome, scrolling content:** sidebar and headers stay; only the content column scrolls. The tab bar is sticky and shows unsaved/pending indicators.
- **Split view:** issues can open beside the list (peek panel) on ≥ 1280 px; full-page on smaller screens. Never a modal for primary navigation.
- **Multi-tab (desktop/PWA):** tabs are a first-class concept (`Mod+T`), restoring with history and scroll position.

## 17.4 Design tokens

Single source of truth: **DTCG-format JSON** (2025.10 stable spec) in `packages/design-tokens/tokens/*.json`, compiled by Style Dictionary to:

1. `css/*.css` (CSS custom properties),
2. `tailwind/theme.css` (`@theme` block for Tailwind v4 utilities),
3. `rn/theme.ts` (React Native theme object),
4. `docs/tokens.html` (a living reference page).

**Color model:** OKLCH for perceptual uniformity — lightness steps look even across hues, and a dark theme is a lightness remap rather than an inversion. Semantic layers, never raw palette values in components:

```css
@import "tailwindcss";

/* Layer 1 — primitives (raw ramp, generated in OKLCH) */
@theme {
  --color-brand-50:  oklch(0.97 0.015 12.21);
  --color-brand-500: oklch(0.6656 0.2067 12.21);
  --color-brand-600: oklch(0.575 0.215 12.21);
  --color-neutral-0: oklch(1.00 0 0);
  --color-neutral-50: oklch(0.98 0.002 265);
  /* … */
}

/* Layer 2 — semantic roles (what components use) */
@theme inline {
  --color-surface-0: var(--color-neutral-0);
  --color-surface-1: var(--color-neutral-50);
  --color-surface-2: var(--color-neutral-50);
  --color-ink-primary: oklch(0.24 0.01 265);
  --color-ink-secondary: oklch(0.45 0.01 265);
  --color-ink-tertiary: oklch(0.58 0.01 265);
  --color-border-subtle: oklch(0.92 0.005 265);
  --color-border-strong: oklch(0.84 0.006 265);
  --color-accent: var(--color-brand-600);
  --color-accent-ink: oklch(0.99 0 0);
  --color-danger: oklch(0.58 0.20 27);
  --color-success: oklch(0.60 0.15 150);
  --color-warning: oklch(0.75 0.15 80);
}

/* Layer 3 — themes are just overrides of layer 2 */
[data-theme="dark"] {
  --color-surface-0: oklch(0.19 0.006 265);
  --color-surface-1: oklch(0.22 0.007 265);
  --color-surface-2: oklch(0.26 0.008 265);
  --color-ink-primary: oklch(0.96 0.003 265);
  --color-ink-secondary: oklch(0.82 0.004 265);
  --color-border-subtle: oklch(0.30 0.008 265);
  --color-accent: oklch(0.72 0.17 12.21);   /* lighter for dark surfaces */
}
```

**Emit the shadcn contract, then extend it (added in v1.1).** The example above shows the _design_ layers; the build emits them under the variable names shadcn/ui components already consume — `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1…5`, `--sidebar-*` (each with its `-foreground` pair) — plus Huriro extensions (`--surface-2`, `--ink-tertiary`, `--success`, `--warning`, `--info`, density and motion tokens). Two naming traps: shadcn's `--accent` is the _hover/selected surface_, so the brand color is `--primary`, never `--accent`; and dark mode uses shadcn's `.dark` class (Tailwind v4 `@custom-variant dark`), not a `data-theme` attribute. Staying on the contract means `npx shadcn add` and registry blocks work unmodified, and the same tokens compile to the Uniwind theme for HeroUI Native.

**Contrast control:** expose a three-step _contrast_ preference (standard / high / maximum), implemented as an additional token layer (mirroring the technique of generating themes from `base`, `accent`, and `contrast` inputs). High-contrast themes are a product feature, not a niche setting — they are also the answer to 1.4.6 AAA ambitions.

**Non-color tokens:** type scale (12/13/14/16/20/24/32 with 1.25 ratio for UI, 1.5 line height for prose), radii (4/6/8/12/full), elevation (0/1/2/3 as layered shadows, not blur-only), motion (durations 120/180/240 ms; easings `standard`, `enter`, `exit`), focus ring (2 px outline, 2 px offset, 3:1 against both adjacent colors), and z-index scale (0/10/20/40/100/1000).

**Typography:** a variable UI sans (Inter-family or similar) with `font-feature-settings: "cv05","ss01","tnum"` where appropriate; **tabular figures for all IDs, counts, timestamps, and table numerics**; monospace for code and identifiers; prose measure capped at 72 ch; UI text never below 12 px with 4.5:1 contrast, body 14–16 px.

## 17.5 Component inventory (owned code, not a black-box dependency)

| Group       | Components                                                                                                                                                                                                   |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives  | Button, IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Slider, Tooltip, Popover, Dialog, Drawer/Sheet, Menu, ContextMenu, Tabs, Toast, Badge, Avatar, Separator, Progress, Skeleton |
| Data        | DataTable (sortable, virtualized, column resize/reorder, `aria-sort`), VirtualList, EmptyState, ErrorState, Pagination (cursor), FilterBar, FacetedFilter, Kbd                                               |
| Work        | IssueRow, IssueCard (board), Board (drag + keyboard move), Timeline (zoomable lanes), StatusPicker, AssigneePicker, LabelPicker, PriorityIcon, MentionPicker, ReactionBar                                    |
| Docs        | EditorShell, SlashMenu, FloatingToolbar, CommentThread, PresenceCursors, VersionTimeline, TocRail                                                                                                            |
| Chat        | ChannelList, MessageList (virtualized, grouped by author/time), Composer (with mentions, attachments, drafts), ThreadPanel, TypingIndicator                                                                  |
| Mail        | ConversationList, ConversationTimeline, MessageCard (sandboxed body), ReplyComposer, AssigneeControl, SnoozeMenu, CollisionAvatars                                                                           |
| Search      | CommandPalette, SearchResults (grouped, keyboard-navigable), HighlightedSnippet                                                                                                                              |
| Agents & AI | AgentBadge, AgentActivityItem, ApprovalCard (diff-style preview of what will change), AssistantPanel (built on shadcn **AI Elements**: streamed message, tool-call trace, citations), ConnectedAppsList      |
| Onboarding  | SetupWizard (instance), WorkspaceWizard, ImportFlow (source → mapping → dry-run preview → import → report), ChecklistCard                                                                                    |
| Settings    | SettingsNav, RoleMatrix, MemberTable, InviteDialog, ApiKeyList, ConnectedAppsList                                                                                                                            |

**Component contract rules:**

- Props are semantic (`tone="danger"`), never visual (`color="red"`).
- Every component documents its states: default, hover, focus-visible, active, disabled, read-only, loading, error, empty.
- Every interactive component ships with a Storybook story **and** an interaction test (Testing Library) **and** an axe assertion.
- Focus management is part of the component API (`initialFocus`, `returnFocus`), not the caller's afterthought.

## 17.6 Keyboard model

| Scope  | Shortcut                                  | Action                                                  |
| :----- | :---------------------------------------- | :------------------------------------------------------ |
| Global | `Mod+K`                                   | Command palette (search + actions)                      |
| Global | `?`                                       | Shortcut reference sheet (contextual)                   |
| Global | `Mod+J`                                   | Toggle detail panel                                     |
| Global | `C`                                       | Create in current context (issue/doc/message)           |
| Global | `G` then `I/T/D/C/S`                      | Go to Inbox / Issues / Docs / Chat / Settings           |
| Global | `Mod+Enter`                               | Submit the active form/composer                         |
| Global | `Esc`                                     | Dismiss popover/dialog/panel (in that order)            |
| Lists  | `J` / `K`                                 | Move selection down/up                                  |
| Lists  | `Enter`                                   | Open selection (peek if split view available)           |
| Lists  | `Space`                                   | Toggle select (multi-select)                            |
| Lists  | `Mod+A`                                   | Select all in view                                      |
| Board  | `H` / `L`                                 | Move card between columns (keyboard equivalent of drag) |
| Board  | `Mod+↑` / `Mod+↓`                         | Reorder within column                                   |
| Editor | `Mod+B/I/U`, `Mod+Shift+8`, `Mod+Alt+1…3` | Standard formatting                                     |
| Editor | `Mod+Shift+M`                             | Toggle comment mode                                     |

**Rules:** every shortcut is remappable and disableable (WCAG 2.1.4), single-character shortcuts never fire while typing in an input, and the palette always shows the shortcut next to the action it invokes — **discoverability is built into the UI**, not documented separately.

## 17.7 Command palette (the spine of the product)

- Opens in < 100 ms from a warm cache, first keystroke never dropped.
- Three sections in fixed order: **Actions** (create issue, assign to me, change status…), **Navigation** (jump to project/channel/page), **Content** (issues, docs, messages, people, emails).
- Typed operators: `> ` actions only, `#` channels, `@` people, `in:` project, `is:` state, `from:` sender.
- Recent items first on empty query; each row shows type icon, title, and a contextual secondary line (project key, channel, sender, timestamp).
- Fully keyboard-driven with the ARIA combobox/listbox pattern; screen-reader announcement of result count; `Esc` returns focus to the previously focused element.
- **Same component everywhere**: global palette, assignee picker, label picker, emoji picker, and mail "move to inbox" all reuse the palette/keyboard contract.

## 17.8 States: loading, empty, error, offline, permission

| State                       | Pattern                                                                                                                     |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Cached data available       | Render immediately; no indicator at all                                                                                     |
| First-ever load             | **Skeleton mirroring the final layout** (same row heights, same column widths) — never a centered spinner over a blank page |
| Slow network (> 1 s)        | Skeleton persists; a subtle top progress hairline appears after 1 s                                                         |
| Empty (never had data)      | Illustration-free, text-first: what this is, why it matters, one primary action, one secondary link to docs                 |
| Empty (filtered to nothing) | "No results for these filters" + one-click **Clear filters**                                                                |
| Error (recoverable)         | Inline card in place of the content: what failed, **Retry**, and (dev/staff only) the `requestId`                           |
| Error (mutation)            | Roll back the optimistic row, inline message at the field/row, toast with Retry; `aria-live="assertive"` for failures       |
| Offline                     | Persistent thin banner with "N changes pending"; queued items show a pending badge; nothing is blocked                      |
| Permission denied           | Explain the rule in human terms ("Private channel — ask @sam to add you"), with a Request access action where possible      |
| Rate limited                | Toast with countdown, auto-retry where safe, never a raw 429                                                                |
| AI unavailable              | Feature shows a disabled state with an explanation; the rest of the product is untouched                                    |

**Toast rules:** bottom-right on desktop, top on mobile, max 3 visible, auto-dismiss 4–6 s (paused on hover/focus), destructive actions get **Undo** instead of auto-dismiss, and `aria-live="polite"` — toasts never steal focus.

## 17.9 Motion

- **Purposeful only:** motion communicates origin, state change, or relationship. No decorative loops.
- **Durations:** 120 ms micro (hover/press), 180 ms standard (popover, tab), 240 ms large (panel, dialog, drawer). Exit ≈ 65% of enter duration.
- **Easings:** enter `cubic-bezier(0.16, 1, 0.3, 1)` (fast out), exit `cubic-bezier(0.4, 0, 1, 1)`, move `cubic-bezier(0.2, 0, 0, 1)`. Springs for drag/sheet gestures.
- **Animate only `transform` and `opacity`.** Never width/height/top/left. Layout changes use FLIP when cross-fading between list and board layouts.
- **Interruptible:** a second input cancels the running animation immediately; never block input during animation.
- **Shared elements:** opening an issue from a board morphs the card into the peek panel (spatial continuity), rather than sliding a generic panel.
- **Respect `prefers-reduced-motion`:** replace movement with 100 ms opacity fades; disable morphs and parallax entirely.
- **Optimistic feedback beats animation:** the best "animation" is a state that was already correct.

## 17.10 Accessibility (WCAG 2.2 AA, with the new criteria called out)

| Criterion                             | How we satisfy it                                                                                                                 |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| 1.4.3 / 1.4.11 Contrast               | 4.5:1 text, 3:1 UI and graphical objects — verified in tokens, both themes, and in CI                                             |
| 2.1.1 Keyboard                        | Every action has a keyboard path, including drag-and-drop                                                                         |
| **2.5.7 Dragging Movements**          | Board cards and list rows expose a **"Move to…"** menu and keyboard reordering; drag is never the only way                        |
| **2.5.8 Target Size (Minimum)**       | ≥ 24×24 CSS px in dense UI, ≥ 44×44 for mobile touch (with `hitSlop` expansion for icon buttons)                                  |
| 2.4.7 / **2.4.11 Focus Not Obscured** | Visible focus ring everywhere; sticky headers and the detail panel never cover the focused element (scroll-into-view with offset) |
| 2.4.3 Focus Order                     | Logical DOM order; dialogs trap focus and return it; route changes move focus to the main heading                                 |
| 2.4.2 Page Titled                     | Per-route document titles incl. workspace and entity                                                                              |
| 1.3.1 / 4.1.2                         | Semantic landmarks, real headings, correct roles for trees/grids/lists, `aria-sort` on sortable columns                           |
| 4.1.3 Status Messages                 | Toasts, save confirmations, and sync state announced via live regions                                                             |
| **3.3.8 Accessible Authentication**   | Passkeys supported; no cognitive-test CAPTCHA as the only path; paste into password fields allowed                                |
| **3.3.7 Redundant Entry**             | Multi-step flows carry data forward (invite flow, mail setup)                                                                     |
| 1.4.12 Text Spacing / 1.4.4 Resize    | Layouts survive 200% zoom and user text-spacing overrides (no fixed heights on text containers)                                   |
| 1.4.10 Reflow                         | Functional at 320 CSS px width; no two-dimensional scrolling except boards/data tables (allowed for essential 2D layout)          |
| 2.2.2 Pause/Stop/Hide                 | No auto-playing media; animations pausable; typing indicators respect reduced motion                                              |
| 3.2.1/3.2.2 On Focus/Input            | No surprise navigation on focus or field change                                                                                   |

**Editor-specific accessibility:** the rich-text editor exposes a toolbar that is keyboard reachable, announces formatting state, supports a "plain text mode" escape hatch, and documents its keyboard map in-app. Mention autocomplete follows the combobox pattern with `aria-activedescendant`. Collaborative cursors are decorative to screen readers (attribution comes through comments and activity).

**Testing:** axe-core in unit tests (violations fail CI), Playwright + axe on top routes, keyboard-only smoke scripts per feature, and a quarterly manual screen-reader pass (NVDA on Windows, VoiceOver on macOS/iOS).

## 17.11 Perceived performance techniques

| Technique                                                                                  | Where                        |
| :----------------------------------------------------------------------------------------- | :--------------------------- |
| Render from cache before auth completes                                                    | App boot                     |
| Route-level code splitting + prefetch on hover/focus/`requestIdleCallback`                 | All navigation               |
| Prefetch the likely next entity (board → top card, list → selected row)                    | Lists and boards             |
| Virtualized lists with overscan; windowed boards                                           | Chat, inbox, issue lists     |
| Optimistic mutations with pending badges                                                   | Everywhere                   |
| Skeleton → content cross-fade at 120 ms (no flash)                                         | First load only              |
| Images/video poster placeholders with reserved aspect ratio                                | Attachments, previews        |
| Debounced search (120 ms) with request cancellation and stale-response guarding            | Palette                      |
| Service worker precache of the shell + stale-while-revalidate for static assets            | PWA                          |
| Input latency budget: no synchronous work > 16 ms in event handlers; heavy work in workers | Editor, search, mail parsing |

## 17.12 Mobile UX (platform-native, not a shrunk web app)

- **Navigation:** bottom tab bar with ≤ 5 destinations (Inbox, Issues, Docs, Chat, More), native stack pushes, system back/gesture honored, deep links + universal links for every entity.
- **Density:** single-column, 44 pt minimum touch targets, sheets instead of modals, pull-to-refresh, infinite scroll with a loading row (not a spinner overlay).
- **Composition:** message/reply composer is a bottom sheet that survives the keyboard; draft autosave every 2 s locally; mentions via a native-styled picker.
- **Offline is a first-class state:** a persistent "offline" pill, pending badges on queued items, and a manual "Sync now" affordance.
- **Adaptive:** tablet/iPad split view with the same sidebar+content model as desktop where space allows.
- **Haptics:** light impact on send/reaction, notification-style success on submit; never on scroll.
- **Dynamic Type:** all text scales; layouts reflow instead of truncating; no fixed-height text containers.
- **Push:** deep-links into the exact thread/issue; per-workspace mute; quiet hours respected.

## 17.13 Microcopy rules

- **Sentence case everywhere.** No Title Case Buttons.
- **Verbs that describe the outcome**: "Create issue", "Send reply", "Assign to me" — not "Submit", "OK", "Confirm".
- **Errors state cause + fix**, and never blame the user: "This link expired. Request a new one?" not "Invalid token."
- **Destructive confirmations name the object**: "Delete _ENG-142: Rate limit retries_?" with the count when bulk.
- **Empty states are invitations**: "No issues yet — create the first one, or press ⌘K to search."
- **Time:** relative for recent ("2 m ago"), absolute on hover/expand, localized; always show timezone for scheduled sends.
- **Numbers:** locale-formatted, tabular figures, units in labels not values ("3 days", not "3d").

## 17.13a Internationalization and localization (added in v1.1)

- **Every user-facing string goes through Lingui** (`t`/`<Trans>`), extracted to ICU catalogs in `packages/i18n`; a CI check fails on new hardcoded strings in `apps/*`. Server-generated text (emails, notifications, errors) uses the same catalogs, keyed by the recipient's locale.
- **ICU plurals and gender**, never string concatenation ("1 issue" / "3 issues" / languages with more plural forms).
- **Locale-aware formatting** via `Intl` (dates, relative time, numbers, lists); user timezone from the profile, never the server's.
- **RTL-safe by construction:** Tailwind logical utilities only (`ms-*`, `me-*`, `ps-*`, `start-*`), `dir` set from the locale, directional icons mirrored. A pseudo-locale (accented + 30% longer + RTL) runs in visual regression to catch truncation and mirroring bugs before real translations exist.
- **Content is not UI:** documents, messages, and mail are stored as written; search uses per-document language detection (§11.1).
- **Launch locales:** English (source), then French and Kinyarwanda; community translations through a self-hostable workflow (Weblate) once strings stabilize.

## 17.13b First-run experience and migration (added in v1.1)

The first ten minutes decide adoption, for operators and for teams.

- **Operator:** the setup wizard (§12.2) checks DNS/TLS, mail sending, storage, and backup configuration, shows a green/red health list (`huriro doctor` in the UI), and creates the first workspace.
- **Workspace:** a three-step wizard (name → invite → choose a starter: _engineering team_, _product team_, _support team_) seeds statuses, labels, a sample project, a doc template set, and `#general`. Sample data is clearly marked and removable in one click.
- **Import before invite:** importers (Linear, GitHub Issues, Jira CSV/API, Notion/Markdown zip, Slack export) run as resumable jobs with a **dry-run preview** (counts, user mapping, unmapped fields) and an import report; imported entities keep a link to their source and redirects from old identifiers (`LIN-123 → ENG-123`).
- **Activation checklist:** create an issue with the keyboard, open the palette, write a doc, connect an agent (MCP or CLI), invite a teammate — each item deep-links to the action and disappears when done.

## 17.14 Design operations

| Practice             | Implementation                                                                                                                                                     |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token pipeline       | DTCG JSON → Style Dictionary → CSS/Tailwind/RN; PR proposed by automation; semver on token package                                                                 |
| Component workshop   | Storybook with states matrix + interaction tests + axe                                                                                                             |
| Visual regression    | Playwright screenshots per component state and per key route, both themes, on PR                                                                                   |
| Design review gate   | Any new surface must match the shell (header, empty/loading/error, keyboard, focus) — enforced by a checklist in the PR template                                   |
| UX metrics           | INP/LCP/CLS via RUM; task completion + time-to-first-action for key flows; support-ticket tagging by surface                                                       |
| Research cadence     | Usability sessions on the top 3 flows before each milestone gate (M3, M4, M6); session replay (consented) for drop-off analysis once the cloud offering has volume |
| Accessibility budget | Zero axe violations on new code; quarterly manual audit report                                                                                                     |

## 17.15 Antipatterns explicitly banned

❌ Spinner-over-blank-page ❌ Modal for primary navigation ❌ Icon-only buttons without labels/tooltips ❌ Placeholder-as-label ❌ Disabled buttons with no explanation ❌ Invisible shortcuts ❌ Color-only status (always icon + text) ❌ Auto-focus stealing during streaming updates ❌ Nested scroll containers in the main content column ❌ Layout shift when async content arrives ❌ Toast for errors that need action ❌ Drag-only interactions ❌ Emoji as structural icons.
