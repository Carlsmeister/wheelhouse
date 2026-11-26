import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { patchXtermPackage, artifacts } from '../scripts/patch-xterm.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const digest = text => createHash('sha256').update(text).digest('hex')
const pristineHashes = {
  'xterm.mjs': 'b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59',
  'xterm.js': '14903579ff54664cd72f8e8699e6961a6272c21863ec1c3b118cdc8af5d4a972',
}
async function withPackage(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'xterm-patch-'))
  try {
    await mkdir(join(dir, 'lib'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@xterm/xterm', version: '6.0.0' }))
    for (const artifact of artifacts) {
      let bytes = await readFile(join(root, 'node_modules/@xterm/xterm/lib', artifact.file), 'utf8')
      if (digest(bytes) !== pristineHashes[artifact.file]) bytes = bytes.replace(artifact.after, artifact.before)
      assert.equal(digest(bytes), pristineHashes[artifact.file], 'temporary fixture must reconstruct verified pristine package bytes')
      await writeFile(join(dir, 'lib', artifact.file), bytes)
    }
    await fn(dir)
  } finally { await rm(dir, { recursive: true, force: true }) }
}
const bytes = dir => Promise.all(artifacts.map(a => readFile(join(dir, 'lib', a.file), 'utf8')))
test('patch updates both distributions and a second run is byte-identical', () => withPackage(async dir => {
  const before = await bytes(dir)
  await patchXtermPackage(dir)
  const after = await bytes(dir)
  after.forEach((value, i) => assert.notEqual(value, before[i]))
  await patchXtermPackage(dir)
  assert.deepEqual(await bytes(dir), after)
}))
test('patch recovers a known pristine/patched mixed package', () => withPackage(async dir => {
  const before = await bytes(dir)
  await patchXtermPackage(dir)
  const after = await bytes(dir)
  await writeFile(join(dir, 'lib', artifacts[1].file), before[1])
  await patchXtermPackage(dir)
  assert.deepEqual(await bytes(dir), after)
}))
test('unknown bytes in the second distribution reject before either file changes', () => withPackage(async dir => {
  await writeFile(join(dir, 'lib', artifacts[1].file), (await bytes(dir))[1] + ' ')
  const before = await bytes(dir)
  await assert.rejects(patchXtermPackage(dir), /unknown|hash|content/i)
  assert.deepEqual(await bytes(dir), before)
}))
test('unknown version or malformed manifest rejects without mutation', () => withPackage(async dir => {
  const before = await bytes(dir)
  for (const manifest of ['{"name":"@xterm/xterm","version":"6.0.1"}', '{']) {
    await writeFile(join(dir, 'package.json'), manifest)
    await assert.rejects(patchXtermPackage(dir))
    assert.deepEqual(await bytes(dir), before)
  }
}))
test('missing browser package is allowed only for an intentionally omitted dev install', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xterm-absent-'))
  try {
    const script = await readFile(join(root, 'scripts/patch-xterm.mjs'), 'utf8')
    await mkdir(join(dir, 'scripts')); await writeFile(join(dir, 'scripts/patch-xterm.mjs'), script)
    await writeFile(join(dir, 'package.json'), '{"type":"module"}')
    const env = { ...process.env }; delete env.NODE_ENV; delete env.npm_config_omit
    const normal = spawnSync(process.execPath, ['scripts/patch-xterm.mjs'], { cwd: dir, env, encoding: 'utf8' })
    assert.notEqual(normal.status, 0, normal.stderr)
    const production = spawnSync(process.execPath, ['scripts/patch-xterm.mjs'], { cwd: dir, env: { ...env, npm_config_omit: 'dev' }, encoding: 'utf8' })
    assert.equal(production.status, 0, production.stderr)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('postinstall propagates patch failure past the best-effort chmod', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xterm-install-'))
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    await mkdir(join(dir, 'scripts')); await writeFile(join(dir, 'scripts/patch-xterm.mjs'), 'process.exit(42)')
    const result = spawnSync('/bin/sh', ['-c', manifest.scripts.postinstall], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 42, 'patch failure must never be swallowed by chmod fallback')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('distributed helper uses finite fallback coordinates for zero and non-finite geometry', () => withPackage(async dir => {
  await patchXtermPackage(dir)
  for (const artifact of artifacts) {
    const installed = await readFile(join(dir, 'lib', artifact.file), 'utf8')
    assert.equal(installed.includes(artifact.after), true)
    const helper = Function(`return (${artifact.after})`)()
    for (const size of [0, NaN]) {
      const style = { boxSizing: 'content-box', getPropertyValue: () => '0px' }
      const element = { offsetWidth: size, offsetHeight: size, getBoundingClientRect: () => ({ left: 0, top: 0, width: size, height: size }) }
      assert.deepEqual(helper({ getComputedStyle: () => style }, { clientX: 10, clientY: 20 }, element), [10, 20])
    }
  }
}))
