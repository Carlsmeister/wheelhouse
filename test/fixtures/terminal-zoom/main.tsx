import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { ConsoleNode } from '../../../src/components/ConsoleNode'
import { useStore } from '../../../src/store'
import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import '../../../src/styles.css'

// Test-only observation of the public terminal; no private renderer metrics or event overrides.
const terminals: Terminal[] = []
const originalOpen = Terminal.prototype.open
Terminal.prototype.open = function (...args) {
  terminals.push(this)
  return originalOpen.apply(this, args)
}
const frames: { t: string; d?: string }[] = []
const sockets: FakeSocket[] = []
class FakeSocket {
  static OPEN = 1
  readyState = 1
  onopen?: (event: object) => void
  onmessage?: (event: { data: string }) => void
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.({})) }
  send(value: string) { frames.push(JSON.parse(value)) }
  close() { this.readyState = 3 }
}
window.WebSocket = FakeSocket as unknown as typeof WebSocket
window.fetch = async () => { throw new Error('External transport disabled in synthetic fixture') }

const nodes = [{ id: 'terminal', type: 'console', position: { x: 40, y: 40 }, style: { width: 640, height: 420 }, data: { agent: 'shell', name: 'Synthetic terminal', dot: '#fff', cwd: '/synthetic', epoch: 0 } }]
useStore.setState({ loaded: false, active: '/synthetic', projects: [{ path: '/synthetic', name: 'Synthetic', activeWs: 'w', workspaces: [{ id: 'w', name: 'Synthetic', nodes, edges: [] }], memories: [] }], live: { terminal: { id: 'terminal', agent: 'shell', cwd: '/synthetic', status: 'idle', statusAt: 0, paused: false } } })

function App() {
  const ns = useStore(s => s.projects[0].workspaces[0].nodes)
  return <><div style={{ width: 2400, height: 1800 }}><ReactFlow nodes={ns} edges={[]} nodeTypes={{ console: ConsoleNode }} defaultViewport={{ x: 20, y: 20, zoom: 1 }} minZoom={.08} maxZoom={2.5} zoomOnDoubleClick={false} onInit={flow => useStore.setState({ flow })} /></div><input id="other-input" aria-label="Other editable field" style={{ position: 'fixed', bottom: 10, left: 10 }} /></>
}
createRoot(document.getElementById('root')!).render(<ReactFlowProvider><App /></ReactFlowProvider>)

const settled = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const terminal = () => terminals[0]
const write = (data: string) => new Promise<void>(resolve => terminal().write(data, resolve))
const text = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const fixture = {
  get terminal() { return terminal() },
  async ready() {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished))
    await settled()
    return Boolean(terminal()?.element && sockets.length)
  },
  async setViewport(view: { x: number; y: number; zoom: number }) { await useStore.getState().flow!.setViewport(view); await settled() },
  write,
  inputFrames: () => frames.filter(f => f.t === 'i').map(f => f.d!),
  clearInput: () => { frames.length = 0 },
  socketCount: () => sockets.length,
  async reset(lines = 12) {
    terminal().reset()
    await write(Array.from({ length: lines }, () => text).join('\r\n'))
    terminal().scrollToTop()
    terminal().clearSelection()
    frames.length = 0
    await settled()
  },
  async resize(width: number, height: number) {
    useStore.getState().resizeNode('terminal', width, height)
    await settled()
  },
  async fontSize(size: number) { useStore.setState(s => ({ settings: { ...s.settings, fontSize: size } })); await settled() },
}
Object.assign(window, { terminalZoomFixture: fixture })
