import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cascade, isGlow, read, rules } from './css.mjs'

// The orb is the command bar's and the orchestrator card's; the small orbs in menus and Mission Map rows do not glow.
const ALLOWED = ['.commandbar .orb', '.console.working', '.orch .orb', '.react-flow__node.selected .console.working', '.tool-btn.active']

test('the glow detector tells a glow from rings, insets and dark shadows', () => {
  assert.ok(isGlow('0 0 6px var(--done)'))
  assert.ok(isGlow('drop-shadow(0 0 4px rgba(255, 140, 90, 0.9))'))
  assert.ok(isGlow('var(--glow)'))
  assert.ok(!isGlow('0 0 0 1px var(--accent), 0 12px 34px rgb(0 0 0 / 0.34)'))
  assert.ok(!isGlow('inset 0 0 0 1.5px var(--accent)'))
  assert.ok(!isGlow('var(--rim), var(--shadow)'))
  assert.ok(!isGlow('var(--ring), var(--shadow)'))
  assert.ok(!isGlow('0 13px 35px rgb(16 32 64 / 0.13)'))
})
test('glow is on the working card, the orb and the selected tool, and nothing else', () => {
  const all = [...rules(read('src/styles.css')), ...rules(read('src/marin.css'))]
  const glowing = new Set()
  for (const prop of ['box-shadow', 'filter']) for (const [s, v] of cascade(all, prop)) if (isGlow(v)) glowing.add(s)
  assert.deepEqual([...glowing].sort(), ALLOWED)
})
test('the send button carries the send class', () => {
  assert.ok(read('src/components/BottomBar.tsx').includes('className="round-btn send" title="Send to your agents"'))
})
test('the send button takes the gradient only once the field holds text', () => {
  // Every <input> in the command bar has a placeholder, so :placeholder-shown means the field is empty.
  const bg = cascade(rules(read('src/marin.css')), 'background')
  assert.equal(bg.get('.commandbar .send'), undefined)
  assert.match(bg.get('.commandbar:has(input:not(:placeholder-shown)) .send'), /^linear-gradient\(/)
})
test('the glow detector judges a hex colour by how grey it is', () => {
  assert.ok(!isGlow('0 8px 24px #333333'))
  assert.ok(isGlow('0 0 8px #ff8800'))
})
