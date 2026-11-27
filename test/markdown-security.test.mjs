import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let server, browser, context, page
const unexpectedRequests = []

before(async () => {
  try {
    // This isolated renderer fixture does not exercise application CSP delivery.
    server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      const allowed = [
        '/test/fixtures/markdown-security/', '/test/fixtures/markdown-security/index.html',
        '/test/fixtures/markdown-security/main.ts', '/src/markdown.ts',
        '/@vite/client', '/node_modules/vite/dist/client/env.mjs',
      ].includes(url.pathname) || /^\/node_modules\/\.vite\/deps\/(marked|dompurify|chunk-[\w-]+)\.js$/.test(url.pathname)
      if (request.method() === 'GET' && url.origin === origin && allowed) return route.continue()
      unexpectedRequests.push({ url: request.url(), method: request.method(), type: request.resourceType() })
      return route.abort('blockedbyclient')
    })
    page = await context.newPage()
    await page.goto(origin + '/test/fixtures/markdown-security/')
    await page.waitForFunction(() => !!window.markdownFixture)
  } catch (error) {
    await context?.close(); await browser?.close(); await server?.close()
    throw error
  }
})
after(async () => {
  await context?.close(); await browser?.close(); await server?.close()
  assert.deepEqual(unexpectedRequests, [], 'renderer fixture made unexpected requests')
})

// Detached templates inspect the reparsed output without activating content.
async function inspect(markdown) {
  return page.evaluate(markdown => {
    const template = document.createElement('template')
    template.innerHTML = window.markdownFixture.renderMarkdown(markdown)
    const fragment = template.content
    return {
      html: template.innerHTML,
      text: fragment.textContent,
      elements: [...fragment.querySelectorAll('*')].map(element => ({
        tag: element.localName, text: element.textContent,
        attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])),
      })),
    }
  }, markdown)
}

// Omitting any forbidden tag must retain a prohibited element and fail its case.
for (const [tag, markup] of [
  ['form', '<form>content</form>'],
  ['input', '<input value="content">'],
  ['button', '<button>content</button>'],
  ['textarea', '<textarea>content</textarea>'],
  ['select', '<select><option>content</option></select>'],
  ['option', '<option>content</option>'],
  ['optgroup', '<optgroup label="content"><option>choice</option></optgroup>'],
  ['fieldset', '<fieldset>content</fieldset>'],
  ['legend', '<legend>content</legend>'],
  ['datalist', '<datalist><option>content</option></datalist>'],
  ['output', '<output>content</output>'],
  ['style', '<style>.synthetic-note { color: red }</style>'],
]) {
  test(`renderMarkdown removes ${tag} while preserving surrounding text`, async () => {
    const result = await inspect(`before\n\n${markup}\n\nafter`)
    assert.equal(result.elements.some(element => element.tag === tag), false, `${tag} survived sanitization`)
    assert.match(result.text, /before/)
    assert.match(result.text, /after/)
  })
}

test('renderMarkdown removes inline style and mixed-case prohibited HTML', async () => {
  const result = await inspect('<FoRm><BuTtOn>label</BuTtOn></FoRm><p StYlE="color:red">plain</p>')
  assert.equal(result.elements.some(element => ['form', 'button'].includes(element.tag)), false)
  assert.equal(result.elements.some(element => 'style' in element.attributes), false)
  assert.match(result.text, /plain/)
})

test('renderMarkdown removes event attributes and unsafe link URLs', async () => {
  const result = await inspect('<p onclick="void 0">plain</p><a href="javascript:void(0)" onmouseover="void 0">link</a>')
  assert.equal(result.elements.some(element => Object.keys(element.attributes).some(name => /^on/i.test(name))), false)
  const anchor = result.elements.find(element => element.tag === 'a')
  assert.ok(anchor)
  assert.equal('href' in anchor.attributes, false)
  assert.match(result.text, /plain/)
  assert.match(result.text, /link/)
})

