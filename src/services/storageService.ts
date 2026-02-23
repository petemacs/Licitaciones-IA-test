
import { supabase, isCloudConfigured } from './supabaseClient';
import { TenderDocument, TenderStatus } from '../types';
import { get, set } from 'idb-keyval';

const BUCKET_NAME = 'tender-documents';
const LOCAL_STORAGE_KEY = 'tenders_local_data';

export const uploadFileToSupabase = async (file: File, folder: string): Promise<string | null> => {
  if (!isCloudConfigured) return null;
  try {
    const fileName = `${folder}/${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, file);

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    return null;
  }
};

export const deleteFileFromSupabase = async (url: string) => {
  if (!isCloudConfigured) return;
  try {
    const path = url.split(`${BUCKET_NAME}/`)[1];
    if (path) {
      await supabase.storage.from(BUCKET_NAME).remove([path]);
    }
  } catch (e) {
    console.warn('Could not delete file from storage:', url);
  }
};

export const loadTendersFromStorage = async (): Promise<TenderDocument[]> => {
  let tenders: TenderDocument[] = [];

  if (isCloudConfigured) {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        tenders = data.map((item: any) => ({
          id: item.id,
          name: item.name,
          budget: item.budget,
          scoringSystem: item.scoring_system,
          expedientNumber: item.expedient_number,
          deadline: item.deadline,
          tenderPageUrl: item.tender_page_url,
          adminUrl: item.admin_url,
          techUrl: item.tech_url,
          summaryUrl: item.summary_url,
          status: item.status as TenderStatus,
          aiAnalysis: item.ai_analysis,
          createdAt: new Date(item.created_at).getTime(),
        }));
      }
    } catch (error) {
      console.error('Error loading from Supabase, falling back to IDB:', error);
    }
  }

  const localData = await get(LOCAL_STORAGE_KEY);
  if (localData) {
    const localTenders = localData as TenderDocument[];
    if (tenders.length === 0) {
      tenders = localTenders;
    } else {
      tenders = tenders.map(t => {
        const local = localTenders.find(lt => lt.id === t.id);
        if (local) {
          return {
            ...t,
            summaryFile: local.summaryFile,
            adminFile: local.adminFile,
            techFile: local.techFile
          };
        }
        return t;
      });
    }
  }

  return tenders;
};

export const saveTenderToStorage = async (tender: TenderDocument) => {
  // 1. Guardar siempre en IndexedDB (para mantener los archivos binarios File)
  const currentTenders = (await get(LOCAL_STORAGE_KEY)) || [];
  const updatedTenders = [tender, ...currentTenders.filter((t: any) => t.id !== tender.id)];
  await set(LOCAL_STORAGE_KEY, updatedTenders);

  // 2. Guardar en Supabase Table si está configurado
  if (isCloudConfigured) {
    try {
      // Importante: No podemos enviar el objeto File binario en un upsert JSON.
      // Creamos una copia limpia solo con datos planos para la base de datos.
      const { error } = await supabase
        .from('tenders')
        .upsert({
          id: tender.id,
          name: tender.name,
          budget: tender.budget,
          scoring_system: tender.scoringSystem,
          expedient_number: tender.expedientNumber,
          deadline: tender.deadline,
          tender_page_url: tender.tenderPageUrl,
          admin_url: tender.adminUrl,
          tech_url: tender.techUrl,
          summary_url: tender.summaryUrl,
          status: tender.status,
          ai_analysis: tender.aiAnalysis,
          created_at: new Date(tender.createdAt).toISOString(),
        });
      if (error) throw error;
    } catch (error) {
      console.error('Error saving to Supabase Table:', error);
    }
  }
};

export const deleteTenderFromStorage = async (tender: TenderDocument) => {
  // 1. Si hay nube, borrar primero de la nube para asegurar consistencia
  if (isCloudConfigured) {
    try {
      // Borrar archivos asociados (si fallan, seguimos intentando borrar el registro)
      if (tender.summaryUrl) await deleteFileFromSupabase(tender.summaryUrl);
      if (tender.adminUrl && tender.adminUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.adminUrl);
      if (tender.techUrl && tender.techUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.techUrl);

      // Borrar registro de la tabla
      const { error } = await supabase.from('tenders').delete().eq('id', tender.id);
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting tender record from Supabase:', error);
      // Re-lanzamos el error para evitar que se borre de local si falló la nube
      throw new Error("Error al eliminar de la base de datos remota. Inténtalo de nuevo.");
    }
  }

  // 2. Si todo salió bien (o no hay nube), borrar de local
  const currentTenders = (await get(LOCAL_STORAGE_KEY)) || [];
  await set(LOCAL_STORAGE_KEY, currentTenders.filter((t: any) => t.id !== tender.id));
};

export const loadRulesFromStorage = async (defaultRules: string): Promise<string> => {
  const localRules = await get('business_rules');
  if (localRules) return localRules;

  if (isCloudConfigured) {
    try {
      const { data, error } = await supabase
        .from('business_rules')
        .select('content')
        .eq('id', 1)
        .single();
      if (!error && data) return data.content;
    } catch (e) {}
  }
  return defaultRules;
};

export const saveRulesToStorage = async (content: string) => {
  await set('business_rules', content);
  if (isCloudConfigured) {
    try {
      await supabase
        .from('business_rules')
        .upsert({ id: 1, content, updated_at: new Date().toISOString() });
    } catch (error) {}
  }
};
