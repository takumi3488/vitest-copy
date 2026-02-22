import { expect, test } from 'vitest'
import { browser, provider, runBrowserTests } from './utils'

test.skipIf(provider === 'webdriverio' && browser === 'firefox')('worker', async () => {
  const { ctx } = await runBrowserTests({
    root: './fixtures/worker',
  })
  expect(Object.fromEntries(ctx.state.getFiles().map(f => [f.name, f.result.state]))).toMatchInlineSnapshot(`
    {
      "src/basic.test.ts": "pass",
    }
  `)
})
