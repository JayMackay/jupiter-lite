# Ribbon navigation coordination

Source: `inbox/briefs/2026-11-04T0239-80e039.md`.

Selecting MCP, Plugins, Workspace or Help must begin dismissing the ribbon in the click handler. Files and Settings keep it open, per the user's clarification. Workspace closes Capabilities; Help closes Workspace and Capabilities; opening the ribbon closes the Workspace card sidebar. Agent chats and sessions are outside this change.

## Approach

Use a small shared navigation notification alongside the existing rail, dashboard and preview state. Dispatch related updates synchronously so React batches the transition. Extend the existing pending dashboard-window request to allow closing a window even while the dashboard is unmounted on a card/search page. A navigation revision guards asynchronous Help results.

Keeping independent handlers without coordination caused the reported stacking. Replacing all dashboard, chat and rail state with a new router would unnecessarily expand this fix.

Retain closing dashboard/preview content briefly for opacity/transform exits, immediately make it inert, cancel stale removal timers on reopening, and respect reduced motion. Animate the Workspace sidebar's existing margin rather than switching display. Keep the ribbon's current slide animation and animate preview offsets.

## Verification

Run browser regressions against the real built app and a temporary local service with synthetic workspace content and disabled external generation. Exercise each named destination, Files/Settings, card-to-destination navigation, delayed Help, interrupted exits, repeated navigation, and reduced motion. Capture frames and video, inspect the console and hit testing, then run build, lint and the existing test suite.
