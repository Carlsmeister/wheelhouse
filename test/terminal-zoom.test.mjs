import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'

let server, browser, context, page
const deniedRequests = new Map()
const root = fileURLToPath(new URL('..', import.meta.url))
const text = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const fixture = (fn, arg) => page.evaluate(({ source, arg }) => {
  const f = window.terminalZoomFixture
  return (0, eval)(`(${source})`)(f, arg)
}, { source: fn.toString(), arg })
const geometry = () => fixture(f => {
  const r = f.terminal.element.querySelector('.xterm-screen').getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height, cols: f.terminal.cols, rows: f.terminal.rows }
})
const point = (g, x, y) => ({ x: g.left + x * g.width / g.cols, y: g.top + y * g.height / g.rows })
const diagnostic = (action, zoom, g, expected, actual) => JSON.stringify({ surface: 'terminal', action, zoom, rendered: g, expected, actual })
async function restrictFixtureRequests(context, origin) {
  const denied = []
  deniedRequests.set(context, denied)
  // Mutation runs may serve one explicitly supplied temporary bundle. Never
  // allow the containing scratch directory or arbitrary filesystem requests.
  const mutationFile = process.env.WHEELHOUSE_XTERM_TEST_PACKAGE && resolve(process.env.WHEELHOUSE_XTERM_TEST_PACKAGE, 'lib/xterm.mjs')
  const localMutation = mutationFile && relative(root, mutationFile)
  const mutationPaths = mutationFile ? [...(localMutation && !localMutation.startsWith('..') ? ['/' + localMutation] : []), '/@fs' + mutationFile, '/@fs/' + mutationFile].map(path => new URL(path, origin).pathname) : []
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const fixtureDocument = path === '/test/fixtures/terminal-zoom/' || path === '/test/fixtures/terminal-zoom/index.html'
    const fixtureModule = path === '/test/fixtures/terminal-zoom/main.tsx'
    const viteRuntime = ['/@vite/client', '/@react-refresh', '/node_modules/vite/dist/client/env.mjs'].includes(path)
    const sourceModule = /^\/(src|shared)\/.*\.(tsx?|m?js|css|svg|woff2?)$/.test(path)
    const optimizedModule = /^\/node_modules\/\.vite\/deps\/[^/]+\.js$/.test(path)
    const terminalAsset = /^\/node_modules\/@xterm\/xterm\/(lib\/xterm\.(mjs|js)|css\/xterm\.css)$/.test(path)
    const fontAsset = /^\/node_modules\/@fontsource-variable\/jetbrains-mono\/(index\.css|files\/[^/]+\.woff2?)$/.test(path)
    const flowStyles = path === '/node_modules/@xyflow/react/dist/style.css'
    const logoAsset = /^\/docs\/logo\/(light|dark)\.svg$/.test(path)
    const mutationAsset = mutationPaths.includes(path)
    if (request.method() === 'GET' && url.origin === origin && (fixtureDocument || fixtureModule || viteRuntime || sourceModule || optimizedModule || terminalAsset || fontAsset || flowStyles || logoAsset || mutationAsset)) return route.continue()
    denied.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() })
    return route.abort('blockedbyclient')
  })
}
async function drag(g, x1, y1, x2, y2) {
  const a = point(g, x1, y1), b = point(g, x2, y2)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up()
}
async function setup(zoom) {
  await page.mouse.up()
  const size = zoom === .08 ? 40 : 13
  await fixture((f, size) => f.fontSize(size), size)
  await page.waitForFunction(size => window.terminalZoomFixture.terminal.options.fontSize === size, size)
  await fixture((f, zoom) => f.setViewport({ x: 20, y: 20, zoom }), zoom)
  await fixture(f => f.reset())
  return geometry()
}
async function reports(mode, action) {
  await fixture((f, mode) => f.write(`\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1016l${mode}`), mode)
  await fixture(f => f.clearInput())
  await action()
  const result = await fixture(f => f.inputFrames())
  await fixture(f => f.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1016l'))
  return result
}
before(async () => {
  try {
    const mutationPackage = process.env.WHEELHOUSE_XTERM_TEST_PACKAGE
    server = await createServer({ root, configFile: false, plugins: [react()], resolve: { alias: mutationPackage ? [{ find: /^@xterm\/xterm$/, replacement: join(mutationPackage, 'lib/xterm.mjs') }] : [] }, optimizeDeps: { force: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, ...(mutationPackage ? [mutationPackage] : [])] } }, logLevel: 'error' })
    await server.listen()
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { width: 2600, height: 1900 } })
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await restrictFixtureRequests(context, origin)
    page = await context.newPage()
    page.setDefaultTimeout(5000)
    await page.addInitScript(() => document.addEventListener('mousedown', event => { window.lastFixturePointer = { x: event.clientX, y: event.clientY } }, true))
    await page.goto(origin + '/test/fixtures/terminal-zoom/')
    await page.waitForFunction(async () => window.terminalZoomFixture && await window.terminalZoomFixture.ready())
  } catch (error) { await context?.close(); await browser?.close(); await server?.close(); throw error }
})
after(async () => {
  await context?.close(); await browser?.close(); await server?.close()
  assert.deepEqual([...deniedRequests.values()].flat(), [], 'unexpected synthetic-browser requests (URL, method, resource type)')
})

