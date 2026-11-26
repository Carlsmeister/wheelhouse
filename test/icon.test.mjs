import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const colourRe = /(?:fill|stroke|stop-color)\s*[:=]\s*"?(#[0-9a-f]{3,8})/gi
const colours = (s) => [...s.matchAll(colourRe)].map((m) => m[1].toLowerCase())
const count = (s, re) => (s.match(re) ?? []).length

const assertWheel = (svg) => {
  assert.equal(count(svg, /<rect x="-11" y="-286" width="22" height="224" rx="11"/g), 8, 'spokes')
  assert.equal(count(svg, /<circle[^>]* cy="-338" r="40"/g), 8, 'dots')
  for (const r of [236, 118, 42]) assert.match(svg, new RegExp(`<circle[^>]* r="${r}"`), `circle r ${r}`)
}

// The ic07 chunk of build/icon.icns: a 128 px PNG, decoded to RGBA rows.
const ic07Pixels = () => {
  const icns = readFileSync(new URL('../build/icon.icns', import.meta.url))
  let png
  for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) {
    if (icns.toString('latin1', at, at + 4) === 'ic07') png = icns.subarray(at + 8, at + icns.readUInt32BE(at + 4))
  }
  assert.ok(png, 'ic07 chunk')
  let width, height, idat = []
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    const type = png.toString('latin1', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + png.readUInt32BE(at))
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.deepEqual([data[8], data[9], data[12]], [8, 6, 0], 'bit depth 8, colour type 6, not interlaced')
    }
    if (type === 'IDAT') idat.push(data)
  }
  assert.deepEqual([width, height], [128, 128])
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= 4 ? out[y * stride + x - 4] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const pred = [0, a, b, (a + b) >> 1, paeth][filter]
      out[y * stride + x] = (v + pred) & 0xff
    }
  }
  return (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)]
}

test('the app icon tile is a dark diagonal gradient from #2b4378 to #0b111b', () => {
  const svg = read('build/icon.svg')
  assert.equal(count(svg, /<linearGradient/g), 1)
  const gradient = svg.match(/<linearGradient id="([^"]+)" x1="0" y1="0" x2="1" y2="1">(.*?)<\/linearGradient>/)
  assert.ok(gradient, 'gradient from top left to bottom right')
  const stops = [...gradient[2].matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"/g)].map((m) => [m[1], m[2].toLowerCase()])
  assert.deepEqual(stops, [['0', '#2b4378'], ['1', '#0b111b']])
  assert.ok(svg.includes(`<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#${gradient[1]})"`), 'tile')
})
test('the app icon draws the whole wheel on the tile', () => {
  const svg = read('build/icon.svg')
  assert.match(svg, /<g transform="translate\(512 512\) scale\(\.86\)"/)
  assertWheel(svg)
})
test('the app icon wheel is #e6edf7 in every fill and stroke', () => {
  const svg = read('build/icon.svg')
  const shapes = [...svg.matchAll(colourRe)].filter((m) => !/^stop-color/i.test(m[0])).map((m) => m[1].toLowerCase())
  assert.ok(shapes.length > 0)
  assert.deepEqual(new Set(shapes), new Set(['#e6edf7']))
})
test('the app icon has no filter', () => {
  assert.ok(!read('build/icon.svg').includes('<filter'))
})
for (const [file, colour] of [['docs/logo/light.svg', '#1b2a4a'], ['docs/logo/dark.svg', '#e6edf7']]) {
  test(`${file} is the wheel in ${colour} alone, with no tile`, () => {
    const svg = read(file)
    assert.match(svg, /viewBox="-390 -390 780 780"/)
    assertWheel(svg)
    assert.deepEqual(new Set(colours(svg)), new Set([colour]))
  })
}
test('docs/logo/auto.svg is #1b2a4a in light and #e6edf7 in dark, and nothing else', () => {
  const svg = read('docs/logo/auto.svg')
  assertWheel(svg)
  const at = svg.indexOf('@media (prefers-color-scheme:dark)')
  assert.ok(at > 0, 'dark media query')
  assert.deepEqual(new Set(colours(svg.slice(0, at))), new Set(['#1b2a4a']))
  assert.deepEqual(new Set(colours(svg.slice(at))), new Set(['#e6edf7']))
})
test('build/icon.icns is an icns file holding ic07 and ic10', () => {
  const icns = readFileSync(new URL('../build/icon.icns', import.meta.url))
  assert.equal(icns.toString('latin1', 0, 4), 'icns')
  const types = []
  for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) types.push(icns.toString('latin1', at, at + 4))
  assert.ok(types.includes('ic07'), types.join())
  assert.ok(types.includes('ic10'), types.join())
})
test('the 128 px icon shows the light wheel on the dark tile with transparent corners', () => {
  const pixel = ic07Pixels()
  assert.equal(pixel(2, 2)[3], 0, 'corner is transparent')
  const [r, , b, a] = pixel(64, 16)
  assert.equal(a, 255, 'tile edge is opaque')
  assert.ok(b > r + 40 && r < 80, `tile edge is dark blue, got ${pixel(64, 16)}`)
  assert.ok(pixel(64, 28).every((v) => v > 200), `top dot is light, got ${pixel(64, 28)}`)
})
