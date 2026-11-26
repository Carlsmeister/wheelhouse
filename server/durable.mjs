// Writes a file so that a crash or power loss leaves the old content or the new, never a torn one.
import fs from 'node:fs'

export function writeDurable(file, data) {
  const fd = fs.openSync(file + '.tmp', 'w')
  try {
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(file + '.tmp', file)
}
