import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyFromVibeboard } from '../server/migrate.mjs'

// Every test gets its own throwaway folder; the real home is never touched.
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-migrate-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { from: path.join(dir, '.vibeboard'), to: path.join(dir, '.wheelhouse') }
}
const write = (dir, name, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}
const snapshot = (dir) =>
  Object.fromEntries(
    fs.readdirSync(dir, { recursive: true }).sort().map((name) => {
      const file = path.join(dir, name)
      return [name, fs.statSync(file).isDirectory() ? 'dir' : fs.readFileSync(file, 'utf8')]
    }),
  )

test('a new wheelhouse dir gets the board, its backup and the loops from vibeboard', (t) => {
  const { from, to } = scratch(t)
  write(from, 'state.json', '{"board":1}')
  write(from, 'state.json.bak', '{"board":0}')
  write(from, 'loops.json', '[]')

  assert.deepEqual(copyFromVibeboard(from, to), ['state.json', 'state.json.bak', 'loops.json'])
  assert.deepEqual(snapshot(to), { 'loops.json': '[]', 'state.json': '{"board":1}', 'state.json.bak': '{"board":0}' })
  assert.equal(fs.statSync(to).mode & 0o777, 0o700, 'the board holds prompts: the new dir is private')
})

test('hook config, the usage probe and account sign-ins stay behind', (t) => {
  const { from, to } = scratch(t)
  write(from, 'state.json', '{}')
  write(from, 'claude-hooks.json', '{"port":4317}')
  write(from, 'usage-probe/out.txt', 'probe')
  write(from, 'profiles/work/.credentials.json', 'secret')
  write(from, 'docs/note.md', 'doc')

  assert.deepEqual(copyFromVibeboard(from, to), ['state.json'])
  assert.deepEqual(fs.readdirSync(to), ['state.json'])
})

test('the vibeboard dir is left exactly as it was', (t) => {
  const { from, to } = scratch(t)
  write(from, 'state.json', '{"board":1}')
  write(from, 'loops.json', '[]')
  write(from, 'claude-hooks.json', '{}')
  const before = snapshot(from)

  copyFromVibeboard(from, to)
  assert.deepEqual(snapshot(from), before)
})

test('only the files vibeboard has are copied', (t) => {
  const { from, to } = scratch(t)
  write(from, 'loops.json', '[]')

  assert.deepEqual(copyFromVibeboard(from, to), ['loops.json'])
  assert.deepEqual(fs.readdirSync(to), ['loops.json'])
})

test('an existing wheelhouse dir is never overwritten', (t) => {
  const { from, to } = scratch(t)
  write(from, 'state.json', '{"from":"vibeboard"}')
  write(to, 'state.json', '{"from":"wheelhouse"}')

  assert.deepEqual(copyFromVibeboard(from, to), [])
  assert.equal(fs.readFileSync(path.join(to, 'state.json'), 'utf8'), '{"from":"wheelhouse"}')
})

test('without a vibeboard dir nothing is copied and nothing is created', (t) => {
  const { from, to } = scratch(t)

  assert.deepEqual(copyFromVibeboard(from, to), [])
  assert.equal(fs.existsSync(to), false)
})
