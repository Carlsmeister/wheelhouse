// One-time copy of a vibeboard board into a new Wheelhouse data dir. The vibeboard dir is only read.
import fs from 'node:fs'
import path from 'node:path'

// Left behind: claude-hooks.json (rewritten on every start, with our port), usage-probe/ and the
// profiles/ folders that hold CLI sign-ins.
const FILES = ['state.json', 'state.json.bak', 'loops.json']

// A WHEELHOUSE_DATA board (a demo, a test) starts empty; an existing Wheelhouse board is never touched.
export const shouldCopy = ({ override, targetExists, sourceExists }) => !override && !targetExists && sourceExists

export function copyFromVibeboard(from, to, override) {
  if (!shouldCopy({ override, targetExists: fs.existsSync(to), sourceExists: fs.existsSync(from) })) return []
  // Filled beside the target and renamed into place whole: a crash leaves no target, so the next start
  // tries again. A temp dir from such a crash is stale and goes first.
  const parent = path.dirname(to)
  const prefix = `${path.basename(to)}.tmp-`
  for (const name of fs.readdirSync(parent)) {
    if (name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length))) fs.rmSync(path.join(parent, name), { recursive: true, force: true })
  }
  const temp = `${to}.tmp-${process.pid}`
  fs.mkdirSync(temp, { mode: 0o700 })
  const copied = FILES.filter((name) => fs.existsSync(path.join(from, name)))
  for (const name of copied) fs.copyFileSync(path.join(from, name), path.join(temp, name))
  fs.renameSync(temp, to)
  return copied
}
