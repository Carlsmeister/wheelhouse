import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
let server, browser, context, page, cacheDir
const captured = [], unexpected = []

before(async () => {
  cacheDir = await mkdtemp(path.join(root, 'node_modules', '.vite-api-client-'))
  const optimizedPrefix = `/${path.relative(root, cacheDir).split(path.sep).join('/')}/deps/`
  server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext()
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      captured.push({ method: request.method(), url: url.pathname, media: request.headers()['content-type'] ?? null, body: request.postData() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    }
    const optimizedModule = url.pathname.startsWith(optimizedPrefix)
      && /^(marked|dompurify|chunk-[\w-]+)\.js$/.test(url.pathname.slice(optimizedPrefix.length))
    const allowed = ['/test/fixtures/markdown-security/', '/test/fixtures/markdown-security/main.ts', '/src/markdown.ts', '/src/api.ts', '/@vite/client', '/node_modules/vite/dist/client/env.mjs'].includes(url.pathname) || optimizedModule
    if (url.origin === origin && request.method() === 'GET' && allowed) return route.continue()
    unexpected.push(request.url())
    return route.abort('blockedbyclient')
  })
  page = await context.newPage()
  const diagnostics = []
  page.on('pageerror', error => diagnostics.push(error.message))
  page.on('response', response => { if (response.status() >= 400) diagnostics.push(`${response.status()} ${response.url()}`) })
  page.on('requestfailed', request => diagnostics.push(`${request.failure()?.errorText} ${request.url()}`))
  await page.goto(origin + '/test/fixtures/markdown-security/')
  await page.waitForFunction(() => !!window.markdownFixture).catch(error => {
    throw new Error(`API client fixture did not initialize: ${JSON.stringify(diagnostics)}`, { cause: error })
  })
})

after(async () => {
  try { await context?.close(); await browser?.close() }
  finally {
    try { await server?.close() }
    finally { if (cacheDir) await rm(cacheDir, { recursive: true, force: true }) }
  }
  assert.deepEqual(unexpected, [], 'client fixture made unexpected requests')
})

// Only transport is synthetic: each request is formed by the real imported API client.
for (const [name, url] of [['stop', '/api/pty/synthetic-missing-id/stop'], ['runLoop', '/api/loops/synthetic-missing-id/run']]) {
  test(`${name} sends a JSON object for a bodyless POST`, async () => {
    captured.length = 0
    await page.evaluate(async name => { const { api } = await import('/src/api.ts'); await api[name]('synthetic-missing-id') }, name)
    assert.deepEqual(captured, [{ method: 'POST', url, media: 'application/json', body: '{}' }])
  })
}

test('GET and DELETE retain absent body and content type', async () => {
  captured.length = 0
  await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await api.getState(); await api.kill('synthetic-missing-id') })
  assert.deepEqual(captured, [
    { method: 'GET', url: '/api/state', media: null, body: null },
    { method: 'DELETE', url: '/api/pty/synthetic-missing-id', media: null, body: null },
  ])
})

test('defined POST and PUT data remain JSON unchanged', async () => {
  captured.length = 0
  await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await api.visible([]); await api.putState({ syntheticNote: 'kept' }) })
  assert.deepEqual(captured, [
    { method: 'POST', url: '/api/visible', media: 'application/json', body: '{"ids":[]}' },
    { method: 'PUT', url: '/api/state', media: 'application/json', body: '{"syntheticNote":"kept"}' },
  ])
})
