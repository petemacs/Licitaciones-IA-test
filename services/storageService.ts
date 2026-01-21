
import { supabase } from './supabaseClient';
import { TenderDocument, TenderStatus } from '../types';

const BUCKET_NAME = 'tender-documents';

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

export const loadTendersFromStorage = async (): Promise<TenderDocument[]> => {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((item: any) => ({
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

export const deleteTenderFromSupabase = async (tender: TenderDocument) => {
  try {
    if (tender.summaryUrl) await deleteFileFromSupabase(tender.summaryUrl);
    if (tender.adminUrl && tender.adminUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.adminUrl);
    if (tender.techUrl && tender.techUrl.includes(BUCKET_NAME)) await deleteFileFromSupabase(tender.techUrl);

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

export const loadRulesFromStorage = async (defaultRules: string): Promise<string> => {
  try {
    const { data, error } = await supabase
      .from('business_rules')
      .select('content')
      .eq('id', 1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return defaultRules;
      throw error;
    }
    return data.content;
  } catch (error) {
    return defaultRules;
  }
};

export const saveRulesToStorage = async (content: string) => {
  try {
    await supabase
      .from('business_rules')
      .upsert({ id: 1, content, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving rules:', error);
  }
};
