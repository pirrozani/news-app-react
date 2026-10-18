import { defineConfig } from 'vitest/config'
import base from './vitest.config.ts'

export default defineConfig({
  ...base,
  test: { include: ['checks/feeds.test.ts'], testTimeout: 45_000 },
})
