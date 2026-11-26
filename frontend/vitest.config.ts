import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/lib/format.ts', 'src/lib/validation.ts', 'src/lib/api.ts', 'src/lib/portfolio.ts', 'src/lib/ai.ts', 'src/lib/catalog.ts', 'src/lib/strategy.ts', 'src/lib/spend.ts', 'src/lib/plaid-link.ts', 'src/lib/credit-report.ts', 'src/components/charts.tsx', 'src/components/ui.tsx', 'src/components/card-bits.tsx', 'src/app/login/login-form.tsx'], thresholds: { lines: 80, branches: 85 }, reporter: ['text-summary', 'json-summary'] },
  },
});
