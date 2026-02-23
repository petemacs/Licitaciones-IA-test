
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * 🛠️ CONFIGURACIÓN DE CONEXIÓN:
 * 
 * Las comillas SON NECESARIAS. El formato debe ser: "https://..." y "sb_..."
 */

// 1. Pega tu URL aquí (entre las comillas)
const supabaseUrl = process.env.SUPABASE_URL || "https://uvkfyvftqfbykqkfaerd.supabase.co";

// 2. Pega tu llave 'anon' / 'publishable' aquí (entre las comillas)
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_latA4zLmLHaCvAqU87xnSw_dLjJ05z_";

// Verificamos si la configuración es válida para activar las funciones de nube
export const isCloudConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl.startsWith('http') &&
  supabaseUrl.includes('.supabase.co') &&
  !supabaseAnonKey.includes('TU_LLAVE')
);

if (!isCloudConfigured) {
  console.warn("⚠️ Supabase no está configurado. Revisa que hayas pegado bien la URL y la Key en services/supabaseClient.ts");
}

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
};

// Proxy to allow usage like `supabase.from(...)` while keeping lazy init
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase();
    // @ts-ignore
    return client[prop];
  }
});
