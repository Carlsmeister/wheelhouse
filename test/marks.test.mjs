import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { markSvg } from '../src/marks.ts'
import { cascade, read, rules } from './css.mjs'

const dir = new URL('../src/assets/agents/', import.meta.url)
const marks = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')])
const colours = (s) => new Set((s.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((c) => c.toLowerCase()))

test('every mark keeps its own colours and gains only black or white', () => {
  for (const theme of ['light', 'dark']) {
    const ink = theme === 'dark' ? '#ffffff' : '#000000'
    for (const [f, svg] of marks) {
      const out = markSvg(svg, theme)
      assert.ok(!out.includes('currentColor'), f)
      for (const c of colours(svg)) assert.ok(colours(out).has(c), `${f} lost ${c}`)
      for (const c of colours(out)) assert.ok(colours(svg).has(c) || c === ink, `${f} gained ${c}`)
    }
  }
})
test("Claude's mark stays its own orange", () => {
  const claude = marks.find(([f]) => f === 'claude.svg')[1]
  assert.ok(markSvg(claude, 'dark').includes('#D97757'))
})
test('icons.tsx no longer recolours a mark', () => {
  const src = readFileSync(new URL('../src/components/icons.tsx', import.meta.url), 'utf8')
  assert.ok(!src.includes("replace('#D97757'"))
  assert.ok(!/replaceAll\('currentColor'/.test(src))
})
test('icons.tsx draws each mark for the theme on screen', () => {
  const src = readFileSync(new URL('../src/components/icons.tsx', import.meta.url), 'utf8')
  assert.match(src, /const theme = useTheme\(\)/)
  assert.ok(src.includes('markSvg(svg, theme)'))
})
test("on an accent fill a mark takes the button's own black or white", () => {
  const filter = cascade([...rules(read('src/styles.css')), ...rules(read('src/marin.css'))], 'filter')
  for (const fill of ['.tool-btn.active', '.btn.primary']) {
    // Dark --on-accent is #0b111b, light is #ffffff; the light selector adds :root[…], so it outranks the dark one.
    assert.equal(filter.get(`${fill} img:not([data-agent='codex'])`), 'brightness(0)', fill)
    assert.equal(filter.get(`:root[data-theme='light'] ${fill} img:not([data-agent='codex'])`), 'brightness(0) invert(1)', fill)
  }
})
test('the Codex mark keeps its own tile on an accent fill, and every other mark keeps the filter', () => {
  // codex.svg's first path fills the whole view box in white, so the filter would turn it into a solid square.
  const src = readFileSync(new URL('../src/components/icons.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('data-agent={id}'), 'AgentGlyph tags its <img> with the agent id')
  const filter = cascade([...rules(read('src/styles.css')), ...rules(read('src/marin.css'))], 'filter')
  const onFill = [...filter.keys()].filter((s) => /\.(tool-btn\.active|btn\.primary)\b.*\bimg\b/.test(s))
  assert.equal(onFill.length, 4)
  for (const s of onFill) assert.ok(s.endsWith("img:not([data-agent='codex'])"), `${s} reaches the Codex mark`)
})
test("the document card's author mark draws in black ink on the paper in both themes", () => {
  // .doc-card-body is fixed paper (#fdfcfa) in both themes, so the dark form's white ink would vanish on it.
  const docs = readFileSync(new URL('../src/components/DocumentsStudio.tsx', import.meta.url), 'utf8')
  const by = docs.match(/className="by">\s*(<AgentGlyph\b[^>]*>)/)
  assert.ok(by, 'the author line draws an AgentGlyph')
  assert.match(by[1], /\btheme="light"/)
  const icons = readFileSync(new URL('../src/components/icons.tsx', import.meta.url), 'utf8')
  assert.match(icons, /function AgentGlyph\(\{[^}]*\btheme\b/, 'AgentGlyph takes a theme')
  for (const [f, svg] of marks.filter(([, s]) => s.includes('currentColor'))) {
    assert.ok(markSvg(svg, 'light').includes('#000000'), f)
  }
})
