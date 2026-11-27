# Wheelhouse

Guidance for coding agents working in this repository. People start at the [README](README.md).

## Testing

Every command is copied from `package.json` and the README's "Build from Source". Node 24.
Install first with `npm ci`.
Install the browser-test prerequisite with `npx playwright install chromium` before running tests.
Browser tests fail explicitly when Chromium is missing.

| Command | Runs | Threshold |
|---|---|---|
| Full suite | `npm run build && npm test` | A check |
| Smoke | `npm run build` (type-check with `tsc -b`, then the Vite build) | A check |
| One test | `node --test {test}` | A check |
| Coverage on changed lines | Absent: no coverage tool is set up | None declared |
| Coupling change | Absent: none declared | None declared |
| Architecture rules | Absent: none declared; `tsc` rejects unused locals | None declared |

- **Build before the tests.** The static-serving and path-traversal test skips itself while
  `dist/index.html` is missing (`test/server.test.mjs:136`).
- **Run with `NODE_ENV` unset.** Under `NODE_ENV=production`, `npm ci` leaves out the dev
  dependencies and 14 of the 24 tests in `test/server.test.mjs` fail.
- **A test is named by its file**, `{test}` = `test/url.test.mjs`: Node's own test runner,
  the one `npm test` calls.
- **One run at a time.** The suite starts its own server on port 4399
  (`test/server.test.mjs:16`), so two runs at once collide. The full suite takes about
  75 seconds.
- **Workspace UI regressions run explicitly.** The normal suite's `test/*.test.mjs`
  glob excludes `test/ui`. Use `node --test test/ui/workspace-tabs.test.mjs` and
  `node --test test/ui/workspace-close-store.test.mjs`, sequentially after building.
  These require an installed `playwright-cli` (verified with 0.1.24) and its browser.
  Set `PLAYWRIGHT_CLI_JS` to that CLI's JavaScript entry and optionally
  `PLAYWRIGHT_NODE` to the Node 24 executable; the default is the runner's executable.
  Run both the test and CLI with Node 24, with `NODE_ENV` and `PORT` unset. The driver
  reports both runtimes, opens a fresh named session and closes only its own browser
  and loopback fixture. The fixture uses synthetic state and mocked transport; it
  never starts the application backend or reads a saved board. Missing prerequisites
  and browser failures fail the tests.
