// One-time copy of a vibeboard board into a new Wheelhouse data dir. The vibeboard dir is only read.
import fs from 'node:fs'
import path from 'node:path'

// Left behind: claude-hooks.json (rewritten on every start, with our port), usage-probe/ and the
// profiles/ folders that hold CLI sign-ins.
const FILES = ['state.json', 'state.json.bak', 'loops.json']

export function copyFromVibeboard(from, to) {
  if (fs.existsSync(to) || !fs.existsSync(from)) return []
  fs.mkdirSync(to, { recursive: true, mode: 0o700 })
  const copied = FILES.filter((name) => fs.existsSync(path.join(from, name)))
  for (const name of copied) {
    // Copied under a temporary name and renamed: a crash cannot leave a half-written board.
    const temp = path.join(to, `${name}.copying`)
    fs.copyFileSync(path.join(from, name), temp)
    fs.renameSync(temp, path.join(to, name))
  }
  return copied
}
