import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_BACKEND_DEV_URL || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      host:  true,
      port:  Number(env.VITE_DEV_PORT) || 8080,
      proxy: {
        '/api':       { target: backendTarget, changeOrigin: true },
        '/socket.io': { target: backendTarget, changeOrigin: true, ws: true },
      },
    },
  };
});
