# ULTRA COSMOS — working notes for Claude Code

Procedurally generated open-world space exploration sandbox. See
`README.md` for what's playable, `docs/ARCHITECTURE.md` for design
rationale and the real bugs testing caught, `docs/ROADMAP.md` for status
against the original spec.

## Context policy (read this before scanning files)

A Serena MCP server is configured for this project (`.mcp.json`) with a
pre-built symbol index (`.serena/cache/`) and a project memory
(`.serena/memories/architecture-overview.md`). To avoid re-reading the whole
codebase every session:

1. **Start with the memory.** Read `.serena/memories/architecture-overview.md`
   first — it names every file's responsibility and the layering
   (`core → gen → sim → game → render/ui → main.js`).
2. **Find symbols with Serena's tools** (`find_symbol`,
   `find_referencing_symbols`, `get_symbols_overview`) instead of `Grep`-ing
   the whole tree or `Read`-ing a whole file to locate one function/class.
3. **Read whole files only when you're actually about to edit them** — once
   you already know which file and roughly where, from steps 1-2.
4. **After a non-trivial architectural decision or a bug worth remembering,
   write it to `.serena/memories/`** (a new memory file, or append to the
   existing one) so the next session doesn't rediscover it.
5. The symbol index only needs rebuilding if Serena's own cache looks stale
   after a large refactor — it updates incrementally on file changes
   otherwise. No need to re-run `serena project index` per session.

## Testing

`npm test` (51 tests, ~0.5s) before committing anything touching
`src/gen/`, `src/sim/`, or `src/game/`. For renderer/main.js changes, verify
with a real headless browser, not just `node --check`:

```
node tools/serve.js &
node tests/browser.smoke.mjs
```

This project's history includes several bugs that *only* a real render
check caught (backface-culled terrain, a night-side sun at spawn, a sky
shader that was structurally always transparent) — `node --check` alone
would have missed all of them.

## Branch

Active development branch: `claude/ultra-cosmos-game-ok4d3u`. PR #1 is open
against `main` (https://github.com/damirloboda/spaceship-game/pull/1).
