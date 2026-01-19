
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { TenderDocument, AnalysisResult } from "../types";
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
if (typeof window !== 'undefined' && 'Worker' in window) {
  // @ts-ignore
  const version = pdfjsLib.version || (pdfjsLib.default && pdfjsLib.default.version) || '4.0.379';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

const getAiClient = () => {
  // Intentamos obtener la clave de múltiples fuentes posibles inyectadas por Vite
  const key = process.env.API_KEY || (import.meta as any).env?.VITE_API_KEY;
  
  if (!key || key === "undefined" || key === "") {
    throw new Error("API Key no encontrada. Asegúrate de que la variable API_KEY esté configurada en Netlify y hayas hecho un 'Deploy project'.");
  }
  return new GoogleGenAI({ apiKey: key });
};

const fileToPart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64Data = reader.result.split(',')[1];
        resolve({
          inlineData: {
            data: base64Data,
            mimeType: file.type,
          },
        });
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const normalizeText = (text: string) => {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

export const classifyFile = (file: File, url: string = ""): 'ADMIN' | 'TECH' | 'UNKNOWN' => {
  const combinedText = normalizeText(file.name + " " + url);
  if (combinedText.includes('pcap') || combinedText.includes('admin') || combinedText.includes('clausula') || combinedText.includes('juridico') || combinedText.includes('caratula') || combinedText.includes('bases') || combinedText.includes('anexo')) return 'ADMIN';
  if (combinedText.includes('ppt') || combinedText.includes('tecnic') || combinedText.includes('prescrip') || combinedText.includes('memoria') || combinedText.includes('proyecto')) return 'TECH';
  return 'UNKNOWN';
};

export const extractLinksFromPdf = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const pdfjs = pdfjsLib.getDocument ? pdfjsLib : pdfjsLib.default;
    if (!pdfjs) return [];
    const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const links: Set<string> = new Set();
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const annotations = await page.getAnnotations();
        for (const ant of annotations) if (ant.subtype === 'Link' && ant.url) links.add(ant.url);
        const textContent = await page.getTextContent();
        const textStr = textContent.items.map((item: any) => item.str).join(' ');
        const urlRegex = /((https?:\/\/|www\.)[^\s<>"']+|[a-zA-Z0-9\-\.]+\.(es|com|org|net|gob)\/[^\s<>"']*)/gi;
        const matches = textStr.match(urlRegex);
        if (matches) {
          matches.forEach((url: string) => {
            let cleanUrl = url.replace(/[.,;)]+$/, "");
            if (cleanUrl.startsWith('www.')) cleanUrl = 'https://' + cleanUrl;
            else if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
            links.add(cleanUrl);
          });
        }
      } catch (e) {}
    }
    return Array.from(links);
  } catch (error) {
    return [];
  }
};

