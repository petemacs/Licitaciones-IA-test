
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carga variables desde archivos .env locales
  const env = loadEnv(mode, '.', '');
  
  // Capturamos la API_KEY de Netlify (process.env) o del archivo .env (env)
  const apiKey = process.env.API_KEY || env.API_KEY || env.VITE_API_KEY || '';

  return {
    plugins: [react()],
    define: {
      // Definimos específicamente la variable para que Vite la reemplace en el código
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    build: {
      target: 'esnext',
      outDir: 'dist'
    }
  };
});
