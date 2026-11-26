import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cascade, read, rules } from './css.mjs'
import { contrast, mix, pairs } from './contrast.mjs'

const TEXT = ['--text', '--text-2', '--muted', '--faint', '--accent', '--needs', '--done', '--danger', '--warn', '--ok', '--info', '--purple']

test('contrast follows WCAG 2.2', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(Math.round(contrast('#5b9bff', '#ffffff') * 100) / 100, 2.77)
})
test('mix blends in srgb and rounds each channel', () => {
  // 255 * 0.5 = 127.5 rounds to 128 (0x80); 0xff * 0.12 + 0x12 * 0.88 = 46.44 rounds to 46 (0x2e).
  assert.equal(mix('#ffffff', '#000000', 50), '#808080')
  assert.equal(mix('#ffffff', '#121212', 12), '#2e2e2e')
})
test('contrast refuses a colour it cannot measure', () => {
  for (const bad of ['#fff', 'rgb(0 0 0)', 'color-mix(in srgb, red 50%, blue)'])
    assert.throws(() => contrast(bad, '#ffffff'), new RegExp(bad.replace(/[()]/g, '\\$&')))
})
test('every text and status colour is measured on every surface in both themes', () => {
  for (const theme of ['dark', 'light']) for (const fg of TEXT) for (const bg of ['--bg', '--panel', '--panel-2', '--term-bg'])
    assert.ok(pairs().some((p) => p.theme === theme && p.fg === fg && p.bg === bg), `${theme} ${fg} on ${bg}`)
})
test('every measured pair meets its minimum', () => {
  assert.deepEqual(pairs().filter((p) => p.ratio < p.min), [])
})
test('white text on an accent fill takes --on-accent', () => {
  const base = rules(read('src/styles.css'))
  const white = base.filter((r) => r.decls.get('background') === 'var(--accent)' && r.decls.get('color') === '#fff').flatMap((r) => r.selectors)
  assert.ok(white.includes('.tool-btn.active') && white.includes('.btn.primary'))
  const colour = cascade([...base, ...rules(read('src/marin.css'))], 'color')
  for (const s of [...white, '.git-check.on']) assert.equal(colour.get(s), 'var(--on-accent)', s)
})
test('the orchestrator picker hint on the accent takes --on-accent', () => {
  const colour = cascade([...rules(read('src/styles.css')), ...rules(read('src/marin.css'))], 'color')
  assert.equal(colour.get('.orch-pick.on small'), 'color-mix(in srgb, var(--on-accent) 75%, transparent)')
})
test('the status pills take the theme tint the contrast table measures', () => {
  const bg = cascade([...rules(read('src/styles.css')), ...rules(read('src/marin.css'))], 'background')
  for (const s of ['.status-pill.working', '.status-pill.needs', '.status-pill.done', '.pill-state.working'])
    assert.equal(bg.get(s), 'color-mix(in srgb, currentColor var(--pill-tint), var(--panel))', s)
})
test('no coral is left on the document sheet', () => {
  const all = [...rules(read('src/styles.css')), ...rules(read('src/marin.css'))]
  const coral = /#c23c22|#f6e7e3|#f1d3cb|#fbefeb|#4a3d38/i
  for (const prop of ['color', 'background', 'border']) {
    const value = cascade(all, prop)
    for (const s of ['.paper a', '.paper code', '.callout-label', '.doc-card-label', '.paper blockquote.callout'])
      assert.ok(!coral.test(value.get(s) ?? ''), `${s} ${prop}`)
  }
})
