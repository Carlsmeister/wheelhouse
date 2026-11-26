import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digits, zoomTarget } from '../src/zoom.ts'

test('a typed percentage is the zoom to apply, whole and clamped to 8–250', () => {
  assert.equal(zoomTarget('150', 100), 150)
  assert.equal(zoomTarget('200', 100), 200)
  assert.equal(zoomTarget('5', 100), 8)
  assert.equal(zoomTarget('0', 100), 8)
  assert.equal(zoomTarget('400', 100), 250)
  assert.equal(zoomTarget('0150', 100), 150)
  assert.equal(zoomTarget('99999999999999999999', 100), 250)
})

test('letters and signs never reach the field', () => {
  assert.equal(digits('1a5b0'), '150')
  assert.equal(digits('abc120%'), '120')
  assert.equal(digits('1e2'), '12')
  assert.equal(digits('-5.5'), '55')
  assert.equal(zoomTarget('1a5b0', 100), 150)
})

test('an empty or unchanged field applies nothing', () => {
  assert.equal(zoomTarget('', 100), null)
  assert.equal(zoomTarget('abc', 100), null)
  assert.equal(zoomTarget('100', 100), null)
  assert.equal(zoomTarget('0100', 100), null)
  assert.equal(zoomTarget('400', 250), null)
  assert.equal(zoomTarget('5', 8), null)
})
