# Ribbon Navigation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make named ribbon destinations immediately dismiss conflicting navigation surfaces with smooth transitions.

**Architecture:** Keep existing local surface state and coordinate it with a shared synchronous navigation notification. Reuse pending dashboard requests for closing remembered windows, guard delayed Help responses, and retain inert closing content for exit animations.

**Tech Stack:** React 19.2, TypeScript, CSS, existing Node/Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-11-04-navigation-design.md` and the source brief.

## Global Constraints

- Files and Settings retain the ribbon; the other four destinations dismiss it.
- Do not close agent sessions or chat windows. Do not restart the user's application.
- Work in place: this directory contains no Git metadata. Keep original edited files under `.cache/navigation-originals/`.
- Use synthetic local test data; no sign-ins, paid generation or external publication.

## Review Focus

- A late Help response must not cover a newer destination.
- Closing content must immediately stop receiving clicks and keyboard focus.
- Reopening before an exit ends must survive old cleanup timers.
- Navigating from a card or search must not restore remembered Capabilities.
- Reduced motion must preserve destination visibility and interaction.

### Task 1: Reproduce and coordinate navigation

**Files:** `desktop/service/test/navigation-ui.mjs`, `src/lib/navigation.ts`, `src/lib/capabilities.ts`, `src/lib/dashboard-open.ts`, `src/desktop/FilesRail.tsx`, `src/App.tsx`, `src/components/Dashboard.tsx`.

**Interfaces:** `navigateSurface(target: NavigationTarget): () => boolean` notifies named surfaces and returns a guard for asynchronous completion. `NAVIGATION_EVENT` carries a `NavigationTarget`. `DashboardWindow` gains `home` for a pending close request.

- [x] Add real browser regressions for all four destinations, conflicting surfaces, Files/Settings and stale Help responses.
- [x] Run the baseline build and regressions; confirm failures reproduce the brief.
- [x] Implement synchronous coordination and Help cancellation without changing chat state.
- [x] Run regressions and verify the expected surfaces remain interactive.

### Task 2: Animate and verify transitions

**Files:** `src/lib/useExitTransition.ts`, `src/desktop/DesktopApp.tsx`, `src/desktop/FilesRail.tsx`, `src/components/Dashboard.tsx`, `src/components/Sidebar.tsx`, `src/desktop/desktop.css`, `src/styles/dashboard.css`, `package.json`.

**Interfaces:** `useExitTransition<T>(value: T | null): T | null` retains only the last value during an exit, with cancellable cleanup. Exiting nodes use inert and aria-hidden immediately.

- [x] Cover interrupted exits, smooth sidebar geometry, reduced motion, destination hit testing and console errors in browser regressions.
- [x] Add short exits, sidebar/preview transitions, and reduced-motion overrides.
- [x] Capture native compositor transition frames; inspect the app using isolated Playwright. Video encoder missing; no replacement installed.
- [x] Run `npm run build`, `npm run lint`, `npm test`, and affected existing browser regressions.
- [x] Review changed files, record local project knowledge, and report all acceptance criteria and completed tasks.

## Acceptance mapping

Criteria 1–4 are covered by Task 1 destination and conflict tests. Criteria 5–7 are covered by Task 2 animation, race, hit-test, capture and console checks. Files/Settings are explicit regression cases in both tasks.

## Execution record

- Design and implementation choices follow the detailed authorized brief; no additional approval gate is needed for this reversible fix.
- No Git metadata is present, so there is no branch/commit step.
- Task 1: original navigation regressions observed failing; synchronous coordination passes.
- Task 2: sidebar and retained-window exit checks observed failing, then passing after animation changes. Final browser run: 16/16. Build/lint and existing Capabilities/Dashboard browser tests pass.
- Final review: separate read-only reviewer. Search and Ask-to-Help race findings fixed with failing-then-passing regressions; navigation script registered in the standard UI command. No deferred review minors.
- Final broad suite: 275 passed, 6 skipped, 1 unrelated quick-actions command-decoding failure. Detailed evidence and scope decisions: `docs/superpowers/reviews/2026-11-04-navigation.md`.
