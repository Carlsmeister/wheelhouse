import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeDurable } from '../server/durable.mjs'

// Every test gets its own throwaway folder; the real home is never touched.
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-durable-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'state.json')
}

test('the new content is on disk before it replaces the file', (t) => {
  const file = scratch(t)
  fs.writeFileSync(file, '{"old":1}')
  fs.writeFileSync(file + '.tmp', '{"half":') // left by an earlier crash
  const calls = []
  const { fsyncSync, renameSync } = fs
  t.mock.method(fs, 'fsyncSync', (fd) => (calls.push('fsync'), fsyncSync(fd)))
  t.mock.method(fs, 'renameSync', (from, to) => (calls.push('rename'), renameSync(from, to)))
  writeDurable(file, '{"new":1}')
  assert.deepEqual(calls, ['fsync', 'rename'])
  assert.equal(fs.readFileSync(file, 'utf8'), '{"new":1}')
  assert.equal(fs.existsSync(file + '.tmp'), false)
})

test('a write that cannot reach the disk leaves the old file and closes its descriptor', (t) => {
  const file = scratch(t)
  fs.writeFileSync(file, '{"old":1}')
  t.mock.method(fs, 'fsyncSync', () => {
    throw new Error('disk gone')
  })
  const close = t.mock.method(fs, 'closeSync')
  assert.throws(() => writeDurable(file, '{"new":1}'), /disk gone/)
  assert.equal(close.mock.callCount(), 1)
  t.mock.restoreAll()
  assert.equal(fs.readFileSync(file, 'utf8'), '{"old":1}')
})
