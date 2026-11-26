import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { read, tokens } from './css.mjs'

const css = read('src/marin.css')
const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8')

test('window backgroundColor is marin.css --bg: dark branch from :root, light from the light theme', () => {
  const m = main.match(/backgroundColor:\s*nativeTheme\.shouldUseDarkColors\s*\?\s*'(#[0-9a-fA-F]{6})'\s*:\s*'(#[0-9a-fA-F]{6})'/)
  assert.ok(m, 'backgroundColor ternary in desktop/main.cjs')
  const bg = (selector) => tokens(css, selector).get('--bg')?.toLowerCase()
  assert.deepEqual([m[1].toLowerCase(), m[2].toLowerCase()], [bg(':root'), bg(":root[data-theme='light']")])
})
