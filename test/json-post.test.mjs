import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let home, files, child, port

async function unusedPort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  const value = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  assert.ok(value > 0)
  return value
}

// Raw requests preserve absent and empty media headers without fetch supplying one.
function request(method, pathname, body, media, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method,
      headers: { ...(media === undefined ? {} : { 'Content-Type': media }), ...extraHeaders } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }) }
        catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'json-media-'))
  files = path.join(home, 'files')
  await mkdir(files)
  const env = { ...process.env, HOME: home, WHEELHOUSE_DATA: path.join(home, 'board') }
  delete env.NODE_ENV
  for (let attempt = 0; attempt < 3; attempt++) {
    port = await unusedPort()
    child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); child.stdout.off('data', ready); child.off('exit', exited); child.off('error', exited) }
        const ready = chunk => { if (String(chunk).includes('Wheelhouse server on')) { cleanup(); resolve() } }
        const exited = code => { cleanup(); reject(new Error(`server exited ${code}: ${output}`)) }
        const timer = setTimeout(() => { cleanup(); reject(new Error(`server startup timed out: ${output}`)) }, 10000)
        child.stdout.on('data', ready); child.once('exit', exited); child.once('error', exited)
      })
      return
    } catch (error) {
      if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
      if (!output.includes('is in use by another program') || attempt === 2) throw error
    }
  }
})

after(async () => {
  if (child?.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  if (home) await rm(home, { recursive: true, force: true })
})

// Exact media matching catches accidental prefix and structured-suffix acceptance.
test('JSON media parser accepts casing and parameters but rejects other media', async () => {
  const { isJsonMediaType } = await import('../server/json-media.mjs')
  for (const value of ['application/json', 'Application/JSON; charset=UTF-8', '  APPLICATION/json  ; charset=utf-8; version=1', 'application/json;']) {
    assert.equal(isJsonMediaType(value), true, value)
  }
  for (const value of [undefined, '', ' ', 'text/plain', 'Text/Plain; charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=sample', 'application/jsonp', 'application/problem+json', 'application/json, text/plain']) {
    assert.equal(isJsonMediaType(value), false, String(value))
  }
})

for (const media of ['text/plain', 'Text/Plain; charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=sample', undefined, '']) {
  test(`POST with ${String(media)} cannot overwrite or create a file`, async () => {
    await writeFile(path.join(files, 'note.md'), 'before')
    await rm(path.join(files, 'new.md'), { force: true })
    const responses = []
    for (const [name, create] of [['note.md', false], ['new.md', true]]) {
      responses.push(await request('POST', '/api/files/write', JSON.stringify({ root: files, path: name, text: 'after', create }), media))
    }
    // Inspect effects before asserting status, so RED observes the actual mutation.
    const text = await readFile(path.join(files, 'note.md'), 'utf8')
    const created = await access(path.join(files, 'new.md')).then(() => true, () => false)
    assert.equal(text, 'before', 'invalid media overwrote the existing file')
    assert.equal(created, false, 'invalid media created a file')
    for (const response of responses) {
      assert.equal(response.status, 415)
      assert.match(response.headers['content-type'], /application\/json/)
      assert.equal(typeof response.body.error, 'string')
    }
  })
}

for (const media of ['application/json', 'Application/JSON; charset=UTF-8']) {
  test(`${media} can write a harmless file`, async () => {
    await writeFile(path.join(files, 'note.md'), 'before')
    const response = await request('POST', '/api/files/write', JSON.stringify({ root: files, path: 'note.md', text: 'after' }), media)
    assert.equal(response.status, 200)
    assert.equal(await readFile(path.join(files, 'note.md'), 'utf8'), 'after')
  })
}

test('malformed JSON retains the file parser status and cannot mutate', async () => {
  await writeFile(path.join(files, 'note.md'), 'before')
  const response = await request('POST', '/api/files/write', '{', 'application/json')
  assert.equal(response.status, 400)
  assert.equal(await readFile(path.join(files, 'note.md'), 'utf8'), 'before')
})

for (const pathname of ['/api/hook/nonexistent/event', '/api/visible', '/api/pty/nonexistent/stop', '/api/loops', '/mcp/nonexistent']) {
  test(`media gate precedes downstream validation at ${pathname}`, async () => {
    const response = await request('POST', pathname, '{}', 'text/plain')
    assert.equal(response.status, 415)
    assert.match(response.headers['content-type'], /application\/json/)
    assert.deepEqual((await request('GET', '/api/sessions')).body, [])
    assert.deepEqual((await request('GET', '/api/loops')).body, [])
  })
  test(`media gate rejects a bodyless POST at ${pathname}`, async () => {
    for (const media of [undefined, '', 'text/plain']) {
      const response = await request('POST', pathname, undefined, media)
      assert.equal(response.status, 415)
      assert.equal(typeof response.body.error, 'string')
    }
  })
}

test('supported originless JSON calls and other methods retain behavior', async () => {
  assert.deepEqual(await request('POST', '/api/hook/nonexistent/event', '{}', 'application/json').then(r => [r.status, r.body]), [200, { ok: true }])
  assert.deepEqual(await request('POST', '/api/visible', '{"ids":[]}', 'application/json').then(r => [r.status, r.body]), [200, { ok: true }])
  const state = { syntheticNote: 'kept' }
  assert.equal((await request('PUT', '/api/state', JSON.stringify(state))).status, 200)
  assert.deepEqual((await request('GET', '/api/state')).body, state)
  assert.deepEqual(await request('DELETE', '/api/pty/nonexistent').then(r => [r.status, r.body]), [404, { error: 'no such console' }])
  const mcp = await request('POST', '/mcp/nonexistent', '{"jsonrpc":"2.0","id":1,"method":"synthetic-missing-method"}', 'application/json')
  assert.equal(mcp.status, 200)
  assert.deepEqual(mcp.body, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'unknown method synthetic-missing-method' } })
  assert.equal((await request('GET', '/mcp/nonexistent')).status, 405)
})

test('Host and Origin checks still precede JSON dispatch', async () => {
  assert.equal((await request('POST', '/api/visible', '{"ids":[]}', 'application/json', { Host: 'foreign.invalid' })).status, 403)
  assert.equal((await request('POST', '/api/visible', '{"ids":[]}', 'application/json', { Origin: 'https://foreign.invalid' })).status, 403)
})
