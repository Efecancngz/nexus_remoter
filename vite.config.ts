
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  base: './', // Use relative paths for better portability on mobile home screen
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
