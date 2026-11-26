import React from 'react'
import { createRoot } from 'react-dom/client'
import '@wheelhouse/styles.css'
import '@wheelhouse/marin.css'
import '@wheelhouse/fork.css'

const trace: any[] = []
const record = (kind: string, data: any = {}) => trace.push({ t: performance.now(), kind, ...data })
let delayedKill = false
let pendingKills: (() => void)[] = []
window.fetch = async (input, init) => {
  const url = String(input)
  record('mock-fetch', { url, method: init?.method || 'GET' })
  if (url === '/api/pty/synthetic-agent' && init?.method === 'DELETE') {
    if (delayedKill) await new Promise<void>((r) => pendingKills.push(r))
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  }
  if (url === '/api/usage' && (!init?.method || init.method === 'GET')) return new Response(JSON.stringify({ claude: { days: {} }, codex: { days: {} }, scannedAt: 0 }))
  throw Error('Unexpected transport blocked: ' + url)
}
window.WebSocket = class { constructor() { record('blocked-websocket'); throw Error('WebSocket forbidden') } } as any
const { useStore } = await import('@wheelhouse/store')
const { TopBar } = await import('@wheelhouse/components/TopBar')
const { ConfirmSheet } = await import('@wheelhouse/components/Panels')
const base = useStore.getState()
let root: ReturnType<typeof createRoot> | null = null
let request = 0
const outcomes: any[] = []
const state = () => {
  const s = useStore.getState(), p = s.projects[0]
  return { ids: p?.workspaces.map((w) => w.id), names: p?.workspaces.map((w) => w.name), active: p?.activeWs, confirming: s.confirming?.title || null, toast: s.toast, inputs: [...document.querySelectorAll('.tab input')].map((e: any) => e.value) }
}
useStore.subscribe(() => record('state', state()))
const originalClose = base.closeWorkspace
const closeWorkspace = (id: string) => {
  const n = ++request; record('close-call', { id, request: n })
  const promise = originalClose(id)
  promise.then(() => outcomes.push({ id, request: n, status: 'fulfilled' }), (e) => outcomes.push({ id, request: n, status: 'rejected', error: String(e) }))
  return promise.then(() => record('close-resolve', { id, request: n }), (e) => { record('close-reject', { id, request: n, error: String(e) }); throw e })
}
const describe = (e: Element | null): any => e ? { tag: e.tagName, cls: e.getAttribute('class'), text: e.textContent?.slice(0, 60), tab: e.closest('.tab')?.textContent } : null
for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) document.addEventListener(type, (e: any) => record('event', { type, detail: e.detail, x: e.clientX, y: e.clientY, target: describe(e.target) }), true)
window.addEventListener('unhandledrejection', (e) => record('unhandledrejection', { error: String(e.reason) }))
function reset({ count = 3, active = 'a', agents = false, delay = false, sheet = true } = {}) {
  root?.unmount()
  pendingKills.splice(0).forEach((r) => r())
  delayedKill = delay
  const nodes = agents ? [{ id: 'synthetic-agent', type: 'console', position: { x: 0, y: 0 }, data: { agent: 'codex', name: 'Synthetic', cwd: '/synthetic', epoch: 0 } }] : []
  const workspaces = ['a', 'b', 'c'].slice(0, count).map((id) => ({ id, name: { a: 'Alpha', b: 'Beta', c: 'Gamma' }[id], nodes: id === 'b' ? nodes : [], edges: [] }))
  useStore.setState({ ...base, loaded: false, installed: [], projects: [{ path: '/synthetic', name: 'Synthetic', workspaces, activeWs: active, memories: [], openedAt: 0 }], active: '/synthetic', live: agents ? { 'synthetic-agent': { id: 'synthetic-agent', agent: 'codex', status: 'working', cwd: '/synthetic', paused: false } } : {}, closeWorkspace,
    switchWorkspace: (id) => { record('switch-call', { id }); base.switchWorkspace(id) },
    renameWorkspace: (id, name) => { record('rename-call', { id, name }); base.renameWorkspace(id, name) },
    notify: (msg) => { record('notify-call', { msg }); base.notify(msg) },
  })
  trace.length = 0
  outcomes.length = 0
  root = createRoot(document.getElementById('root')!)
  root.render(<><TopBar />{sheet && <ConfirmSheet />}</>)
}
;(window as any).probe = { reset, state, trace, outcomes, release: () => { record('release-kills', { count: pendingKills.length }); pendingKills.splice(0).forEach((r) => r()) }, pending: () => pendingKills.length, answer: (ok: boolean) => useStore.getState().confirming?.answer(ok), close: closeWorkspace,
  geometry: () => [...document.querySelectorAll('.tab')].map((tab) => {
    const x = tab.querySelector('.x')!, svg = x.querySelector('svg')!
    const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { text: tab.textContent, active: tab.classList.contains('active'), hover: tab.matches(':hover'), tab: rect(tab), x: rect(x), svg: rect(svg), display: getComputedStyle(x).display }
  }) }
reset()
