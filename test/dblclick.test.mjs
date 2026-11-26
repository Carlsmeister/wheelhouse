import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusesOnDoubleClick } from '../src/dblclick.ts'

// A fake target inside elements matching these selectors: closest() matches any comma-separated part.
const inside = (...ancestors) => ({ closest: (sel) => (sel.split(',').some((s) => ancestors.includes(s.trim())) ? {} : null) })

test('a double-click on a card focuses it at any zoom', () => {
  for (const zoom of [0.4, 1, 1.5]) assert.equal(focusesOnDoubleClick(inside(), zoom), true)
})
test('a double-click in a field, a button or editable text never focuses', () => {
  for (const el of ['input', 'textarea', 'button', 'select', '[contenteditable]:not([contenteditable="false"])'])
    for (const zoom of [0.4, 1, 1.5]) assert.equal(focusesOnDoubleClick(inside(el), zoom), false)
})
test('a terminal at 100 %, as the zoom label rounds it, keeps its double-click', () => {
  for (const zoom of [1, 0.996, 1.004]) assert.equal(focusesOnDoubleClick(inside('.xterm'), zoom), false)
})
test('a terminal at any other zoom focuses its console', () => {
  for (const zoom of [0.4, 0.994, 1.5]) assert.equal(focusesOnDoubleClick(inside('.xterm'), zoom), true)
})
