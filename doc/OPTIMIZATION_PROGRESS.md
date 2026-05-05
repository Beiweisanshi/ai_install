# GUI Installer Optimization Progress

This file records implementation progress for `doc/OPTIMIZATION_REPORT.md` so work can resume safely after context compaction.

## Completed

- P0-1: removed hardcoded `admin` / `123456` defaults and the `local-admin-session` backend bypass.
- P0-2: moved auth session persistence behind Tauri secure session commands; Windows stores `session.bin` with DPAPI.
- P0-3: tightened production CSP `connect-src`.
- P0-4: added backend proxy URL host allowlist and stripped `Cookie` / `Set-Cookie` / `Host` headers.
- P0-5: replaced `window.confirm` elevated launch with a branded danger confirmation dialog.
- P0-6: changed Summary done action from full page reload to a soft dashboard reset.
- P1-1: enabled resizable window with minimum size and removed fixed 900x700 layout shell.
- P2-4: added product identity in the app chrome and updated window title.
- P2-5: enlarged dashboard status pills.
- P2-7: removed unused `ConfigPanel` and `KeySelection` components/tests.
- P1-2: promoted channel controls to the dashboard header and added custom channel deletion.
- P1-3: added install precheck command plus preflight dialog for disk/process warnings.
- P1-4: added Summary retry for failed items and total duration.
- P1-5: added AuthPanel password visibility, form submit behavior, centered auth tabs, and remember-login preference.
- P1-6: added LaunchDialog command copy affordance.
- P1-7: added shared dialog keyboard handling for ESC and focus cycling.
- P1-8: reworked Dashboard cards into article surfaces with explicit install/open/upgrade/key controls.
- P1-9: changed ChannelDialog to tabbed tool configuration with Base URL copy shortcuts.
- P1-10: replaced inline tiny install logs with per-tool detail toggles and a shared bottom logs pane.
- P1-11: made AppVersionBanner clickable and added `release_url` plumbing.
- P2-1: moved theme colors to CSS variables and added dark mode.
- P2-2: added Settings drawer for channels, env vars, logs, preferences, and about.
- P2-3: added environment-variable transparency notices in launch and channel configuration flows.
- P2-6: added empty-key CTA to the key manager.
- P2-8: completed lightweight i18n extraction. All user-facing Chinese strings in non-test `gui-installer/src` code are centralized in `src/lib/strings.ts`, with `t()` for fixed labels and `formatText()` for parameterized text.
- Review fix: Settings reads managed Windows environment variables from `HKCU\Environment`, so values written by `setx` are visible without restarting the GUI process.
- Review fix: disabling remember-login immediately clears the stored secure session; re-enabling persists the current session again.
- Review fix: install command rejections now produce explicit failed Summary rows and clear stale results instead of showing an empty or stale completion screen.
- Review fix: Rust backend host allowlist now also reads Vite `.env*` files for `VITE_BACKEND_API_BASE_URL`, keeping Cargo `BACKEND_HOST` in sync with common Vite env-file builds.
- Review fix: Settings clears managed Windows environment variables by deleting `HKCU\Environment` values instead of writing empty variables with `setx`.
- Review fix: added `gui-installer/.run-logs/` to `.gitignore` so local dev logs/scripts are excluded from commits.
- Review fix: legacy remembered sessions from previous `localStorage` storage are migrated into secure session storage before the old key is removed.
- Build policy: fixed `build-windows-gnu.ps1` UTF-8 config read and verified GNU/Tauri release build.

## Remaining

- None from the actionable report scope.

## Last Verification

- `npm test -- --run`: passed, 6 files / 21 tests.
- `npm run build`: passed.
- `powershell -ExecutionPolicy Bypass -File .\build-windows-gnu.ps1`: passed.
- String extraction scan: no Chinese literals remain in non-test `gui-installer/src` files outside `src/lib/strings.ts`.
- Delivery artifact: `D:\own\zm_tool\ai_install\dist\gui-installer.exe` (`7,017,984` bytes, `2026-05-04 00:42:18`).
