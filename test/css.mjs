// A rule reader for these tests, not a CSS parser: enough of the grammar to read src/styles.css and src/marin.css.
// shortcut: read() would strip a /* inside a string, a nested @media keeps only the innermost prelude, and a prefers-reduced-motion: no-preference block counts as reduced motion, upgrade when styles.css or marin.css first contains one.
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const collapse = (s) => s.replace(/\s+/g, ' ').trim()

// Walks `text` and calls `at(i, ch, depth)` for every character outside strings; depth counts (), [] and {}.
function walk(text, at) {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { at(i, ch, depth); depth++; continue }
    if (ch === ')' || ch === ']' || ch === '}') depth--
    at(i, ch, depth)
  }
}

// Splits on `sep` where it is not inside a string or a bracket.
function split(text, sep) {
  const parts = []
  let from = 0
  walk(text, (i, ch, depth) => { if (ch === sep && depth === 0) { parts.push(text.slice(from, i)); from = i + 1 } })
  parts.push(text.slice(from))
  return parts
}

// The top-level `prelude { body }` blocks of `text`; statements such as `@import …;` are passed over.
function blocks(text) {
  const out = []
  let from = 0
  let open = -1
  walk(text, (i, ch, depth) => {
    if (depth !== 0) return
    if (ch === ';' && open < 0) from = i + 1
    else if (ch === '{') open = i
    else if (ch === '}') { out.push({ prelude: collapse(text.slice(from, open)), body: text.slice(open + 1, i) }); from = i + 1; open = -1 }
  })
  return out
}

function decls(body) {
  const map = new Map()
  for (const d of split(body, ';')) {
    const colon = d.indexOf(':')
    if (colon > 0) map.set(d.slice(0, colon).trim(), d.slice(colon + 1).trim())
  }
  return map
}

export const read = (path) => readFileSync(new URL(path, root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

export function tokens(css, selector) {
  const rule = blocks(css).find((b) => b.prelude === selector)
  return new Map([...(rule ? decls(rule.body) : [])].filter(([k]) => k.startsWith('--')))
}

const GROUPING = /^@(media|supports|layer|container)\b/i

export function rules(css, media = '') {
  const out = []
  for (const { prelude, body } of blocks(css)) {
    if (prelude.startsWith('@')) {
      // @keyframes, @font-face and any other at-rule hold no style rules.
      if (GROUPING.test(prelude)) out.push(...rules(body, /^@media\b/i.test(prelude) ? prelude : media))
      continue
    }
    out.push({ selectors: split(prelude, ',').map(collapse), decls: decls(body), media })
  }
  return out
}

export function cascade(rules, prop, { reducedMotion = false } = {}) {
  const out = new Map()
  for (const r of rules) {
    if (r.media.includes('print')) continue
    if (r.media.includes('prefers-reduced-motion') && !reducedMotion) continue
    if (!r.decls.has(prop)) continue
    for (const s of r.selectors) out.set(s, r.decls.get(prop))
  }
  return out
}

const LENGTH = /^-?(\d*\.)?\d+(px|em|rem)?$/
const NEUTRAL_LAYERS = ['var(--shadow)', 'var(--shadow-sm)', 'var(--rim)']

// Grey enough to read as a shadow rather than a colour: RGB channels within 48 of each other.
function neutral(colour) {
  if (colour.startsWith('rgb(var(--ink)')) return true
  let ch
  const hex = colour.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    const h = hex[1].length < 6 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  } else if (/^rgba?\(/.test(colour) && !colour.includes('var(')) ch = colour.match(/[\d.]+/g).slice(0, 3).map(Number)
  else return false
  return Math.max(...ch) - Math.min(...ch) <= 48
}

// True when a box-shadow value, or a filter value's drop-shadow(), has an outer, blurred, coloured layer.
// shortcut: lengths are px, em or rem, and a named colour (black, grey) or hsl() counts as a colour, upgrade when a shadow first uses one.
export function isGlow(value) {
  if (!value) return false
  const v = collapse(value.replace(/\s*!important$/, ''))
  const layers = v.includes('drop-shadow(')
    ? split(v, ' ').filter((f) => f.startsWith('drop-shadow(')).map((f) => f.slice(12, -1))
    : split(v, ',')
  return layers.map(collapse).some((layer) => {
    if (/^var\([^()]*\)$/.test(layer)) return layer === 'var(--glow)' || layer === 'var(--glow-soft)'
    const parts = split(layer, ' ')
    if (parts.includes('inset')) return false
    const lengths = parts.filter((p) => LENGTH.test(p))
    const colour = parts.filter((p) => !LENGTH.test(p)).join(' ')
    return lengths.length >= 3 && parseFloat(lengths[2]) !== 0 && !neutral(colour)
  })
}
