import assert from 'node:assert/strict'
import test from 'node:test'
import { runUI } from './fixture/driver.mjs'

// Removing ownership must duplicate DELETE; removing the atomic survivor guard
// must reject a delayed close or empty the project. These use the actual store.
test('workspace close preserves confirmation and async project invariants', async () => {
  const result = await runUI(async (page) => {
    const failures = [], checkpoints = []
    const check = (ok, message) => { if (!ok) failures.push(message) }
    const settle = () => page.waitForTimeout(70)
    const reset = async (o = {}) => { await page.evaluate((v) => window.probe.reset(v), o); await settle() }
    const close = async (id) => { await page.getByRole('button', { name: `Close ${{ a: 'Alpha', b: 'Beta' }[id]}`, exact: true }).click(); await settle() }
    const direct = async (id) => { await page.evaluate((v) => { void window.probe.close(v).catch(() => {}) }, id); await settle() }
    const approve = async (button = false) => {
      if (button) await page.getByRole('button', { name: 'Close workspace', exact: true }).click()
      else await page.keyboard.press('Enter')
      await settle()
      const reopened = await page.evaluate(() => window.probe.state().confirming)
      check(reopened === null, 'approval does not reopen a second confirmation')
      // Retain failing baseline evidence but settle its unexpected confirmation,
      // so later assertions observe duplicated DELETE rather than a blocked click.
      if (reopened) { await page.evaluate(() => window.probe.answer(true)); await settle() }
    }
    const snap = async (name, complete = true) => {
      await settle()
      const v = await page.evaluate(() => ({ state: window.probe.state(), trace: window.probe.trace.slice(), outcomes: window.probe.outcomes.slice(), pending: window.probe.pending() }))
      checkpoints.push({ name, ...v })
      check(!v.trace.some((e) => ['close-reject', 'unhandledrejection'].includes(e.kind)), `${name}: no close rejection`)
      check(v.outcomes.every((e) => e.status === 'fulfilled'), `${name}: raw close promises fulfill`)
      if (complete) check(v.outcomes.length === v.trace.filter((e) => e.kind === 'close-call').length, `${name}: every close promise settled`)
      for (const p of v.state.projects) check(p.ids.length > 0 && p.ids.includes(p.active), `${name}: nonempty project and valid active workspace`)
      return v
    }
    const deletes = (v) => v.trace.filter((e) => e.kind === 'mock-fetch' && e.method === 'DELETE')
    try {
    for (const active of ['a', 'b']) {
      for (const cancel of ['Cancel', 'Escape']) {
        await reset({ active, agents: true, delay: true })
        await close('b')
        let v = await snap(`${active}/${cancel}/confirmation`, false)
        check(v.state.confirming === 'Close Beta?', `${active}/${cancel}: first click opens confirmation`)
        const sheet = page.getByRole('alertdialog')
        check(await sheet.locator('h2').textContent() === 'Close Beta?' && await sheet.locator('p').textContent() === '1 running agent will stop.' && await sheet.locator('button').allTextContents().then((s) => s.map((t) => t.trim()).join()) === 'Cancel,Close workspace', 'existing confirmation strings retained')
        check(deletes(v).length === 0 && v.state.ids.join() === 'a,b,c', `${active}/${cancel}: no preapproval kill/removal`)
        if (cancel === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        else await page.keyboard.press('Escape')
        v = await snap(`${active}/${cancel}/cancelled`)
        check(v.state.confirming === null && v.state.ids.join() === 'a,b,c' && deletes(v).length === 0, 'cancellation keeps workspace and agent')
        await close('b')
        await approve(cancel === 'Cancel')
        v = await snap(`${active}/${cancel}/approved pending`, false)
        check(v.pending === 1 && deletes(v).length === 1 && v.state.ids.join() === 'a,b,c', 'retry approves exactly one held DELETE before removal')
        await page.evaluate(() => window.probe.release())
        v = await snap(`${active}/${cancel}/released`)
        check(v.state.ids.join() === 'a,c' && v.state.active === 'a' && v.state.confirming === null, 'approved close keeps first survivor/inactive selection')
      }
    }
    await reset({ agents: true })
    let r = await page.getByRole('button', { name: 'Close Beta', exact: true }).boundingBox()
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { clickCount: 2, delay: 30 })
    let v = await snap('normal sheet backdrop second hit')
    check(v.state.confirming === null && v.state.ids.join() === 'a,b,c' && deletes(v).length === 0, 'backdrop cancels rapid close without kill')
    check(v.state.inputs.length === 0 && !v.trace.some((e) => e.kind === 'rename-call'), 'backdrop second hit never renames')

    await reset({ count: 1 })
    await close('a')
    v = await snap('sole workspace')
    check(v.state.ids.join() === 'a' && v.state.toast === 'A project keeps at least one workspace', 'sole workspace preserves exact refusal')
    await reset()
    await page.locator('.tab-label').filter({ hasText: 'Beta' }).click()
    await page.locator('.tab-label').filter({ hasText: 'Beta' }).dblclick()
    check(await page.locator('.tab input').count() === 1, 'deliberate label double click opens rename')
    await page.locator('.tab input').fill('Renamed')
    await page.locator('.tab input').press('Enter')
    v = await snap('deliberate label switch and rename')
    check(v.state.active === 'b' && v.state.names.join() === 'Alpha,Renamed,Gamma', 'deliberate label switch and Enter rename preserved')

    await reset({ agents: true, delay: true })
    await close('b'); await approve()
    await close('b')
    v = await snap('duplicate UI during kill', false)
    check(v.state.confirming === null && deletes(v).length === 1, 'pending same-key UI close cannot reopen sheet or duplicate kill')
    // Settle an unexpected baseline sheet too, so duplicate DELETE is observable.
    await page.evaluate(() => window.probe.answer(true)); await settle()
    await direct('b')
    v = await snap('duplicate direct during kill', false)
    check(v.state.confirming === null && deletes(v).length === 1, 'pending same-key direct close cannot reopen sheet or duplicate kill')
    await page.evaluate(() => window.probe.answer(true)); await settle()
    v = await snap('duplicate kill count', false)
    check(deletes(v).length === 1 && v.pending === 1, 'one DELETE for all pending same-key closes')
    await page.evaluate(() => window.probe.release())
    v = await snap('duplicate closes released')
    check(v.state.ids.join() === 'a,c', 'duplicate closes remove only target')

    await reset({ count: 2, active: 'b', agents: true, delay: true })
    await close('b'); await approve()
    await close('a')
    v = await snap('last survivor before delayed release', false)
    check(v.state.ids.join() === 'b', 'another workspace may close while target kill awaits')
    await page.evaluate(() => window.probe.release())
    v = await snap('last survivor after delayed release')
    check(v.state.ids.join() === 'b' && v.state.active === 'b' && v.state.toast === 'A project keeps at least one workspace', 'atomic final check retains last workspace with exact refusal')

    for (const phase of ['confirmation', 'kill']) {
      await reset({ agents: true, delay: true, active: 'b' })
      await close('b')
      if (phase === 'kill') await approve()
      await page.evaluate(() => window.probe.switchProject())
      if (phase === 'kill') {
        await direct('b')
        v = await snap('same ID in distinct project', false)
        check(v.state.confirming === 'Close Beta?', 'ownership is scoped by project as well as workspace')
        await page.evaluate(() => window.probe.answer(false))
      }
      // Answer the captured sheet directly after switching projects. Native Enter
      // on the still-focused tab would intentionally start a second operation in
      // the new project; Enter is exercised above without that extra operation.
      if (phase === 'confirmation') { await page.evaluate(() => window.probe.answer(true)); await settle() }
      await page.evaluate(() => window.probe.release())
      v = await snap(`switch project during ${phase}`)
      check(v.state.activeProject === '/synthetic-other' && v.state.projects[0].ids.join() === 'a,c' && v.state.projects[0].active === 'a', 'only captured original project loses Beta')
      check(v.state.projects[1].ids.join() === 'a,b,c' && v.state.projects[1].active === 'b', 'current project remains untouched after await')
    }

    await reset({ count: 2, agents: true, delay: true, active: 'b' })
    await close('b')
    await page.evaluate(() => window.probe.removeWorkspace('a'))
    await approve()
    v = await snap('last workspace after confirmation', false)
    check(v.state.ids.join() === 'b' && v.state.toast === 'A project keeps at least one workspace' && deletes(v).length === 0, 'recheck after confirmation refuses before kill')
    await page.evaluate(() => window.probe.release())
    await snap('last workspace after confirmation settled')

    await reset({ agents: true, delay: true, active: 'b' })
    await close('b'); await approve()
    await page.locator('.tab-label').filter({ hasText: 'Gamma' }).click()
    await page.evaluate(() => window.probe.release())
    v = await snap('selection changed during kill')
    check(v.state.ids.join() === 'a,c' && v.state.active === 'c', 'latest surviving active workspace is preserved')

    await reset()
    await direct('missing')
    v = await snap('missing workspace')
    check(v.state.ids.join() === 'a,b,c' && deletes(v).length === 0 && v.state.confirming === null, 'missing ID settles harmlessly')
    for (const phase of ['confirmation', 'kill']) {
      await reset({ agents: true, delay: true })
      await close('b')
      if (phase === 'kill') await approve()
      await page.evaluate(() => window.probe.removeWorkspace('b'))
      if (phase === 'confirmation') await approve()
      await page.evaluate(() => window.probe.release())
      v = await snap(`vanished target during ${phase}`)
      check(v.state.ids.join() === 'a,c' && deletes(v).length === (phase === 'kill' ? 1 : 0), 'vanished target safely returns without new kill')
    }

    await reset({ agents: true, delay: true, reject: 1 })
    await close('b'); await approve()
    await page.evaluate(() => window.probe.release())
    v = await snap('rejected kill swallowed')
    check(v.state.ids.join() === 'a,c' && deletes(v).length === 1, 'existing kill-error policy still closes workspace')
    // Reuse the exact project/workspace key after settlement to expose leaked ownership.
    await reset({ agents: true, delay: true })
    await close('b'); await approve()
    v = await snap('retry after rejected kill', false)
    check(v.pending === 1 && deletes(v).length === 1, 'rejected kill releases same-key ownership')
    await page.evaluate(() => window.probe.release())
    v = await snap('retry after rejected kill released')
    check(v.state.ids.join() === 'a,c', 'retry after rejection closes normally')
    } catch (error) {
      failures.push(String(error))
      await snap('unexpected browser failure', false)
    }
    return { failures, checkpoints }
  })
  console.log(JSON.stringify(result))
  assert.deepEqual(result.failures, [])
})
