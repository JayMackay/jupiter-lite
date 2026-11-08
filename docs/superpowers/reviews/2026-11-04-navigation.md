# Navigation verification — 4 November 2026

The seven acceptance criteria in `inbox/briefs/2026-11-04T0239-80e039.md` are met. The user's Files/Settings exception is implemented: both retain the ribbon.

| Criterion | Result |
| --- | --- |
| MCP, Plugins, Workspace and Help begin ribbon dismissal on selection | Passed |
| Workspace closes Capabilities | Passed |
| Help closes Workspace sidebar and Capabilities | Passed |
| Opening ribbon closes Workspace sidebar | Passed |
| Smooth opening and closing without abrupt sidebar disappearance | Passed; compositor frames and intermediate geometry inspected |
| Rapid/repeated navigation leaves the latest destination usable | Passed; delayed Help, interrupted exits, card routes, search and Ask Jupiter covered |
| Browser verification, transition evidence and console inspection | Passed; existing unrelated mobile-bootstrap errors recorded separately |

## Checks

- `npm run build`: passed, with the existing large-chunk advisory.
- `npm run lint`: passed.
- `node desktop/service/test/navigation-ui.mjs`: 16 checks passed; real app, synthetic local service, no account sign-ins or paid generation in the navigation fixture.
- Existing `capabilities-ui.mjs` and `dashboard-ui.mjs`: passed after the final code changes.
- `npm test`: 275 passed, 6 skipped, 1 failed, total 282. The unrelated failure is `reasoning is medium or above, research uses xhigh, and max needs an explicit request` in `desktop/service/test/quick-actions.test.mjs:56`; its Windows command decoding produces garbled text. Reproduced separately without the UI. No backend code was changed for it.
- Browser: no new navigation console errors or page exceptions. The existing desktop import repeatedly requests `/mobile/api/bootstrap` from the desktop-only test service and receives HTTP 400. These messages are retained in the results, not counted as navigation regressions.

## Local evidence

- [Browser results](../../../.cache/navigation-review/results.json)
- [Compositor frame timeline](../../../.cache/navigation-review/frames/timeline.json)
- [Sidebar positions during its exit](../../../.cache/navigation-review/sidebar-motion.json)
- [Help after conflicting surfaces close](../../../.cache/navigation-review/help-reviewed.png)
- [Workspace after Capabilities closes](../../../.cache/navigation-review/plugins-to-workspace-end.png)
- [Broad test log](../../../.cache/navigation-review/unit-tests-final.log)

Playwright's optional video encoder is absent; native compositor PNG frames provide transition evidence without installing it.

## Review and decisions

A separate read-only code reviewer found two important gaps: search could prevent Capabilities mounting, and direct Dashboard navigation could leave delayed Help current. Both have regressions observed failing before the fixes and passing afterward. The navigation test is included in `desktop:test:ui`.

- Ordinary asynchronous file-preview races remain outside the named destination scope. Cost: unrelated file choices may still race; this change does not claim to repair them.
- Files/Settings keep their existing panel mounting behavior. Their ribbon stays open; the animated surfaces covered here are the ribbon, Workspace sidebar, dashboard windows and previews. Cost: switching those utility panels retains its existing appearance.
- The unrelated quick-actions test failure is recorded rather than changing backend behavior. Cost: the broad suite is not fully green.

The app and active agent sessions were not restarted. Source originals are preserved under `.cache/navigation-originals/`; this folder has no Git metadata.

Follow-up deployment check: refreshed the local desktop runtime UI and the prepared runtime UI from verified `dist`, copied assets before index.html, retained old hashed bundles for running views, and verified the copied index and referenced assets. The running desktop view needs a reload to load the new frontend.
