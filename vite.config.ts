import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Current bundle is intentionally larger during migration delivery.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn(warning, warn) {
        const message = warning.message ?? '';
        if (
          warning.code === 'EVAL'
          && warning.id?.includes('gray-matter')
          && message.includes('Use of eval')
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
