// A rule reader for these tests, not a CSS parser: enough of the grammar to read src/styles.css and src/marin.css.
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
