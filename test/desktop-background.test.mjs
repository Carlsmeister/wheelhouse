import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/marin.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8')

test('window backgroundColor matches marin.css --bg (dark, light)', () => {
  const bgs = [...css.matchAll(/--bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase())
  assert.equal(bgs.length >= 2, true, 'two --bg values in marin.css')
  const m = main.match(/backgroundColor:\s*nativeTheme\.shouldUseDarkColors\s*\?\s*'(#[0-9a-fA-F]{6})'\s*:\s*'(#[0-9a-fA-F]{6})'/)
  assert.ok(m, 'backgroundColor ternary in desktop/main.cjs')
  const [dark, light] = [m[1].toLowerCase(), m[2].toLowerCase()]
  assert.deepEqual([dark, light].sort(), bgs.slice(0, 2).sort())
  assert.equal(dark, '#0b111b')
  assert.equal(light, '#f2f5f9')
})
