import { expect, test } from 'vitest'
import { runVitest } from '../../test-utils'
import { browser, provider } from './utils'

test.skipIf(provider === 'webdriverio' && browser === 'firefox')('benchmark', async () => {
  const result = await runVitest({ root: 'fixtures/benchmark' }, [], 'benchmark')
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('✓ basic.bench.ts > suite-a')
  expect(result.exitCode).toBe(0)
})