// Removing BoardScreen's onNodeDoubleClick binding must break the framing
// assertions here. The fixture mounts the production screen and real store.
test('BoardScreen routes native double-clicks without stealing editable selections', async (t) => {
  const originalPage = page
  const isolated = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  try {
    const origin = new URL(originalPage.url()).origin
    await restrictFixtureRequests(isolated, origin)
    page = await isolated.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(origin + '/test/fixtures/terminal-zoom/?routing')
    await page.waitForFunction(async () => window.terminalZoomFixture && await window.terminalZoomFixture.ready())
    const prepare = async zoom => {
      await fixture(f => f.resize(640, 420))
      await setup(zoom)
      await fixture(f => f.write('\x1b[2J\x1b[Hhello native words'))
      await fixture(f => f.clearFrameCalls())
      return geometry()
    }
    for (const zoom of [1, 1.004]) await t.test(`displayed 100% preserves native terminal word selection at ${zoom}`, async () => {
      const g = await prepare(zoom), before = await fixture(f => f.viewport())
      const p = point(g, 2.5, .5)
      await page.mouse.dblclick(p.x, p.y)
      assert.equal(await fixture(f => f.terminal.getSelection()), 'hello')
      assert.deepEqual(await fixture(f => f.frameCalls()), [])
      assert.deepEqual(await fixture(f => f.viewport()), before)
    })
    for (const zoom of [.5, 2]) await t.test(`terminal double-click clears selection and frames at ${zoom}`, async () => {
      const g = await prepare(zoom)
      await fixture(f => f.terminal.select(0, 0, 5))
      const p = point(g, 2.5, .5)
      await page.mouse.dblclick(p.x, p.y)
      assert.deepEqual(await fixture(f => f.frameCalls()), [['terminal']])
      assert.equal(await fixture(f => f.terminal.getSelection()), '')
      await page.waitForFunction(() => Math.abs(window.terminalZoomFixture.viewport().zoom - 1) < .00001)
    })
    await t.test('oversized terminal framing remains below maxZoom 1', async () => {
      await prepare(.5)
      await fixture(f => f.resize(3400, 2200))
      await page.waitForFunction(() => window.terminalZoomFixture.terminal.cols > 200)
      const p = point(await geometry(), 2.5, .5)
      await page.mouse.dblclick(p.x, p.y)
      assert.deepEqual(await fixture(f => f.frameCalls()), [['terminal']])
      await page.waitForFunction(() => window.terminalZoomFixture.viewport().zoom < .45)
      assert.equal(await fixture(f => f.terminal.getSelection()), '')
    })
    for (const surface of ['header', 'background']) await t.test(`console ${surface} still frames`, async () => {
      await prepare(.5)
      const selector = surface === 'header' ? '.console-head > .dot' : '.console-body'
      const bounds = await page.locator(selector).boundingBox()
      // Body padding is outside xterm. The header dot is noninteractive.
      await page.mouse.dblclick(bounds.x + (surface === 'header' ? bounds.width / 2 : 2), bounds.y + bounds.height / 2)
      assert.deepEqual(await fixture(f => f.frameCalls()), [['terminal']])
      await page.waitForFunction(() => Math.abs(window.terminalZoomFixture.viewport().zoom - 1) < .00001)
    })
    await t.test('console name editing keeps its native selection and never frames', async () => {
      await prepare(.5)
      await page.locator('.console-head span.name').dblclick()
      const input = page.locator('.console-head input.name')
      await input.dblclick({ position: { x: 20, y: 8 } })
      assert.equal(await input.evaluate(e => e.selectionEnd > e.selectionStart), true)
      await page.keyboard.type('Renamed')
      assert.match(await input.inputValue(), /Renamed/)
      assert.deepEqual(await fixture(f => f.frameCalls()), [])
      await page.keyboard.press('Enter')
    })
    for (const zoom of [.5, 1, 2]) await t.test(`note textarea retains native selection/editing at ${zoom}`, async () => {
      await prepare(zoom)
      // Pan the actual note into the usable viewport at each zoom.
      await fixture((f, zoom) => f.setViewport({ x: 240 - 740 * zoom, y: 200 - 180 * zoom, zoom }), zoom)
      const textarea = page.locator('.note-node textarea')
      await textarea.fill('native note words')
      await textarea.dblclick({ position: { x: 22, y: 12 } })
      assert.equal(await textarea.evaluate(e => e.selectionEnd > e.selectionStart), true)
      await page.keyboard.type('edited')
      assert.match(await textarea.inputValue(), /edited/)
      assert.deepEqual(await fixture(f => f.frameCalls()), [])
      assert.equal(await fixture(f => f.viewport().zoom), zoom)
    })
    await t.test('CodeView editor retains native selection and editing', async () => {
      await prepare(.5)
      await fixture(f => f.openCode())
      await page.locator('.ft-row', { hasText: 'fixture.ts' }).click()
      const word = page.locator('.cm-line').filter({ hasText: 'syntheticWord' })
      await word.dblclick({ position: { x: 75, y: 8 } })
      assert.equal(await page.evaluate(() => getSelection()?.toString()), 'syntheticWord')
      await page.keyboard.type('editedWord')
      assert.match(await page.locator('.cm-content').innerText(), /editedWord/)
      assert.deepEqual(await fixture(f => f.frameCalls()), [])
      assert.equal(await fixture(f => f.viewport().zoom), .5)
      await fixture(f => f.closeModal())
    })
  } finally { page = originalPage; await isolated.close() }
})

