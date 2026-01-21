
import { supabase } from './supabaseClient';
import { TenderDocument, TenderStatus, BusinessRules } from '../types';

const BUCKET_NAME = 'tender-documents';

/**
 * Sube un archivo al bucket de Supabase y devuelve la URL pública.
 */
export const uploadFileToSupabase = async (file: File, folder: string): Promise<string | null> => {
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

/**
 * Borra un archivo del bucket usando su URL pública.
 */
export const deleteFileFromSupabase = async (url: string) => {
  try {
    const path = url.split(`${BUCKET_NAME}/`)[1];
    if (path) {
      await supabase.storage.from(BUCKET_NAME).remove([path]);
    }
  } catch (e) {
    console.warn('Could not delete file from storage:', url);
  }
};

/**
 * Carga todas las licitaciones desde la tabla 'tenders'.
 */
export const loadTendersFromStorage = async (): Promise<TenderDocument[]> => {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(item => ({
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
  } catch (error) {
    console.error('Error loading tenders:', error);
    return [];
  }
};

/**
 * Guarda o actualiza una licitación en Supabase.
 */
export const saveTenderToSupabase = async (tender: TenderDocument) => {
  try {
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
    console.error('Error saving tender:', error);
    throw error;
  }
};

/**
 * Borra una licitación y sus archivos asociados.
 */
export const deleteTenderFromSupabase = async (tender: TenderDocument) => {
  try {
    // 1. Borrar archivos de Storage si existen
    if (tender.summaryUrl) await deleteFileFromSupabase(tender.summaryUrl);
    if (tender.adminUrl && tender.adminUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.adminUrl);
    if (tender.techUrl && tender.techUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.techUrl);

    // 2. Borrar registro de la DB
    const { error } = await supabase
      .from('tenders')
      .delete()
      .eq('id', tender.id);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting tender:', error);
    throw error;
  }
};

/**
 * Carga las reglas de negocio globales.
 */
export const loadRulesFromStorage = async (defaultRules: string): Promise<string> => {
  try {
    const { data, error } = await supabase
      .from('business_rules')
      .select('content')
      .eq('id', 1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return defaultRules; // No hay reglas aún
      throw error;
    }
    return data.content;
  } catch (error) {
    return defaultRules;
  }
};

/**
 * Guarda las reglas de negocio globales.
 */
export const saveRulesToStorage = async (content: string) => {
  try {
    await supabase
      .from('business_rules')
      .upsert({ id: 1, content, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving rules:', error);
  }
};
