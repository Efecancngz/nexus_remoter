
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for better portability on mobile home screen

  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