test('synthetic browser rejects and diagnoses unexpected same-origin API requests', async () => {
  const target = new URL('/api/request-policy-probe.png', page.url()).href
  const requested = page.waitForRequest(target)
  await page.evaluate(target => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => resolve(); image.src = target }), target)
  const request = await requested
  await request.response()
  assert.match(request.failure()?.errorText ?? '', /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/, 'unexpected same-origin /api request must be aborted, not served by Vite')
  const denied = deniedRequests.get(context), index = denied.findIndex(request => request.url === target)
  assert.notEqual(index, -1, 'blocked API request must have a diagnostic')
  assert.deepEqual(denied.splice(index, 1), [{ url: target, method: 'GET', resourceType: 'image' }])
})

for (const zoom of [.5, 1, 2, .08, .67, 1.33, 2.5]) {
  test(`terminal native drag selection matches rendered text at zoom ${zoom}`, async () => {
    const g = await setup(zoom)
    await drag(g, 5.1, 3.5, 15.1, 3.5)
    const actual = await fixture(f => ({ position: f.terminal.getSelectionPosition(), text: f.terminal.getSelection() }))
    const expected = { position: { start: { x: 5, y: 3 }, end: { x: 15, y: 3 } }, text: text.slice(5, 15) }
    assert.deepEqual(actual, expected, diagnostic('native drag selection', zoom, g, expected, actual))
  })
  test(`terminal SGR first/interior/last cells match rendered characters at zoom ${zoom}`, async () => {
    const g = await setup(zoom)
    for (const [x, y] of [[.5, .5], [10.5, 3.5], [g.cols - .5, g.rows - .5]]) {
      const p = point(g, x, y), col = Math.floor(x) + 1, row = Math.floor(y) + 1
      const actual = await reports('\x1b[?1000h\x1b[?1006h', () => page.mouse.click(p.x, p.y))
      const expected = [`\x1b[<0;${col};${row}M`, `\x1b[<0;${col};${row}m`]
      assert.deepEqual(actual, expected, diagnostic('SGR press/release', zoom, g, expected, actual))
    }
  })
}
for (const zoom of [.5, 1, 2]) {
  test(`terminal scrollback selection uses buffer rows at zoom ${zoom}`, async () => {
    const g = await setup(zoom)
    await fixture(f => f.reset(180))
    await fixture(f => f.terminal.scrollToLine(70))
    await drag(g, 5.1, 3.5, 15.1, 3.5)
    assert.deepEqual(await fixture(f => f.terminal.getSelectionPosition()), { start: { x: 5, y: 73 }, end: { x: 15, y: 73 } })
    assert.equal(await fixture(f => f.terminal.getSelection()), text.slice(5, 15))
  })
  test(`terminal native document drag/autoscroll respects visible bounds at zoom ${zoom}`, async () => {
    const g = await setup(zoom)
    await fixture(f => f.reset(180))
    await fixture(f => f.terminal.scrollToLine(70))
    const initial = await fixture(f => f.terminal.buffer.active.viewportY)
    const start = point(g, 5.1, 3.5), inside = point(g, 15.1, g.rows - .5)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(inside.x, inside.y, { steps: 8 })
    await sleep(180)
    const stable = await fixture(f => f.terminal.buffer.active.viewportY)
    assert.equal(stable, initial, diagnostic('inside-viewport drag must not autoscroll', zoom, g, initial, stable))
    const below = point(g, 15.1, g.rows + 1)
    await page.mouse.move(below.x, below.y)
    await page.waitForFunction(initial => window.terminalZoomFixture.terminal.buffer.active.viewportY > initial, initial)
    const above = point(g, 15.1, -1)
    const bottom = await fixture(f => f.terminal.buffer.active.viewportY)
    await page.mouse.move(above.x, above.y)
    await page.waitForFunction(bottom => window.terminalZoomFixture.terminal.buffer.active.viewportY < bottom, bottom)
    await page.mouse.up()
    const released = await fixture(f => f.terminal.buffer.active.viewportY)
    await sleep(180)
    assert.equal(await fixture(f => f.terminal.buffer.active.viewportY), released, 'document mouseup stops native autoscroll')
    await fixture(f => f.terminal.scrollToTop())
    await drag(g, 5.1, 3.5, 15.1, 3.5)
    assert.equal(await fixture(f => f.terminal.getSelection()), text.slice(5, 15))
  })
}
test('terminal focus and keyboard bytes survive board zoom and blur', async () => {
  for (const zoom of [.5, 1, 2]) {
    const g = await setup(zoom), p = point(g, 10.5, 3.5)
    await page.evaluate(() => { const input = document.createElement('input'); input.id = 'blur-target'; document.body.append(input); input.focus() })
    await page.mouse.click(p.x, p.y); await fixture(f => f.clearInput())
    await page.keyboard.type('abc'); await page.keyboard.press('ArrowLeft')
    assert.equal(await fixture(f => document.activeElement === f.terminal.textarea), true)
    assert.deepEqual(await fixture(f => f.inputFrames()), ['a', 'b', 'c', '\x1b[D'])
    await page.locator('#blur-target').evaluate(e => e.remove())
  }
})