export const downloadFileFromUrl = async (url: string, defaultPrefix: string): Promise<File | null> => {
  if (!url || (!url.startsWith('http') && !url.startsWith('www'))) return null;
  if (url.startsWith('www')) url = 'https://' + url;
  const tryDownload = async (fetchUrl: string): Promise<{ blob: Blob, filename?: string } | null> => {
    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (blob.type.includes('text/html') || blob.size < 2000) return null;
      let filename = "";
      const disposition = response.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename=['"]?([^'"]+)['"]?/);
        if (match && match[1]) filename = match[1];
      }
      return { blob, filename };
    } catch (e) { return null; }
  };
  try {
    let result = await tryDownload(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    if (!result) result = await tryDownload(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    if (!result) return null;
    let { blob, filename } = result;
    if (!filename) {
       try {
         const urlObj = new URL(url);
         const parts = urlObj.pathname.split('/');
         const lastPart = parts[parts.length - 1];
         if (lastPart && (lastPart.toLowerCase().includes('.pdf') || lastPart.toLowerCase().includes('.zip'))) filename = decodeURIComponent(lastPart);
       } catch(e) {}
    }
    let extension = ".pdf";
    if (filename && filename.includes('.')) {} else {
      if (blob.type === "application/pdf") extension = ".pdf";
      else if (blob.type.includes("zip")) extension = ".zip";
      else if (blob.type.includes("word")) extension = ".docx";
    }
    const finalName = filename || `${defaultPrefix}_${new Date().getTime()}${extension}`;
    return new File([blob], finalName, { type: blob.type });
  } catch (error) { return null; }
};

export const probeAndDownloadLink = async (url: string): Promise<{ file: File, type: 'ADMIN' | 'TECH' | 'UNKNOWN' } | null> => {
  const lower = url.toLowerCase();
  if (lower.startsWith('mailto:') || lower.includes('google.com') || lower.includes('facebook') || lower.includes('twitter') || lower.includes('linkedin') || lower.includes('maps.') || lower.includes('youtube')) return null;
  const file = await downloadFileFromUrl(url, "doc");
  return file ? { file, type: classifyFile(file, url) } : null;
};

export const probeLinksInBatches = async (links: string[], onProgress?: (processed: number, total: number) => void): Promise<{ admin?: File, tech?: File }> => {
  const uniqueLinks = Array.from(new Set(links));
  const results: { admin?: File, tech?: File } = {};
  const BATCH_SIZE = 4;
  let processed = 0;
  for (let i = 0; i < uniqueLinks.length; i += BATCH_SIZE) {
    if (results.admin && results.tech) break;
    const batch = uniqueLinks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(url => probeAndDownloadLink(url)));
    for (const res of batchResults) {
      if (res && res.file) {
        if (res.type === 'ADMIN' && !results.admin) results.admin = res.file;
        else if (res.type === 'TECH' && !results.tech) results.tech = res.file;
        else if (res.type === 'UNKNOWN') {
           if (!results.admin) results.admin = res.file; 
           else if (!results.tech) results.tech = res.file;
        }
      }
    }
    processed += batch.length;
    if (onProgress) onProgress(Math.min(processed, uniqueLinks.length), uniqueLinks.length);
  }
  return results;
};

