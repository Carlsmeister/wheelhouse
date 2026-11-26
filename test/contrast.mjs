// WCAG 2.2 contrast of Marin's text and status colours on their backgrounds, light and dark (issue #9).
// Run directly, it prints the table the pull request carries.
import { fileURLToPath } from 'node:url'
import { read, tokens } from './css.mjs'

function rgb(hex) {
  // Anything else would parse to NaN, and NaN < min is false: a pair would pass unmeasured.
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`cannot measure ${hex}: not #rrggbb`)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}
const hex = (channels) => '#' + channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')

// Relative luminance, WCAG 2.2.
function luminance(colour) {
  const [r, g, b] = rgb(colour).map((c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function mix(fg, bg, percent) {
  const [f, b] = [rgb(fg), rgb(bg)]
  return hex(f.map((c, i) => (c * percent + b[i] * (100 - percent)) / 100))
}

const LIGHT = ":root[data-theme='light']"

const marin = read('src/marin.css')
const base = read('src/styles.css')

// The blocks a theme's token is looked up in, first match wins.
function scope(theme) {
  const dark = [tokens(marin, ':root'), tokens(base, ':root')]
  return theme === 'dark' ? dark : [tokens(marin, LIGHT), tokens(base, LIGHT), ...dark]
}

function resolver(theme) {
  const blocks = scope(theme)
  const value = (name) => {
    const v = blocks.find((b) => b.has(name))?.get(name)
    if (v === undefined) throw new Error(`${theme} ${name} is not set`)
    const ref = v.match(/^var\((--[\w-]+)\)$/)
    return ref ? value(ref[1]) : v
  }
  return value
}

const TEXT = ['--text', '--text-2', '--muted', '--needs', '--done', '--danger', '--warn', '--ok', '--info', '--purple']
const SURFACES = ['--bg', '--panel', '--panel-2', '--term-bg']

export function pairs() {
  const out = []
  for (const theme of ['dark', 'light']) {
    const v = resolver(theme)
    const add = (fg, bg, fgHex, bgHex, min) => out.push({ theme, fg, bg, ratio: Math.round(contrast(fgHex, bgHex) * 100) / 100, min })
    for (const bg of SURFACES) {
      for (const fg of TEXT) add(fg, bg, v(fg), v(bg), 4.5)
      add('--faint', bg, v('--faint'), v(bg), 3)
      // The Decision fixes the accent; on --panel-2 it is reported, not held to 4.5.
      add('--accent', bg, v('--accent'), v(bg), bg === '--panel-2' ? 0 : 4.5)
    }
    const tint = parseFloat(v('--pill-tint'))
    for (const fg of ['--working', '--needs', '--done']) add(fg, 'pill over --panel', v(fg), mix(v(fg), v('--panel'), tint), 4.5)
    add('--on-accent', '--accent', v('--on-accent'), v('--accent'), 4.5)
    add('--on-accent', 'gradient middle', v('--on-accent'), mix(v('--accent'), v('--accent-2'), 50), 3)
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('| Theme | Colour | Background | Ratio | Minimum |\n|---|---|---|---|---|')
  for (const p of pairs()) console.log(`| ${p.theme} | \`${p.fg}\` | \`${p.bg}\` | ${p.ratio.toFixed(2)} | ${p.min || 'reported'} |`)
}