for (const zoom of [.5, 1, 2]) {
  test(`terminal tracking, pixel reports, modifiers and wheel retain protocol at zoom ${zoom}`, async () => {
    const g = await setup(zoom), a = point(g, 10.5, 3.5), b = point(g, 11.5, 4.5)
    let actual = await reports('\x1b[?1002h\x1b[?1006h', async () => {
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up()
    })
    assert.deepEqual(actual, ['\x1b[<0;11;4M', '\x1b[<32;12;5M', '\x1b[<0;12;5m'], diagnostic('drag tracking', zoom, g, 'SGR drag sequence', actual))
    actual = await reports('\x1b[?1003h\x1b[?1006h', () => page.mouse.move(a.x, a.y))
    assert.deepEqual(actual, ['\x1b[<35;11;4M'])
    actual = await reports('\x1b[?1000h\x1b[?1006h', async () => {
      await page.keyboard.down('Control'); await page.mouse.click(a.x, a.y); await page.keyboard.up('Control')
      await page.mouse.wheel(0, 100)
      // Wheel delivery is asynchronous in Chromium. Wait for an observed frame, not a guessed delay.
      await page.waitForFunction(() => window.terminalZoomFixture.inputFrames().length >= 3).catch(async error => { throw new Error(`${error.message}; captured=${JSON.stringify(await fixture(f => f.inputFrames()))}`) })
    })
    assert.deepEqual(actual, ['\x1b[<16;11;4M', '\x1b[<16;11;4m', '\x1b[<65;11;4M'])
    // Board transform is independently declared; local CSS distance is the
    // rendered grid distance divided by that declared scale, never patch metrics.
    const pixelPoint = { x: Math.round(a.x), y: Math.round(a.y) }
    // xterm 6 preserves zero-based pixel fields; only cell fields are 1-based.
    const px = Math.floor((pixelPoint.x - g.left) / zoom)
    const py = Math.floor((pixelPoint.y - g.top) / zoom)
    actual = await reports('\x1b[?1000h\x1b[?1006h\x1b[?1016h', () => page.mouse.click(pixelPoint.x, pixelPoint.y))
    assert.deepEqual(actual, [`\x1b[<0;${px};${py}M`, `\x1b[<0;${px};${py}m`], diagnostic('pixel reports', zoom, g, { px, py }, actual))
  })
}

