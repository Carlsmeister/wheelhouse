import assert from 'node:assert/strict'
import test from 'node:test'
import { runUI } from './fixture/driver.mjs'

// A background keyboard close must not replace another workspace's sheet and
// orphan its resolver. Cancelling must release ownership for a real retry.
test('keyboard close preserves the pending confirmation and allows retry', async () => {
  const result = await runUI(async (page) => {
    const failures = [], checkpoints = []
    const check = (ok, message) => { if (!ok) failures.push(message) }
    const settle = () => page.waitForTimeout(50)
    const snapshot = async (name) => {
      await settle()
      const value = await page.evaluate(() => ({ state: window.probe.state(), outcomes: window.probe.outcomes.slice(), trace: window.probe.trace.slice(), focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent }))
      checkpoints.push({ name, ...value })
      check(!value.trace.some((e) => ['close-reject', 'unhandledrejection'].includes(e.kind)), `${name}: no rejected close`)
      return value
    }
    const focusClose = async (name) => {
      await page.mouse.click(20, 180)
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        if (await page.evaluate((label) => document.activeElement?.getAttribute('aria-label') === label, `Close ${name}`)) return true
      }
      check(false, `Tab reaches Close ${name}`)
      return false
    }
    await page.evaluate(() => window.probe.reset({ agents: true, secondAgent: true }))
    await settle()
    if (await focusClose('Beta')) await page.keyboard.press('Space')
    let v = await snapshot('Beta opened with Space')
    check(v.state.confirming === 'Close Beta?', 'Space opens Beta confirmation')
    // Follow native focus traversal until the other close or the sheet's Cancel
    // button. A reachable background close used to overwrite the pending sheet.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const target = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), cancel: !!document.activeElement?.closest('.confirm-sheet') && document.activeElement?.textContent === 'Cancel' }))
      if (target.label === 'Close Gamma') { await page.keyboard.press('Space'); break }
      if (target.cancel) break
    }
    v = await snapshot('native background close attempt')
    check(v.state.confirming === 'Close Beta?', 'background close cannot replace Beta sheet')
    check(v.trace.filter((e) => e.kind === 'close-call').length === 1, 'only the original close is pending')
    check(v.outcomes.length === 0, 'original close remains pending until answered')
    await page.keyboard.press('Escape')
    v = await snapshot('Escape cancels original request')
    check(v.state.confirming === null && v.state.ids.join() === 'a,b,c', 'Escape cancels without removing a workspace')
    check(v.outcomes.length === 1 && v.outcomes[0].id === 'b' && v.outcomes[0].status === 'fulfilled', 'Escape settles the original Beta promise')
    if (await focusClose('Beta')) await page.keyboard.press('Space')
    v = await snapshot('Beta retry opens a new sheet')
    check(v.state.confirming === 'Close Beta?', 'cancel releases ownership for Beta retry')
    if (v.state.confirming === 'Close Beta?') await page.keyboard.press('Enter')
    v = await snapshot('Enter confirms Beta retry')
    check(v.state.ids.join() === 'a,c' && v.state.active === 'a' && v.state.confirming === null, 'Enter removes only Beta and preserves selection')
    check(v.outcomes.filter((o) => o.id === 'b' && o.status === 'fulfilled').length === 2, 'both Beta close promises settle')
    check(v.trace.filter((e) => e.kind === 'mock-fetch' && e.method === 'DELETE').map((e) => e.url).join() === '/api/pty/synthetic-agent', 'only Beta agent is killed')
    if (await focusClose('Gamma')) await page.keyboard.press('Space')
    v = await snapshot('Gamma remains operable after Beta settlement')
    check(v.state.confirming === 'Close Gamma?', 'other live workspace can close after settlement')
    await page.keyboard.press('Escape')
    v = await snapshot('Gamma cancellation settles')
    check(v.outcomes.some((o) => o.id === 'c' && o.status === 'fulfilled'), 'Gamma cancellation settles its promise')
    return { failures, checkpoints }
  })
  console.log(JSON.stringify(result))
  assert.deepEqual(result.failures, [])
})

