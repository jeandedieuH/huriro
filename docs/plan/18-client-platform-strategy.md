# 18. Client Platform Strategy

## 18.1 Surface matrix

| Surface                        | v1                                                                                  | Later                                                 | Rationale                                                                         |
| :----------------------------- | :---------------------------------------------------------------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **Web** (desktop browsers)     | Full product                                                                        | —                                                     | Primary surface; also the PWA (installable, offline shell)                        |
| **Mobile** (iOS/Android, Expo) | Inbox, Issues, Chat, Docs reader + light editing                                    | Full doc editing, offline mail compose                | Where triage and quick replies happen                                             |
| **Desktop**                    | **PWA install**                                                                     | Thin native shell (Tauri-class) reusing the web build | Chromium-class rendering with native affordances, without maintaining a second UI |
| **CLI** (`huriro`, MIT)        | Issues, docs, comments, search, agent queue; device-flow login; `--json` everywhere | Admin and import commands                             | Coding agents and power users live in terminals (§13.1a)                          |
| **Browser extension**          | —                                                                                   | Deferred                                              | Link capture could be a later win                                                 |

**Rejected for v1: a bespoke GPU-rendered Rust UI.** Verified findings: the framework in the original sketch (`anomalyco/rune`) is real but **three weeks old at the time of writing**, pre-release ("pin a rev of `dev`"), not accepting pull requests, bus factor ~1, ships **no rich-text editor**, and its own plan names IME and accessibility as top risks; accesskit support is desktop-only and behind a feature flag. Separately, `rune-rs` is an embedded **scripting language**, not a GUI toolkit — the original plan conflated the two. No Rust-native GUI framework (GPUI, Slint, egui, Iced, Dioxus, Makepad) ships a ProseMirror/Yjs-class editor, which for a docs product is a multi-year build. See Appendix A.9.

**Desktop choice, if/when native is needed:** Tauri 2.x (stable; system webview) for Windows/macOS. If identical Chromium text/IME behavior on Linux matters — and WebKitGTK is the weakest `contenteditable` engine — use Electron instead (heavier, but predictable). Revisit Tauri 3's bundled-CEF runtime when it is stable. Known Tauri caveats: WKWebView is tied to the OS version, WebKitGTK varies by distribution, and the auto-updater is desktop-only (no mobile).

## 18.2 Desktop shell requirements (post-GA)

If and when we ship a native shell, it must provide:

- **Shared web bundle** (no forked UI), loaded in the system webview (WebView2 / WKWebView / WebKitGTK).
- **Native integration:** global quick-capture (`Cmd/Ctrl+Shift+Space`), menu bar / tray, notifications, protocol handler (`huriro://`), auto-launch, offline cache reuse.
- **Deep links:** `huriro://issue/ENG-142`, `huriro://doc/…`.
- **Hardening:** context isolation, no `nodeIntegration`, strict CSP, allowlisted IPC surface, signed auto-updates with rollback.
- **Acceptance:** cold start to interactive ≤ 1.5 s on a 3-year-old laptop; idle RAM within 1.4× the browser tab; identical feature parity verified by the same E2E suite.

## 18.3 Mobile engineering constraints (design them in, not around)

| Constraint                                  | Consequence                                                                          |
| :------------------------------------------ | :----------------------------------------------------------------------------------- |
| iOS background execution is limited         | Sync on foreground + push-triggered refreshes; never promise real-time in background |
| No reliable long-lived socket in background | Push notification carries a _hint_; data is pulled on open                           |
| Secure storage is per-app                   | Refresh tokens in SecureStore/Keychain, biometrics optional per workspace            |
| Memory limits on low-end Android            | Virtualized lists, image downscaling, no full-workspace in RAM                       |
| Store review lead time                      | Feature flags + OTA-updatable JS for non-native changes; native changes batched      |
| Offline-first expectations are higher       | Local DB is the source of truth on device; conflicts resolved as in §9.5             |

## 18.4 Shared code boundaries

| Shared                                                                                                          | Not shared                              |
| :-------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| Contracts, validation schemas, domain logic                                                                     | Layout and navigation shells            |
| API client, sync cursor logic, mutation queue                                                                   | Platform-specific gestures and controls |
| Design tokens (compiled per platform)                                                                           | Chat/mail composers (native on mobile)  |
| The TipTap editor build (`packages/editor`), run natively on web and inside an **Expo DOM component** on mobile | —                                       |
| Auth session hooks                                                                                              | Storage backends (IndexedDB vs SQLite)  |

Target: **≥ 60% of non-UI application code shared** between web and mobile, measured in CI so the monorepo actually delivers on its promise.
