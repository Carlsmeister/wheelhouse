# Wheelhouse

Guidance for coding agents working in this repository. People start at the [README](README.md).

## Testing

Every command is copied from `package.json` and the README's "Build from Source". Node 24.
Install first with `npm ci`.

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
