import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, cp, symlink, appendFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, preview } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
let backend, dev, built, browser, home, probe
const delivered = new Map()
const counts = { form: 0, remote: 0 }

async function unusedPort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  assert.ok(port > 0)
  return port
}

async function startBackend() {
  const env = { ...process.env, HOME: home, WHEELHOUSE_DATA: path.join(home, 'board') }
  delete env.NODE_ENV
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await unusedPort()
    const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const origin = `http://127.0.0.1:${port}`
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`backend startup timed out: ${output}`)) }, 10000)
        const ready = chunk => { if (String(chunk).includes('Wheelhouse server on')) { cleanup(); resolve() } }
        const exited = code => { cleanup(); reject(new Error(`backend exited ${code}: ${output}`)) }
        const cleanup = () => { clearTimeout(timer); child.stdout.off('data', ready); child.off('exit', exited); child.off('error', exited) }
        child.stdout.on('data', ready); child.once('exit', exited); child.once('error', exited)
      })
      return { child, origin, port }
    } catch (error) {
      if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
      if (!output.includes('is in use by another program') || attempt === 2) throw error
    }
  }
}

async function startDev(projectRoot) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const server = await createServer({
      root: projectRoot, configFile: path.join(projectRoot, 'vite.config.ts'),
      cacheDir: path.join(projectRoot === root ? home : projectRoot, '.vite'),
      server: { host: '127.0.0.1', port: await unusedPort(), strictPort: true, fs: { allow: [projectRoot, path.join(root, 'node_modules')] } }, logLevel: 'error',
    })
    try { await server.listen(); return server }
    catch (error) {
      await server.close()
      if (!String(error).includes('already in use') || attempt === 2) throw error
    }
  }
}

async function startPreview() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await preview({ root, configFile: path.join(root, 'vite.config.ts'), preview: { host: '127.0.0.1', port: await unusedPort(), strictPort: true }, logLevel: 'error' })
    } catch (error) {
      if (!String(error).includes('already in use') || attempt === 2) throw error
    }
  }
}

const originOf = server => `http://127.0.0.1:${server.httpServer.address().port}`

before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'page-policy-'))
  backend = await startBackend()
  dev = await startDev(root)
  built = await startPreview()
  for (const [name, origin, pathname] of [
    ['backend root', backend.origin, '/'], ['backend fallback', backend.origin, '/synthetic-page'],
    ['Vite development', originOf(dev), '/'], ['Vite preview', originOf(built), '/'],
  ]) {
    const response = await fetch(origin + pathname)
    assert.equal(response.status, 200, name)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(await response.text(), /id="root"/)
    delivered.set(name, response.headers.get('content-security-policy') ?? '')
  }
  probe = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://test')
    if (url.pathname === '/form-counter') { counts.form++; return res.writeHead(200, { 'content-type': 'text/html' }).end('received') }
    if (url.pathname === '/local.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(png)
    const policy = delivered.get(url.searchParams.get('policy'))
    res.writeHead(200, { 'content-type': 'text/html', ...(policy ? { 'content-security-policy': policy } : {}) })
    res.end('<!doctype html><title>Synthetic page</title><iframe name="sink"></iframe>')
  })
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  await dev?.close()
  if (built) await new Promise(resolve => built.httpServer.close(resolve))
  if (probe) await new Promise(resolve => probe.close(resolve))
  if (backend?.child.exitCode === null) { backend.child.kill('SIGTERM'); await once(backend.child, 'exit') }
  if (home) await rm(home, { recursive: true, force: true })
})

const directives = policy => new Map(policy.split(';').filter(part => part.trim()).map(part => {
  const [name, ...tokens] = part.trim().split(/\s+/)
  return [name, tokens.sort()]
}))

