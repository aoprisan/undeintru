import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests are offline by contract: they read fixtures, never the network.
    env: { UNDEINTRU_OFFLINE: '1' },
  },
});
