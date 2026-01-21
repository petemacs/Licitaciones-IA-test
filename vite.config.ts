
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carga variables desde archivos .env locales
  const env = loadEnv(mode, '.', '');
  
  // Capturamos las variables de entorno para Gemini y Supabase
  const apiKey = process.env.API_KEY || env.API_KEY || env.VITE_API_KEY || '';
  const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';

  return {
    plugins: [react()],
    define: {
      // Definimos específicamente las variables para que Vite las reemplace en el código del cliente
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey)
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
