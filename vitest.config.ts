import { defineConfig, mergeConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default mergeConfig(
  { plugins: [react(), tsconfigPaths()] },
  defineConfig({
    test: {
      environment: 'node',
      globals: true,
    },
  })
)