function assertPolicy(policy, development, port) {
  const parsed = directives(policy)
  assert.deepEqual(parsed.get('form-action'), ["'none'"], 'form submission must be disabled')
  assert.deepEqual(parsed.get('img-src'), ["'self'", 'blob:', 'data:'], 'remote images must be excluded')
  for (const [name, tokens] of [
    ['default-src', ["'self'"]], ['style-src', ["'self'", "'unsafe-inline'"]],
    ['font-src', ["'self'", 'data:']], ['frame-src', ['http:', 'https:']],
    ['object-src', ["'none'"]], ['base-uri', ["'none'"]],
  ]) assert.deepEqual(parsed.get(name), tokens, name)
  assert.deepEqual(parsed.get('script-src'), development ? ["'self'", "'unsafe-inline'"] : ["'self'"], 'development script relaxation must not reach production')
  const connections = parsed.get('connect-src')
  assert.ok(connections?.includes("'self'"))
  if (development) {
    assert.deepEqual(connections, ["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*'])
  } else assert.deepEqual(connections, ["'self'", `ws://127.0.0.1:${port}`, `ws://localhost:${port}`])
}

// These invariants catch widening production script/image policy and losing unrelated protections.
test('policy builder separates production and development permissions', async () => {
  const { applicationCsp } = await import('../shared/content-security.js')
  assertPolicy(applicationCsp(4318), false, 4318)
  assertPolicy(applicationCsp(4318, true), true, 4318)
})

for (const name of ['backend root', 'backend fallback', 'Vite development', 'Vite preview']) {
  // Dropping either server's actual header wiring must fail independently of the pure builder.
  test(`${name} delivers the application page policy`, () => {
    assertPolicy(delivered.get(name), name === 'Vite development', name.startsWith('backend') ? backend.port : 4318)
  })
}

async function exercisePolicy(name) {
  counts.form = 0; counts.remote = 0
  const context = await browser.newContext()
  try {
    // Fulfill forbidden requests if the browser sends them. Interception cannot supply CSP enforcement.
    await context.route('https://image.example.invalid/synthetic-remote.png', route => {
      counts.remote++
      return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    const page = await context.newPage()
    const probeOrigin = `http://127.0.0.1:${probe.address().port}`
    await page.goto(`${probeOrigin}/?policy=${encodeURIComponent(name)}`)
    const result = await page.evaluate(async data => {
      const violations = []
      document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective))
      const form = document.createElement('form')
      form.action = '/form-counter'; form.target = 'sink'; form.method = 'GET'
      document.body.append(form)
      form.requestSubmit()
      const blob = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: 'image/png' }))
      const images = await Promise.all([
        ['local', '/local.png'], ['data', `data:image/png;base64,${data}`],
        ['blob', blob], ['remote', 'https://image.example.invalid/synthetic-remote.png'],
      ].map(([name, src]) => new Promise(resolve => {
        const img = new Image()
        img.onload = img.onerror = () => resolve([name, img.naturalWidth])
        img.src = src; document.body.append(img)
      })))
      // Violation events are queued separately from image errors.
      await new Promise(resolve => setTimeout(resolve, 100))
      URL.revokeObjectURL(blob)
      return { widths: Object.fromEntries(images), violations }
    }, png.toString('base64'))
    return { ...result, form: counts.form, remote: counts.remote }
  } finally { await context.close() }
}

test('no-policy control reaches both counters and loads every image', async () => {
  const result = await exercisePolicy('no policy')
  assert.equal(result.form, 1)
  assert.equal(result.remote, 1)
  assert.deepEqual(result.widths, { local: 1, data: 1, blob: 1, remote: 1 })
  assert.deepEqual(result.violations, [])
})

for (const name of ['backend root', 'backend fallback', 'Vite development', 'Vite preview']) {
  // Removing form-action or widening img-src must cause a real counter hit.
  test(`${name} blocks form and remote image requests while allowing local data and blob images`, async () => {
    const result = await exercisePolicy(name)
    assert.deepEqual({ form: result.form, remote: result.remote }, { form: 0, remote: 0 }, 'forbidden requests reached their counters')
    assert.deepEqual(result.widths, { local: 1, data: 1, blob: 1, remote: 0 })
    assert.ok(result.violations.includes('form-action'), JSON.stringify(result.violations))
    assert.ok(result.violations.includes('img-src'), JSON.stringify(result.violations))
  })
}

async function appPage(server) {
  const context = await browser.newContext()
  const unexpected = []
  await context.route('**/api/**', route => {
    const request = route.request(), pathname = new URL(request.url()).pathname
    let body
    if (request.method() === 'GET' && pathname === '/api/state') body = { projects: [], active: null }
    else if (request.method() === 'GET' && pathname === '/api/agents') body = []
    else if (request.method() === 'GET' && pathname === '/api/ls') body = { path: '/synthetic', parent: '/', dirs: [], isRepo: false }
    else if (request.method() === 'PUT' && pathname === '/api/state') body = { ok: true }
    else { unexpected.push(`${request.method()} ${pathname}`); body = { error: 'unexpected test request' } }
    return route.fulfill({ status: body.error ? 400 : 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.routeWebSocket('**/ws/events', socket => {
    socket.send(JSON.stringify({ type: 'sessions', sessions: [] }))
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(originOf(server))
  await page.locator('#root h1').filter({ hasText: 'One board for your agents.' }).waitFor()
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  return { context, page, errors, unexpected }
}

test('configured development page mounts the actual React app', async () => {
  const { context } = await appPage(dev)
  await context.close()
})

test('configured development policy permits HMR in a disposable source copy', async () => {
  const copy = await mkdtemp(path.join(os.tmpdir(), 'page-hmr-'))
  let server, context
  try {
    for (const entry of ['src', 'shared', 'docs', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json']) {
      await cp(path.join(root, entry), path.join(copy, entry), { recursive: true })
    }
    await symlink(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir')
    server = await startDev(copy)
    const app = await appPage(server)
    context = app.context
    // Observe the real Vite client event before touching only the copied source.
    await app.page.evaluate(async () => {
      const hot = (await import('/@vite/client')).createHotContext('/test-policy-observer')
      hot.on('vite:afterUpdate', () => { window.policyHotUpdated = true })
    })
    await appendFile(path.join(copy, 'src', 'App.tsx'), '\n// Synthetic hot-update check.\n')
    await app.page.waitForFunction(() => window.policyHotUpdated === true)
    assert.equal(await app.page.locator('#root h1').textContent(), 'One board for your agents.')
    assert.deepEqual(app.errors, [])
    assert.deepEqual(app.unexpected, [])
  } finally {
    await context?.close()
    await server?.close()
    await rm(copy, { recursive: true, force: true })
  }
})