test('renderMarkdown preserves headings, emphasis, lists, code and blockquotes', async () => {
  const result = await inspect('# Heading\n\n**bold** *italic* ~~struck~~\n\n- unordered\n\n1. ordered\n\n`inline`\n\n```txt\n<literal>\n```\n\n> quoted')
  for (const [tag, text] of [['h1', 'Heading'], ['strong', 'bold'], ['em', 'italic'], ['del', 'struck'], ['ul', 'unordered'], ['ol', 'ordered'], ['code', 'inline'], ['pre', '<literal>'], ['blockquote', 'quoted']]) {
    assert.ok(result.elements.some(element => element.tag === tag && element.text.includes(text)), `${tag}: ${text}`)
  }
  assert.equal(result.elements.some(element => element.tag === 'literal'), false)
})

test('renderMarkdown preserves table alignment attributes and callout labels', async () => {
  const result = await inspect('| Left | Center | Right |\n| :--- | :---: | ---: |\n| one | two | three |\n\n> [!TIP]\n> Helpful text')
  assert.deepEqual(result.elements.filter(element => element.tag === 'th').map(element => element.attributes.align), ['left', 'center', 'right'])
  assert.deepEqual(result.elements.filter(element => element.tag === 'td').map(element => element.attributes.align), ['left', 'center', 'right'])
  const callout = result.elements.find(element => element.tag === 'blockquote')
  assert.equal(callout?.attributes.class, 'callout tip')
  assert.ok(result.elements.some(element => element.attributes.class === 'callout-label' && element.text === 'TIP'))
  assert.match(result.text, /Helpful text/)
})

test('renderMarkdown preserves safe link destinations and external-opening attributes', async () => {
  const result = await inspect('[external](https://example.invalid/note) [relative](notes/next.md) [hash](#section)')
  const anchors = result.elements.filter(element => element.tag === 'a')
  assert.deepEqual(anchors.map(element => element.attributes.href), ['https://example.invalid/note', 'notes/next.md', '#section'])
  for (const anchor of anchors) {
    assert.equal(anchor.attributes.target, '_blank')
    assert.deepEqual(anchor.attributes.rel.split(/\s+/).sort(), ['noopener', 'noreferrer'])
  }
})

test('renderMarkdown preserves local and data image sources while stripping blob sources', async () => {
  const data = 'data:image/png;base64,iVBORw0KGgo='
  const result = await inspect(`![local](/synthetic-local.png) ![data](${data}) ![blob](blob:https://example.invalid/synthetic)`)
  const images = result.elements.filter(element => element.tag === 'img')
  assert.equal(images.length, 3)
  assert.deepEqual(images.map(element => element.attributes.alt), ['local', 'data', 'blob'])
  assert.deepEqual(images.map(element => element.attributes.src), ['/synthetic-local.png', data, undefined])
})

// Deleting the checkbox renderer must lose the distinct inert task state.
test('renderMarkdown preserves checked and unchecked tasks as inert text', async () => {
  const result = await inspect('- [x] finished\n- [ ] pending')
  assert.deepEqual(result.elements.filter(element => element.tag === 'li').map(element => element.text.trim()), ['[x] finished', '[ ] pending'])
  assert.equal(result.elements.some(element => element.tag === 'input'), false)
})

test('printPaper prints sanitized semantics and restores the document after printing', async () => {
  const result = await page.evaluate(() => {
    const oldTitle = document.title, originalPrint = window.print
    let calls = 0
    window.print = () => { calls++ }
    try {
      const html = window.markdownFixture.renderMarkdown('# Printed\n\n**important**\n\n- [x] done\n- [ ] later')
      window.markdownFixture.printPaper(html, 'Synthetic print')
      const root = document.querySelector('#print-root')
      const before = {
        title: document.title, calls, article: !!root?.querySelector('article.paper'),
        heading: root?.querySelector('h1')?.textContent,
        strong: root?.querySelector('strong')?.textContent,
        tasks: [...(root?.querySelectorAll('li') ?? [])].map(element => element.textContent.trim()),
        prohibited: root?.querySelectorAll('style,form,input,button').length,
      }
      window.dispatchEvent(new Event('afterprint'))
      return { before, removed: !document.querySelector('#print-root'), restored: document.title === oldTitle }
    } finally { window.print = originalPrint }
  })
  assert.deepEqual(result.before, { title: 'Synthetic print', calls: 1, article: true, heading: 'Printed', strong: 'important', tasks: ['[x] done', '[ ] later'], prohibited: 0 })
  assert.equal(result.removed, true)
  assert.equal(result.restored, true)
})