// Catches undersized/hover-shifting close targets and close-origin dblclick
// retargeting after removal, while preserving deliberate label/keyboard input.
test('workspace close targets stay stable and own rapid gestures', async () => {
  const result = await runUI(async (page) => {
    const failures = [], checkpoints = []
    const check = (ok, message) => { if (!ok) failures.push(message) }
    const settle = () => page.waitForTimeout(50)
    const reset = async (options = {}) => { await page.mouse.move(20, 180); await page.evaluate((o) => window.probe.reset(o), options); await settle() }
    const tab = (id) => page.locator('.tab').filter({ hasText: { a: 'Alpha', b: 'Beta', c: 'Gamma' }[id] })
    const snapshot = async (name) => {
      await settle()
      const value = await page.evaluate(() => ({ state: window.probe.state(), trace: window.probe.trace.slice(), geometry: window.probe.geometry() }))
      checkpoints.push({ name, ...value })
      check(!value.trace.some((e) => ['close-reject', 'unhandledrejection'].includes(e.kind)), `${name}: close promises resolve`)
      return value
    }
    const point = async (id) => { await tab(id).hover(); return tab(id).locator('.x').boundingBox() }
    for (const active of ['a', 'b']) {
      for (const edge of ['center', 'left', 'right', 'top', 'bottom']) {
        await reset({ active })
        const r = await point('b')
        check(r.width >= 24 && r.height >= 24, `${active}/${edge}: target at least 24x24, got ${r.width}x${r.height}`)
        const x = r.x + (edge === 'left' ? 0.5 : edge === 'right' ? r.width - 0.5 : r.width / 2)
        const y = r.y + (edge === 'top' ? 0.5 : edge === 'bottom' ? r.height - 0.5 : r.height / 2)
        await page.mouse.click(x, y)
        const v = await snapshot(`${active}/${edge}`)
        check(v.state.ids.join() === 'a,c', `${active}/${edge}: only Beta removed`)
        check(v.state.active === 'a', `${active}/${edge}: survivor/inactive selection`)
        check(v.trace.filter((e) => e.kind === 'close-call').length === 1, `${active}/${edge}: one close`)
        check(!v.trace.some((e) => e.kind === 'switch-call'), `${active}/${edge}: no switch call`)
      }
    }
    await reset()
    const before = await page.evaluate(() => window.probe.geometry())
    await tab('b').hover()
    const hovered = await page.evaluate(() => window.probe.geometry())
    await page.mouse.move(20, 180)
    const after = await page.evaluate(() => window.probe.geometry())
    check(JSON.stringify(before) === JSON.stringify(after), 'unhover restores unchanged geometry')
    for (let i = 0; i < 3; i++) {
      check(JSON.stringify(before[i].tab) === JSON.stringify(hovered[i].tab), 'hover leaves tab geometry unchanged')
      check(JSON.stringify(before[i].x) === JSON.stringify(hovered[i].x), 'hover leaves close geometry unchanged')
    }
    const semantics = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((e) => ({ tag: e.tagName, label: e.querySelector('.tab-label')?.tagName, close: e.querySelector('.x')?.tagName, name: e.querySelector('.x')?.getAttribute('aria-label'), nested: !!e.querySelector('button button, button input') })))
    check(semantics.every((e) => e.tag !== 'BUTTON' && e.label === 'BUTTON' && e.close === 'BUTTON' && !e.nested), 'label and close are sibling buttons')
    check(semantics[1].name === 'Close Beta', 'close has accessible workspace name')
    for (const options of [{ count: 1 }, {}, { active: 'b' }, { agents: true }]) {
      await reset(options)
      const id = options.count === 1 ? 'a' : 'b', r = await point(id)
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { clickCount: 2, delay: 30 })
      const v = await snapshot(`native rapid ${JSON.stringify(options)}`)
      check(v.state.inputs.length === 0 && !v.trace.some((e) => e.kind === 'rename-call'), 'native close sequence never renames')
      check(!v.trace.some((e) => e.kind === 'switch-call'), 'native close sequence never switches')
      check(v.trace.filter((e) => e.kind === 'close-call').length === 1, 'native rapid sequence closes once')
      if (options.count === 1) check(v.state.ids.join() === 'a' && v.state.toast?.includes('A project keeps at least one workspace'), 'sole workspace refuses operably')
      if (options.agents) check(v.state.ids.join() === 'a,b,c' && v.state.confirming === null, 'normal sheet second hit cancels')
      if (!options.count && !options.agents) check(v.state.ids.join() === 'a,c' && v.state.active === 'a', 'rapid sequence removes only Beta with first survivor active')
    }
    await reset()
    let r = await point('b')
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
    await settle()
    // Native detail-2 click explicitly aimed at the surviving label.
    let label = tab('c').locator('.tab-label')
    if (!await label.count()) label = tab('c')
    r = await label.boundingBox()
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    let v = await snapshot('explicit adjacent detail-2')
    check(v.state.inputs.length === 0 && !v.trace.some((e) => e.kind === 'switch-call'), 'retargeted second click neither renames nor switches')
    // A fresh detail-1 label mousedown releases close-origin ownership.
    await page.mouse.click(20, 180)
    label = tab('c').locator('.tab-label')
    if (!await label.count()) label = tab('c')
    await label.click()
    await label.dblclick()
    check(await page.locator('.tab input').count() === 1, 'fresh deliberate label double click enters rename')
    await page.locator('.tab input').fill('Named')
    await page.locator('.tab input').press('Enter')
    v = await snapshot('deliberate rename Enter')
    check(v.state.names.join() === 'Alpha,Named' && v.state.active === 'c', 'deliberate switch and Enter commit')
    for (const [value, want] of [['Blurred', 'Blurred'], ['   ', 'Blurred']]) {
      const last = page.locator('.tab').last()
      const l = await last.locator('.tab-label').count() ? last.locator('.tab-label') : last
      await l.dblclick(); await page.locator('.tab input').fill(value); await page.mouse.click(20, 180)
      check((await snapshot('blur rename')).state.names.at(-1) === want, 'blur commits and blank preserves name')
    }
    for (const key of ['Enter', 'Space']) {
      await reset()
      const close = tab('b').locator('.x')
      if (await close.evaluate((e) => e.tagName) !== 'BUTTON') { check(false, `${key}: close is keyboard operable`); continue }
      await page.locator('body').click({ position: { x: 20, y: 180 } })
      let reached = false
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab')
        if (await close.evaluate((e) => e === document.activeElement)) { reached = true; break }
      }
      check(reached, 'Tab reaches close')
      check(await close.evaluate((e) => getComputedStyle(e).outlineStyle !== 'none' && parseFloat(getComputedStyle(e).outlineWidth) > 0), 'close has visible keyboard focus')
      await page.keyboard.press(key)
      v = await snapshot(`keyboard ${key}`)
      check(v.state.ids.join() === 'a,c' && v.state.active === 'a', `${key}: closes once without switching`)
      check(v.trace.filter((e) => e.kind === 'close-call').length === 1, `${key}: one close call`)
    }
    return { failures, checkpoints }
  })
  console.log(JSON.stringify(result))
  assert.deepEqual(result.failures, [])
})