test('terminal resize and font changes use fresh geometry without reconnect', async () => {
  await setup(.67)
  const before = await geometry(), sockets = await fixture(f => f.socketCount())
  await fixture(f => f.resize(800, 540))
  await page.waitForFunction(cols => window.terminalZoomFixture.terminal.cols !== cols, before.cols)
  const resized = await geometry()
  await fixture(f => f.fontSize(18))
  await page.waitForFunction(cols => window.terminalZoomFixture.terminal.cols !== cols, resized.cols)
  await fixture(f => f.setViewport({ x: 20, y: 20, zoom: 1.33 }))
  await fixture(f => f.reset())
  const g = await geometry()
  await drag(g, 5.1, 3.5, 15.1, 3.5)
  assert.equal(await fixture(f => f.terminal.getSelection()), text.slice(5, 15))
  const p = point(g, 10.5, 3.5)
  assert.deepEqual(await reports('\x1b[?1000h\x1b[?1006h', () => page.mouse.click(p.x, p.y)), ['\x1b[<0;11;4M', '\x1b[<0;11;4m'])
  assert.equal(await fixture(f => f.socketCount()), sockets)
  await fixture(f => f.fontSize(13))
  await fixture(f => f.resize(640, 420))
})

async function standalone(bundle, dpr = 1) {
  const isolated = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: dpr })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  await restrictFixtureRequests(isolated, origin)
  const tab = await isolated.newPage()
  tab.setDefaultTimeout(5000)
  await tab.goto(origin + '/test/fixtures/terminal-zoom/')
  await tab.waitForFunction(async () => window.terminalZoomFixture && await window.terminalZoomFixture.ready())
  await tab.evaluate(async bundle => {
    let Constructor
    if (bundle === 'xterm.js') {
      await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/node_modules/@xterm/xterm/lib/xterm.js'; script.onload = resolve; script.onerror = reject; document.head.append(script) })
      Constructor = window.Terminal
    } else Constructor = (await import('/node_modules/@xterm/xterm/lib/xterm.mjs')).Terminal
    const wrapper = document.createElement('div')
    Object.assign(wrapper.style, { position: 'fixed', left: '220px', top: '200px', zIndex: '100', transformOrigin: '0 0', border: '3px solid blue', padding: '5px', background: '#fff' })
    document.body.append(wrapper)
    const term = new Constructor({ cols: 60, rows: 10, fontSize: 13, scrollback: 200, fontFamily: 'monospace' })
    term.open(wrapper)
    const frames = []
    term.onData(data => frames.push(data))
    const write = data => new Promise(resolve => term.write(data, resolve))
    await write(Array.from({ length: 10 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx').join('\r\n'))
    window.standaloneTerminal = { term, wrapper, frames, write }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, bundle)
  return { tab, close: () => isolated.close() }
}

for (const bundle of ['xterm.mjs', 'xterm.js']) {
  test(`${bundle} standalone padding, fractional box and anisotropic transforms preserve pixel coordinates`, async () => {
    const { tab, close } = await standalone(bundle)
    try {
      for (const boxSizing of ['content-box', 'border-box']) {
        const local = await tab.evaluate(boxSizing => {
          const { term, wrapper } = window.standaloneTerminal
          const screen = term.element.querySelector('.xterm-screen')
          Object.assign(screen.style, { width: '600.25px', height: '180.375px', boxSizing, padding: '7px 11px', border: '2px solid green' })
          // Pixel assertions preserve native screen-border semantics: subtract
          // padding only. Character-grid assertions keep borders on wrapper.
          wrapper.style.transform = 'scale(0.67,1.33)'
          const r = screen.getBoundingClientRect()
          return { left: r.left, top: r.top }
        }, boxSizing)
        await tab.evaluate(async () => { const s = window.standaloneTerminal; await s.write('\x1b[?1000h\x1b[?1006h\x1b[?1016h'); s.frames.length = 0 })
        const outerWidth = boxSizing === 'border-box' ? 600.25 : 626.25
        // Pick an integer browser pointer whose pixel result changes if the
        // fractional declared used extent is replaced by rounded offsetWidth.
        const sensitiveX = Array.from({ length: 260 }, (_, i) => Math.ceil(local.left + 20) + i).find(x => {
          const distance = (x - local.left) / .67
          return Math.floor(distance - 11) !== Math.floor(distance * Math.round(outerWidth) / outerWidth - 11)
        })
        assert.notEqual(sensitiveX, undefined, 'fixture must expose integer offsetWidth rounding')
        for (const x of [Math.round(local.left + (211.4 + 11) * .67), sensitiveX]) {
          const p = { x, y: Math.round(local.top + (51.4 + 7) * 1.33) }
          await tab.evaluate(() => { window.standaloneTerminal.frames.length = 0 })
          await tab.mouse.click(p.x, p.y)
          const actual = await tab.evaluate(() => window.standaloneTerminal.frames)
          const expected = [`\x1b[<0;${Math.floor((p.x - local.left) / .67 - 11)};${Math.floor((p.y - local.top) / 1.33 - 7)}M`, `\x1b[<0;${Math.floor((p.x - local.left) / .67 - 11)};${Math.floor((p.y - local.top) / 1.33 - 7)}m`]
          assert.deepEqual(actual, expected, JSON.stringify({ bundle, boxSizing, action: 'independent declared-transform pixel oracle', expected, actual }))
        }
      }
      // Hidden geometry uses a finite fallback. Dispatch is only used here:
      // a hidden terminal cannot receive real pointer input.
      assert.equal(await tab.evaluate(() => {
        const s = window.standaloneTerminal; s.wrapper.style.display = 'none'; s.frames.length = 0
        s.term.element.querySelector('.xterm-screen').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 2, clientY: 2, button: 0 }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
        return s.frames.every(frame => !frame.includes('NaN') && !frame.includes('Infinity'))
      }), true)
    } finally { await close() }
  })
  test(`${bundle} standalone native selection and SGR use rendered cells at DPR 2`, async () => {
    const { tab, close } = await standalone(bundle, 2)
    try {
      for (const zoom of [.5, 1, 2]) {
        const g = await tab.evaluate(zoom => {
          const s = window.standaloneTerminal; s.wrapper.style.transform = `scale(${zoom})`; s.term.clearSelection()
          const r = s.term.element.querySelector('.xterm-screen').getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height, cols: s.term.cols, rows: s.term.rows }
        }, zoom)
        const a = point(g, 5.1, 3.5), b = point(g, 15.1, 3.5)
        await tab.mouse.move(a.x, a.y); await tab.mouse.down(); await tab.mouse.move(b.x, b.y, { steps: 8 }); await tab.mouse.up()
        assert.deepEqual(await tab.evaluate(() => ({ position: window.standaloneTerminal.term.getSelectionPosition(), text: window.standaloneTerminal.term.getSelection() })), { position: { start: { x: 5, y: 3 }, end: { x: 15, y: 3 } }, text: text.slice(5, 15) })
        await tab.evaluate(async () => { const s = window.standaloneTerminal; await s.write('\x1b[?1000h\x1b[?1006h'); s.frames.length = 0 })
        const p = point(g, 10.5, 3.5); await tab.mouse.click(p.x, p.y)
        assert.deepEqual(await tab.evaluate(() => window.standaloneTerminal.frames), ['\x1b[<0;11;4M', '\x1b[<0;11;4m'])
        await tab.evaluate(() => window.standaloneTerminal.write('\x1b[?1000l\x1b[?1006l'))
      }
    } finally { await close() }
  })
}

test('real ConsoleNode selection and SGR remain correct on a translated DPR 2 board', async () => {
  const originalPage = page
  const isolated = await browser.newContext({ viewport: { width: 2600, height: 1900 }, deviceScaleFactor: 2 })
  try {
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    await restrictFixtureRequests(isolated, origin)
    page = await isolated.newPage()
    await page.goto(origin + '/test/fixtures/terminal-zoom/')
    await page.waitForFunction(async () => window.terminalZoomFixture && await window.terminalZoomFixture.ready())
    for (const zoom of [.5, 1, 2]) {
      await setup(zoom)
      await fixture((f, zoom) => f.setViewport({ x: 173, y: 89, zoom }), zoom)
      const g = await geometry()
      await drag(g, 5.1, 3.5, 15.1, 3.5)
      assert.deepEqual(await fixture(f => ({ position: f.terminal.getSelectionPosition(), text: f.terminal.getSelection() })), { position: { start: { x: 5, y: 3 }, end: { x: 15, y: 3 } }, text: text.slice(5, 15) })
      const p = point(g, 10.5, 3.5)
      assert.deepEqual(await reports('\x1b[?1000h\x1b[?1006h', () => page.mouse.click(p.x, p.y)), ['\x1b[<0;11;4M', '\x1b[<0;11;4m'])
    }
  } finally { page = originalPage; await isolated.close() }
})
