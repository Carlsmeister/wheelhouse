import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cascade, isGlow, read, rules } from './css.mjs'

const marin = rules(read('src/marin.css'))
const moving = (r) => ['animation', 'animation-name'].some((p) => r.decls.has(p) && r.decls.get(p) !== 'none')
const reduced = (r) => r.media.includes('prefers-reduced-motion: reduce')
const animated = marin.filter((r) => !reduced(r) && moving(r)).flatMap((r) => r.selectors)
const stilled = new Set(marin.filter((r) => reduced(r) && r.decls.get('animation') === 'none').flatMap((r) => r.selectors))

test("the fork animates the working card and turns the orb's colour layer", () => {
  for (const s of ['.console.working', '.commandbar .orb::before', '.orch .orb::before']) assert.ok(animated.includes(s), s)
})
test("the orb's light and rim stay put while its colour turns", () => {
  for (const s of ['.commandbar .orb', '.orch .orb', '.commandbar .orb::after', '.orch .orb::after']) assert.ok(!animated.includes(s), s)
})
test('the working card keeps its entrance beside the breathing, so it does not replay when work stops', () => {
  const value = cascade(marin, 'animation').get('.console.working')
  assert.match(value, /^console-in 0\.26s var\(--spring\) both, marin-breathe /)
})
test('every animation the fork adds stops under reduced motion', () => {
  for (const s of animated) assert.ok(stilled.has(s), s)
})
test("the Working dot's pulse stops under reduced motion too", () => {
  assert.ok(stilled.has('.status-pill.working .dot'))
})
test('a selected working card keeps its accent ring, breathing or still', () => {
  const selected = '.react-flow__node.selected .console.working'
  assert.equal(cascade(marin, '--ring').get(selected), '0 0 0 1px var(--accent)')
  assert.match(cascade(marin, 'box-shadow').get(selected), /^var\(--ring\), /)
  // rules() skips @keyframes, so the two stops are read from the text.
  const frames = read('src/marin.css').match(/@keyframes marin-breathe\s*\{[\s\S]*?\}\s*\}/)[0]
  const shadows = frames.match(/box-shadow:[^;}]+/g)
  assert.equal(shadows.length, 2)
  for (const s of shadows) assert.match(s, /^box-shadow:\s*var\(--ring\), /)
})
test('a working card, selected or not, keeps a still glow when motion is reduced', () => {
  const still = cascade([...rules(read('src/styles.css')), ...marin], 'box-shadow', { reducedMotion: true })
  for (const s of ['.console.working', '.react-flow__node.selected .console.working']) assert.ok(isGlow(still.get(s)), s)
})
