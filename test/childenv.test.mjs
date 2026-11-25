import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanEnv } from '../server/childenv.mjs'

test('consoles do not inherit the app NODE_ENV and PORT, but keep ordinary variables', () => {
  const env = cleanEnv({ NODE_ENV: 'production', PORT: '4318', PATH: '/bin', HOME: '/h', FOO: 'bar', CLAUDECODE: '1' })
  assert.equal('NODE_ENV' in env, false)
  assert.equal('PORT' in env, false)
  assert.equal('CLAUDECODE' in env, false)
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', FOO: 'bar' })
})
