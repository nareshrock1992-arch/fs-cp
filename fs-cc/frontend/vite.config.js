import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load .env so we can read VITE_BACKEND_DEV_URL without it being bundled
  const env = loadEnv(mode, process.cwd(), '');

  // Where the backend runs during local development.
  // Override with VITE_BACKEND_DEV_URL=http://localhost:4000 in frontend/.env
  const backendTarget = env.VITE_BACKEND_DEV_URL || 'http://localhost:4000';

  return {
    plugins: [react()],

    server: {
      host: true,
      port: Number(env.VITE_DEV_PORT) || 5173,

      // Dev proxy: mirrors what Nginx does in production so relative paths
      // (/api/* and /socket.io/*) work in both environments without any code change.
      proxy: {
        '/api': {
          target:       backendTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target:       backendTarget,
          changeOrigin: true,
          ws:           true,
        },
      },
    },
  };
});