export const scrapeDocsFromWeb = async (pageUrl: string): Promise<{ adminUrl?: string, techUrl?: string, candidates: string[] }> => {
  if (!pageUrl || !pageUrl.startsWith('http')) return { candidates: [] };
  try {
    const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(pageUrl)}`);
    const htmlString = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    let adminUrl: string | undefined, techUrl: string | undefined;
    const candidates: string[] = [];
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('javascript') || href === '#' || href === '/') continue;
      let fullUrl = href;
      try { if (!href.startsWith('http')) fullUrl = new URL(href, pageUrl).href; } catch(e) {}
      const combinedText = normalizeText(`${link.textContent} ${link.getAttribute('title')} ${link.getAttribute('class')} ${href}`);
      if (fullUrl.toLowerCase().endsWith('.pdf') || fullUrl.toLowerCase().endsWith('.zip') || combinedText.includes('descarga') || combinedText.includes('pliego') || combinedText.includes('doc')) candidates.push(fullUrl);
      if (!adminUrl && (combinedText.includes('pcap') || combinedText.includes('clausulas') || combinedText.includes('administrativ') || combinedText.includes('caratula') || combinedText.includes('bases') || combinedText.includes('anexo'))) adminUrl = fullUrl;
      if (!techUrl && (combinedText.includes('ppt') || combinedText.includes('prescripciones') || combinedText.includes('tecnic') || combinedText.includes('memoria') || combinedText.includes('proyecto'))) techUrl = fullUrl;
    }
    return { adminUrl, techUrl, candidates };
  } catch (error) { return { candidates: [] }; }
};

export const extractMetadataFromTenderFile = async (file: File): Promise<{ 
  name: string; 
  adminUrl: string; 
  techUrl: string; 
  tenderPageUrl: string;
  budget: string;
  scoringSystem: string; 
  expedientNumber: string;
  deadline: string;
  allLinks: string[]; 
}> => {
  const ai = getAiClient();
  const filePart = await fileToPart(file);

  const prompt = `
    Analiza este documento de licitación (Hoja Resumen). Extrae los siguientes datos con precisión:
    
    1. NAME: Título completo del expediente.
    2. BUDGET: Presupuesto base de licitación o valor estimado (SIN IMPUESTOS). Incluye el símbolo de moneda.
    3. SCORING SYSTEM: Resume brevemente los criterios de adjudicación. Ej: "Precio 60%, Técnico 40%".
    4. EXPEDIENT: Número de expediente administrativo (EJ: 2024/0001X).
    5. DEADLINE: Fecha límite de presentación de ofertas (Formato YYYY-MM-DD).
    6. TENDER PAGE URL: Enlace a la plataforma de contratación.
    7. ADMIN URL: Enlace directo al Pliego Administrativo (PCAP).
    8. TECH URL: Enlace directo al Pliego Técnico (PPT).
    9. ALL LINKS: Lista EXHAUSTIVA de TODOS los enlaces web que visualmente aparezcan.
    
    Responde estrictamente en JSON.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      budget: { type: Type.STRING },
      scoringSystem: { type: Type.STRING },
      expedientNumber: { type: Type.STRING },
      deadline: { type: Type.STRING },
      tenderPageUrl: { type: Type.STRING },
      adminUrl: { type: Type.STRING },
      techUrl: { type: Type.STRING },
      allLinks: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["name"],
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [filePart, { text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const text = response.text;
    if (!text) return { name: "", adminUrl: "", techUrl: "", tenderPageUrl: "", budget: "", scoringSystem: "", expedientNumber: "", deadline: "", allLinks: [] };
    return JSON.parse(text);
  } catch (error) { throw error; }
};

export const buildAnalysisSystemPrompt = (rules: string) => {
  return `
    Actúa como un Analista Senior de Licitaciones Públicas (Bid Manager). Analiza los pliegos (PCAP y PPT).
    REGLAS DE NEGOCIO: ${rules}
    DECISIÓN FINAL: KEEP, DISCARD, REVIEW.
    Responde en JSON con Economic, Scope, Resources, Solvency, Strategy y Scoring Breakdown.
  `;
};

export const analyzeTenderWithGemini = async (tender: TenderDocument, rules: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const parts: any[] = [{ text: `Expediente: ${tender.name}\nPresupuesto: ${tender.budget}\nCriterios: ${tender.scoringSystem}` }];
  if (tender.summaryFile) parts.push(await fileToPart(tender.summaryFile));
  if (tender.adminFile) parts.push(await fileToPart(tender.adminFile));
  if (tender.techFile) parts.push(await fileToPart(tender.techFile));

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      decision: { type: Type.STRING, enum: ["KEEP", "DISCARD", "REVIEW"] },
      summaryReasoning: { type: Type.STRING },
      economic: { type: Type.OBJECT, properties: { budget: { type: Type.STRING }, model: { type: Type.STRING }, basis: { type: Type.STRING } } },
      scope: { type: Type.OBJECT, properties: { objective: { type: Type.STRING }, deliverables: { type: Type.ARRAY, items: { type: Type.STRING } } } },
      resources: { type: Type.OBJECT, properties: { duration: { type: Type.STRING }, team: { type: Type.STRING }, dedication: { type: Type.STRING } } },
      solvency: { type: Type.OBJECT, properties: { certifications: { type: Type.STRING }, specificSolvency: { type: Type.STRING }, penalties: { type: Type.STRING } } },
      strategy: { type: Type.OBJECT, properties: { angle: { type: Type.STRING } } },
      scoring: { type: Type.OBJECT, properties: { priceWeight: { type: Type.NUMBER }, formulaWeight: { type: Type.NUMBER }, valueWeight: { type: Type.NUMBER }, details: { type: Type.STRING }, subCriteria: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, weight: { type: Type.NUMBER }, category: { type: Type.STRING, enum: ["PRICE", "FORMULA", "VALUE"] } } } } }, required: ["priceWeight", "formulaWeight", "valueWeight", "details", "subCriteria"] },
    },
    required: ["decision", "summaryReasoning", "economic", "scope", "resources", "solvency", "strategy", "scoring"],
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: 'user', parts: parts }],
    config: { systemInstruction: buildAnalysisSystemPrompt(rules), responseMimeType: "application/json", responseSchema: responseSchema },
  });
  return JSON.parse(response.text!);
};
