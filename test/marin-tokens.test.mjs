import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cascade, read, rules, tokens } from './css.mjs'

const DARK = { '--bg': '#0b111b', '--panel': '#121a27', '--panel-2': '#1a2434', '--line': '#243248', '--text': '#e6edf7', '--muted': '#8d9cb0', '--accent': '#5b9bff', '--accent-rgb': '91 155 255', '--accent-2': '#7fe0ff', '--grid': '#1c2738', '--term-bg': '#0e1520', '--working': 'var(--accent)', '--needs': '#f5b83d', '--done': '#3ecf8e' }
// Light needs and done are darker than the Decision's #a86a00 and #0f8a58: those fall short of 4.5:1 on --panel-2 (Task 2).
const LIGHT = { '--bg': '#f2f5f9', '--panel': '#ffffff', '--panel-2': '#eaf0f6', '--line': '#d8e0ea', '--text': '#14202e', '--muted': '#5a6879', '--accent': '#2369e8', '--accent-rgb': '35 105 232', '--accent-2': '#1fb6e8', '--grid': '#ced8e4', '--term-bg': '#ffffff', '--working': 'var(--accent)', '--needs': '#996000', '--done': '#0e7c4f' }

test('the Marin stylesheet is imported straight after styles.css', () => {
  const lines = read('src/main.tsx').split('\n').map((l) => l.trim())
  assert.equal(lines.indexOf("import './marin.css'"), lines.indexOf("import './styles.css'") + 1)
})
test('the dark Marin tokens sit on :root', () => {
  const t = tokens(read('src/marin.css'), ':root')
  for (const [k, v] of Object.entries(DARK)) assert.equal(t.get(k)?.toLowerCase(), v, k)
})
test('the light Marin tokens sit on the light theme', () => {
  const t = tokens(read('src/marin.css'), ":root[data-theme='light']")
  for (const [k, v] of Object.entries(LIGHT)) assert.equal(t.get(k)?.toLowerCase(), v, k)
})
test("the terminal draws on Marin's terminal background", () => {
  const src = read('src/components/ConsoleNode.tsx')
  assert.ok(src.includes("background: '#0e1520'"))
  assert.ok(src.includes("background: '#ffffff'"))
})
test('the rule reader keeps strings, url() and nested at-rules out of the way', () => {
  const css = `
    @import url("a;b{c}.css");
    .a, :is(.b, .c) { color: red; background: url(data:x;y{z}) }
    .q::before { content: '}{;'; color: blue }
    @keyframes k { from { color: pink } to { color: pink } }
    @font-face { font-family: x; src: url(x.woff2) }
    @media (min-width: 1px) { @supports (display: grid) { .a { color: green } } }
    @media print { .a { color: black } }
    @media (prefers-reduced-motion: reduce) { .a { color: gray } }`
  const r = rules(css)
  assert.deepEqual(r.map((x) => x.selectors), [['.a', ':is(.b, .c)'], ['.q::before'], ['.a'], ['.a'], ['.a']])
  assert.equal(r[0].decls.get('background'), 'url(data:x;y{z})')
  assert.equal(r[1].decls.get('content'), "'}{;'")
  assert.equal(r[2].media, '@media (min-width: 1px)')
  assert.equal(cascade(r, 'color').get('.a'), 'green')
  assert.equal(cascade(r, 'color', { reducedMotion: true }).get('.a'), 'gray')
  assert.equal(cascade(r, 'color').get(':is(.b, .c)'), 'red')
})
