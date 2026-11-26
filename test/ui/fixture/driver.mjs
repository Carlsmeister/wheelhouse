import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))

// Each invocation owns its fixture process, CLI session and scratch files.
export async function runUI(callback) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('UI tests require Node 24')
  const entry = process.env.PLAYWRIGHT_CLI_JS
  if (!entry) throw Error('Set PLAYWRIGHT_CLI_JS to the installed playwright-cli JavaScript entry')
  const node = process.env.PLAYWRIGHT_NODE || process.execPath
  const env = { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH}` }
  delete env.NODE_ENV
  delete env.PORT
  const runtime = spawnSync(node, ['--version'], { env, encoding: 'utf8', timeout: 10_000 })
  if (runtime.status !== 0 || !/^v24\./.test(runtime.stdout)) throw Error('CLI child must use Node 24')
  const session = `workspace-${process.pid}-${Date.now()}`
  const scratch = await mkdtemp(path.join(tmpdir(), 'workspace-ui-'))
  const cli = (...args) => {
    const result = spawnSync(node, [entry, `-s=${session}`, ...args], { cwd: scratch, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 12 * 1024 * 1024 })
    if (result.error || result.status !== 0 || /^### Error/m.test(result.stdout)) {
      throw Error(`CLI ${args[0]} failed: ${result.error || result.stdout + result.stderr}`)
    }
    return result.stdout
  }
  const server = spawn(node, [path.join(root, 'test/ui/fixture/server.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  server.stderr.on('data', (data) => { errors += data })
  try {
    const url = await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(Error(`Fixture readiness timed out: ${errors}`)), 20_000)
      server.once('exit', (code) => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${errors}`)) })
      server.stdout.on('data', (data) => {
        output += data
        for (const line of output.split('\n')) {
          try { const value = JSON.parse(line); if (value.url) { clearTimeout(timer); resolve(value.url) } } catch {}
        }
      })
    })
    const version = cli('--version').trim()
    cli('open', url)
    const code = `async (page) => { await page.setViewportSize({width:1440,height:900}); await page.waitForFunction(() => window.probe); return (${callback.toString()})(page) }`
    await writeFile(path.join(scratch, 'case.js'), code)
    const output = cli('run-code', '--filename', path.join(scratch, 'case.js'))
    const match = output.match(/^### Result\n([\s\S]*?)(?=\n### |$)/)
    if (!match) throw Error(`Missing structured CLI result: ${output}`)
    let result
    try { result = JSON.parse(match[1]) } catch { throw Error(`Invalid CLI result: ${output}`) }
    console.log(`UI runtime ${process.version}; CLI child ${runtime.stdout.trim()}; CLI ${version}`)
    return result
  } finally {
    try { cli('close') } finally {
      if (server.exitCode === null) {
        const exited = new Promise((resolve) => server.once('exit', resolve))
        server.kill('SIGTERM')
        const timer = setTimeout(() => server.kill('SIGKILL'), 5_000)
        await exited
        clearTimeout(timer)
      }
      await rm(scratch, { recursive: true, force: true })
    }
  }
}
