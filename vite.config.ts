
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carga variables desde archivos .env
  const env = loadEnv(mode, '.', '');
  
  return {
    plugins: [react()],
    define: {
      // Mapeamos process.env para que esté disponible en el navegador
      // Priorizamos process.env (Netlify UI) sobre los archivos .env locales
      'process.env': {
         ...env,
         API_KEY: process.env.API_KEY || env.API_KEY || env.VITE_API_KEY
      }
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    build: {
      target: 'esnext'
    }
  };
});
