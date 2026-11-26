import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROUP_COLORS, groupColor } from '../src/palette.ts'
import { read, tokens } from './css.mjs'

const LIGHT = ['#e8483d', '#d98a00', '#0fa596', '#2369e8', '#7a47e6', '#e2428a', '#2fa84a', '#ea6f1e']
const DARK = ['#ff7a6b', '#ffc04d', '#3dd6c6', '#5b9bff', '#a57cff', '#ff77b4', '#6fdc7f', '#ff9d5c']

test('new groups draw from the eight Regnbåge colours', () => {
  assert.deepEqual(GROUP_COLORS, LIGHT)
  const store = read('src/store.ts')
  assert.ok(store.includes("import { GROUP_COLORS } from './palette'"))
  assert.ok(!/GROUP_COLORS\s*=\s*\[/.test(store))
})
test("a Regnbåge colour shows as the theme's own", () => {
  LIGHT.forEach((c, i) => assert.equal(groupColor(c), `var(--group-${i})`))
  const css = read('src/marin.css')
  LIGHT.forEach((c, i) => assert.equal(tokens(css, ":root[data-theme='light']").get(`--group-${i}`), c))
  DARK.forEach((c, i) => assert.equal(tokens(css, ':root').get(`--group-${i}`), c))
})
test('a colour saved before Marin shows as saved', () => {
  for (const old of ['#e8643c', '#3ecf8e', '#5b8cff', '#a477ff', '#f5b83d']) assert.equal(groupColor(old), old)
})
test('every place that shows a group colour passes it through the palette', () => {
  const sites = {
    'src/components/Nodes.tsx': ["['--g' as string]: groupColor(data.color)", 'style={{ color: groupColor(data.color) }}'],
    'src/components/Orchestrator.tsx': ['background: groupColor(t.group.data.color)'],
    'src/components/MissionMap.tsx': ['color: groupColor(g.data.color)'],
    'src/components/ContextMenu.tsx': ['style={{ color: groupColor(g.data.color) }}', 'background: groupColor(c)', 'background: groupColor((node.data as GroupData).color)'],
  }
  for (const [file, uses] of Object.entries(sites)) for (const use of uses) assert.ok(read(file).includes(use), `${file}: ${use}`)
})
