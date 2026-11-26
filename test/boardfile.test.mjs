// Board file schema (src/boardfile.ts runs as-is under Node's TypeScript type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_VERSION, migrate } from '../src/boardfile.ts'

const INITIAL = {
  projects: [],
  active: null,
  settings: { yolo: false, fontSize: 13, defaultAgent: 'claude' },
  presets: [{ id: 'duo', name: 'Pair', agents: ['claude', 'claude'] }],
}

// A vibeboard 1.0.0 board as upstream snapshot() at 2d22284 saved it (values invented).
const BOARD = {
  projects: [
    {
      path: '/Users/example/code/garden',
      name: 'garden',
      workspaces: [
        {
          id: 'ws-1',
          name: 'Main',
          nodes: [
            {
              id: 'c-1',
              type: 'console',
              position: { x: 40, y: 60 },
              style: { width: 640, height: 420 },
              measured: { width: 640, height: 420 },
              data: { agent: 'claude', name: 'Maya', dot: '#5b8cff', cwd: '/Users/example/code/garden', epoch: 2 },
            },
            {
              id: 'n-1',
              type: 'note',
              position: { x: 720, y: 60 },
              style: { width: 220, height: 160 },
              measured: { width: 220, height: 160 },
              data: { text: 'Water the tomatoes', color: '#f5b83d' },
            },
          ],
          edges: [],
          viewport: { x: -12, y: 8, zoom: 0.9 },
        },
      ],
      activeWs: 'ws-1',
      memories: [{ id: 'm-1', title: 'Stack', kind: 'note', text: 'Plain TypeScript, no framework.', enabled: true }],
      openedAt: 1767225600000,
    },
  ],
  active: '/Users/example/code/garden',
  settings: { yolo: true, fontSize: 15, defaultAgent: 'codex' },
  presets: [{ id: 'trio', name: 'Three of us', agents: ['claude', 'codex', 'gemini'], label: 'Trio' }],
}

test('a vibeboard 1.0.0 board without a version loads as it was saved', () => {
  assert.equal(BOARD_VERSION, 1)
  assert.equal('version' in BOARD, false)
  assert.deepEqual(migrate(BOARD, INITIAL), BOARD)
  assert.deepEqual(migrate({ ...BOARD, version: 1 }, INITIAL), BOARD)
})

test('unknown top-level keys never reach the store', () => {
  const saved = { ...BOARD, live: { 'c-1': { status: 'idle' } }, loaded: false, modal: 'settings', marker: 'x' }
  assert.deepEqual(Object.keys(migrate(saved, INITIAL)).sort(), ['active', 'presets', 'projects', 'settings'])
})

test('a missing top-level key loads with its initial value', () => {
  for (const key of ['projects', 'active', 'settings', 'presets']) {
    const { [key]: _, ...rest } = BOARD
    const board = migrate(rest, INITIAL)
    assert.deepEqual(board[key], INITIAL[key], key)
    for (const other of Object.keys(INITIAL).filter((k) => k !== key)) assert.deepEqual(board[other], BOARD[other], `${key} missing: ${other}`)
  }
  assert.deepEqual(migrate({}, INITIAL), INITIAL)
  assert.deepEqual(migrate({}, BOARD), BOARD) // filled from `initial`, never from literals
})

test('a settings field the file lacks gets its default, and the fields it has are kept', () => {
  const profiles = [{ id: 'work', name: 'Work', agent: 'claude' }]
  assert.deepEqual(migrate({ ...BOARD, settings: { yolo: true, profiles } }, INITIAL).settings, { yolo: true, fontSize: 13, defaultAgent: 'claude', profiles })
})

test('keys inside projects, workspaces and nodes pass through unchanged', () => {
  const later = structuredClone(BOARD)
  later.projects[0].later = 'kept'
  later.projects[0].workspaces[0].later = 'kept'
  later.projects[0].workspaces[0].nodes[0].later = 'kept'
  later.projects[0].workspaces[0].nodes[0].data.later = 'kept'
  assert.deepEqual(migrate(later, INITIAL).projects, later.projects)
})

test('a top-level value of the wrong kind loads as the initial value', () => {
  const wrong = { projects: {}, active: 5, settings: ['x'], presets: 'duo' }
  assert.deepEqual(migrate(wrong, INITIAL), INITIAL)
  assert.deepEqual(migrate(wrong, BOARD), BOARD)
  assert.deepEqual(migrate({ ...BOARD, settings: null }, INITIAL).settings, INITIAL.settings)
  assert.equal(migrate({ ...BOARD, active: null }, { ...INITIAL, active: '/Users/example/other' }).active, null) // null is a valid active
})

test('a reply that is not an object loads as the initial board', () => {
  for (const initial of [INITIAL, BOARD])
    for (const saved of [null, [], 'board', 1]) assert.deepEqual(migrate(saved, initial), initial, JSON.stringify(saved))
})
