// Compatibility patch for @xterm/xterm 6.0.0, src/browser/input/Mouse.ts.
// Original helper: Copyright (c) 2017 The xterm.js authors. MIT licensed.
// Remove this script and postinstall entry when upstream handles CSS transforms;
// package upgrades require new byte guards and the terminal browser regressions.
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// Readable replacement of getCoordsRelativeToElement. Preserve native padding
// subtraction (and border semantics), rounding, selection and protocol callers.
// Before (upstream src/browser/input/Mouse.ts, MIT, xterm.js authors):
//   const rect = element.getBoundingClientRect();
//   const style = window.getComputedStyle(element);
//   return [event.clientX - rect.left - parseInt(style.getPropertyValue('padding-left')),
//           event.clientY - rect.top - parseInt(style.getPropertyValue('padding-top'))];
function relativeCoordinates(window, event, element) {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  const number = name => parseFloat(style.getPropertyValue(name)) || 0
  const extent = (axis, offset, sides) => {
    const used = parseFloat(style.getPropertyValue(axis))
    const local = used + (style.boxSizing === 'border-box' ? 0 : sides.reduce((sum, side) => sum + number(`padding-${side}`) + number(`border-${side}-width`), 0))
    return Number.isFinite(local) && local > 0 ? local : offset
  }
  const scale = (rendered, local) => Number.isFinite(rendered) && rendered > 0 && Number.isFinite(local) && local > 0 ? rendered / local : 1
  const sx = scale(rect.width, extent('width', element.offsetWidth, ['left', 'right']))
  const sy = scale(rect.height, extent('height', element.offsetHeight, ['top', 'bottom']))
  return [
    (event.clientX - rect.left) / sx - parseInt(style.getPropertyValue('padding-left')),
    (event.clientY - rect.top) / sy - parseInt(style.getPropertyValue('padding-top')),
  ]
}

// Exact observed compiled helpers, not a regex over lookalike arithmetic.
export const artifacts = [
  {
    file: 'xterm.mjs',
    pristineHash: 'b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59',
    patchedHash: '44a5abf24cf1d40a72a1c1a2778960613e8ddff0f6a7d4608ad6ae3e1e3c72ff',
    before: 'function Ci(s,t,e){let i=e.getBoundingClientRect(),r=s.getComputedStyle(e),n=parseInt(r.getPropertyValue("padding-left")),o=parseInt(r.getPropertyValue("padding-top"));return[t.clientX-i.left-n,t.clientY-i.top-o]}',
    after: relativeCoordinates.toString().replace('relativeCoordinates', 'Ci'),
  },
  {
    file: 'xterm.js',
    pristineHash: '14903579ff54664cd72f8e8699e6961a6272c21863ec1c3b118cdc8af5d4a972',
    patchedHash: '980aed22ec0ba5059d9ebf5e5e142b9320a09b17c884d70866caf5dc75ddf661',
    before: 'function i(e,t,i){const s=i.getBoundingClientRect(),r=e.getComputedStyle(i),n=parseInt(r.getPropertyValue("padding-left")),o=parseInt(r.getPropertyValue("padding-top"));return[t.clientX-s.left-n,t.clientY-s.top-o]}',
    after: relativeCoordinates.toString().replace('relativeCoordinates', 'i'),
  },
]

export async function patchXtermPackage(packageDirectory) {
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
  if (manifest.name !== '@xterm/xterm' || manifest.version !== '6.0.0') throw new Error('Unsupported xterm package/version; revisit compatibility patch')
  // Validate both distributions before any mutation: a changed second bundle
  // must never leave the first bundle partially patched.
  const changes = await Promise.all(artifacts.map(async artifact => {
    const path = join(packageDirectory, 'lib', artifact.file)
    const bytes = await readFile(path, 'utf8')
    const digest = hash(bytes)
    if (digest === artifact.patchedHash) return null
    if (digest !== artifact.pristineHash) throw new Error(`Unknown xterm content hash: ${artifact.file}`)
    if (bytes.split(artifact.before).length !== 2) throw new Error(`Expected exactly one helper in ${artifact.file}`)
    const patched = bytes.replace(artifact.before, artifact.after)
    if (hash(patched) !== artifact.patchedHash) throw new Error(`Unexpected patched hash: ${artifact.file}`)
    return { path, patched }
  }))
  for (const change of changes) if (change) await writeFile(change.path, change.patched)
}

async function main() {
  const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/@xterm/xterm')
  try { await stat(packageDirectory) } catch (error) {
    if (error.code === 'ENOENT' && (process.env.npm_config_omit?.split(/\s+/).includes('dev') || process.env.NODE_ENV === 'production')) return
    throw error
  }
  await patchXtermPackage(packageDirectory)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
