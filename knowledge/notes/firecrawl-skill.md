# Firecrawl skill

Installed the official `firecrawl` skill project-locally on 2026-11-04, with
`.agents/skills/firecrawl` as the maintained source and `.claude/skills/firecrawl`
as its full mirror. Refresh the mirror with `npm run skills:sync`.

Source: [firecrawl/skills](https://github.com/firecrawl/skills/tree/2bf714d9f45e85085036a533ceb943c8577aef2b/skills/core/firecrawl),
commit `2bf714d9f45e85085036a533ceb943c8577aef2b`. The upstream skill and its
bundled `rules/` files are unchanged. Links to other Firecrawl skills refer to
optional, separately installed modules.

On the user's follow-up request, installed `firecrawl-cli@1.27.0` globally with
npm after checking PATH, npm's global packages, common install locations and the
npx cache. Verified `firecrawl --version` and authenticated `--status` using the
project's existing `FIRECRAWL_API_KEY`.

The CLI does not automatically load this project's `.env`. From the project root
in PowerShell, load it only for the CLI process:

```powershell
$firecrawlCli = Join-Path (npm root --global) 'firecrawl-cli/dist/launcher.js'
node --env-file=.env $firecrawlCli --status
```

Replace `--status` with the desired CLI command. No key needs to appear in command
arguments or global configuration. Without an exported key or a separate CLI
login, plain `firecrawl --status` reports unauthenticated; MCP OAuth is separate.

Existing MCP connections and `.env` were left untouched. Verification read account
status only; no scrape, crawl or other credit-consuming job was run. Project tool
rules still govern quick lookups, paid requests and installation scope; do not
run the upstream global setup automatically.
