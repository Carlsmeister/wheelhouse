import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { markSvg } from '../src/marks.ts'

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
