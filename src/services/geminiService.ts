
import { GoogleGenAI, Type } from "@google/genai";
import { TenderDocument, AnalysisResult } from "../types";
import * as pdfjsLib from 'pdfjs-dist';

// Configuración del worker de PDF.js
if (typeof window !== 'undefined') {
  try {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn("Failed to initialize PDF.js worker:", e);
  }
}

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) throw new Error("API Key no configurada. Asegúrate de que la variable GEMINI_API_KEY está definida en el entorno.");
  return new GoogleGenAI({ apiKey });
};

export const buildAnalysisSystemPrompt = (rules: string) => {
  return `Eres un experto senior en licitaciones públicas españolas. Tu misión es analizar la VIABILIDAD técnica y administrativa de un expediente basándote en:
1. REGLAS DE NEGOCIO DEL USUARIO: ${rules}
2. DOCUMENTOS ADJUNTOS: Analiza PCAP y PPT adjuntos si están presentes.
3. BÚSQUEDA WEB: Solo si la información en los archivos es insuficiente, usa Google Search para completar datos de solvencia o criterios.

Tu objetivo final es determinar si la empresa debe presentarse o no. Responde siempre en español con rigor técnico. El resultado debe ser un JSON puro.`;
};

export const fetchFileFromUrl = async (url: string, defaultName: string): Promise<File | null> => {
  if (!url || !url.startsWith('http')) return null;
  
  const getCleanName = (url: string, fallback: string) => {
    try {
      let n = url.split('/').pop()?.split('?')[0] || fallback;
      if (!n.toLowerCase().endsWith('.pdf')) n += '.pdf';
      return n;
    } catch { return fallback; }
  };

  const attemptFetch = async (targetUrl: string) => {
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/pdf' }
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const blob = await response.blob();
      if (blob.size < 500) throw new Error("Archivo demasiado pequeño (posible error HTML)");
      return new File([blob], getCleanName(url, defaultName), { type: 'application/pdf' });
    } catch (e) {
      throw e;
    }
  };

  const strategies = [
    () => attemptFetch(url),
    () => attemptFetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`),
    () => attemptFetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`),
    () => attemptFetch(`https://corsproxy.io/?${encodeURIComponent(url)}`),
    () => attemptFetch(`https://cors-anywhere.herokuapp.com/${url}`) 
  ];

  for (const strategy of strategies) {
    try {
      const file = await strategy();
      if (file) return file;
    } catch (e) {
      console.warn(`Error descargando ${url}`);
    }
  }
  return null;
};

const fileToPart = async (file: File): Promise<{ inlineData?: { data: string; mimeType: string } } | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        resolve({ inlineData: { data: reader.result.split(',')[1], mimeType } });
      } else reject(new Error("Fallo en base64"));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const parseAiJson = (text: string) => {
  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Error parseando JSON de la IA:", text);
    throw new Error("Formato inválido.");
  }
};

export const analyzeTenderWithGemini = async (tender: TenderDocument, rules: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const filesToProcess: File[] = [];

  // Descargar archivos si están en la nube pero no en local
  const tempAdminFile = !tender.adminFile && tender.adminUrl ? await fetchFileFromUrl(tender.adminUrl, 'PCAP_Nube.pdf') : tender.adminFile;
  const tempTechFile = !tender.techFile && tender.techUrl ? await fetchFileFromUrl(tender.techUrl, 'PPT_Nube.pdf') : tender.techFile;
  const tempSummaryFile = !tender.summaryFile && tender.summaryUrl ? await fetchFileFromUrl(tender.summaryUrl, 'Resumen_Nube.pdf') : tender.summaryFile;

  if (tempSummaryFile) filesToProcess.push(tempSummaryFile);
  if (tempAdminFile) filesToProcess.push(tempAdminFile);
  if (tempTechFile) filesToProcess.push(tempTechFile);

  const parts: any[] = [];
  let contextText = `ANALIZA: ${tender.name} (${tender.expedientNumber || 'N/A'})\nREGLAS: ${rules}`;

  parts.push({ text: contextText });

  for (const file of filesToProcess.slice(0, 3)) {
    const part = await fileToPart(file);
    if (part) parts.push(part);
  }

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      decision: { type: Type.STRING, description: "KEEP, DISCARD, or REVIEW" },
      summaryReasoning: { type: Type.STRING },
      economic: { type: Type.OBJECT, properties: { budget: { type: Type.STRING }, model: { type: Type.STRING }, basis: { type: Type.STRING } } },
      scope: { type: Type.OBJECT, properties: { objective: { type: Type.STRING }, deliverables: { type: Type.ARRAY, items: { type: Type.STRING } } } },
      resources: { type: Type.OBJECT, properties: { duration: { type: Type.STRING }, team: { type: Type.STRING }, dedication: { type: Type.STRING } } },
      solvency: { type: Type.OBJECT, properties: { certifications: { type: Type.STRING }, specificSolvency: { type: Type.STRING }, penalties: { type: Type.STRING } } },
      strategy: { type: Type.OBJECT, properties: { valuationCriteria: { type: Type.STRING }, angle: { type: Type.STRING } } },
      scoring: { type: Type.OBJECT, properties: { priceWeight: { type: Type.NUMBER }, formulaWeight: { type: Type.NUMBER }, valueWeight: { type: Type.NUMBER }, details: { type: Type.STRING }, subCriteria: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, weight: { type: Type.NUMBER }, category: { type: Type.STRING } } } } } }
    },
    required: ["decision", "summaryReasoning", "economic", "scope", "resources", "solvency", "strategy", "scoring"],
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-exp',
    contents: { parts },
    config: { 
      systemInstruction: buildAnalysisSystemPrompt(rules), 
      responseMimeType: "application/json", 
      responseSchema: responseSchema,
      // tools: [{ googleSearch: {} }] 
    },
  });

  const result = parseAiJson(response.text || "{}");
  
  if (tempAdminFile) tender.adminFile = tempAdminFile;
  if (tempTechFile) tender.techFile = tempTechFile;
  if (tempSummaryFile) tender.summaryFile = tempSummaryFile;

  return result;
};

export const extractMetadataFromTenderFile = async (file: File): Promise<any> => {
  const ai = getAiClient();
  const filePart = await fileToPart(file);
  const prompt = `Analiza este documento de licitación (Hoja Resumen). Extrae los metadatos y BUSCA ACTIVAMENTE enlaces (URLs) que apunten a los pliegos.
  IMPORTANTE SOBRE LAS URLs:
  - Deben ser ABSOLUTAS (empezar por http:// o https://).
  - Si encuentras una ruta relativa (ej: /wps/...), añadele delante "https://contrataciondelestado.es".
  - adminUrl: Enlace al PCAP (Cláusulas Administrativas).
  - techUrl: Enlace al PPT (Prescripciones Técnicas).`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: { 
      name: { type: Type.STRING }, 
      budget: { type: Type.STRING }, 
      expedientNumber: { type: Type.STRING }, 
      deadline: { type: Type.STRING }, 
      tenderPageUrl: { type: Type.STRING }, 
      scoringSystem: { type: Type.STRING },
      adminUrl: { type: Type.STRING, description: "URL ABSOLUTA al documento PCAP" },
      techUrl: { type: Type.STRING, description: "URL ABSOLUTA al documento PPT" }
    },
    required: ["name", "budget", "expedientNumber", "deadline", "scoringSystem"]
  };

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: { parts: [filePart!, { text: prompt }] },
    config: { responseMimeType: "application/json", responseSchema: responseSchema }
  });
  
  const result = parseAiJson(response.text || "{}");

  // Validación extra de seguridad por si la IA falla
  const fixUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith('http')) return url;
    if (url.startsWith('/')) return `https://contrataciondelestado.es${url}`;
    return url;
  };

  if (result.adminUrl) result.adminUrl = fixUrl(result.adminUrl);
  if (result.techUrl) result.techUrl = fixUrl(result.techUrl);

  return result;
};

export const extractLinksFromPdf = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const links: Set<string> = new Set();
    
    for (let i = 1; i <= Math.min(pdfDoc.numPages, 5); i++) {
      const page = await pdfDoc.getPage(i);
      const annotations = await page.getAnnotations();
      
      for (const ant of annotations) {
        if (ant.subtype === 'Link' && ant.url) {
           let url = ant.url;
           // Normalizar URL relativa si es necesario
           if (url.startsWith('/')) {
             url = `https://contrataciondelestado.es${url}`;
           }
           
           // Filtrar solo enlaces relevantes (PDFs o rutas de descarga)
           if (url.toLowerCase().includes('.pdf') || 
               url.includes('contrataciondelestado.es') || 
               url.includes('/wps/wcm/connect/')) {
             links.add(url);
           }
        }
      }
    }
    return Array.from(links);
  } catch (e) { 
    console.error("Error extrayendo enlaces del PDF:", e);
    return []; 
  }
};

export const probeLinksInBatches = async (links: string[]): Promise<any> => {
  if (links.length === 0) return {};
  const ai = getAiClient();
  const prompt = `Identifica PCAP y PPT: ${links.join(', ')}`;
  const responseSchema = {
    type: Type.OBJECT,
    properties: { adminUrl: { type: Type.STRING }, techUrl: { type: Type.STRING } },
    required: ["adminUrl", "techUrl"]
  };
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: responseSchema },
  });
  return parseAiJson(response.text || "{}");
};

export const scrapeDocsFromWeb = async (pageUrl: string): Promise<any> => {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: `Busca PCAP y PPT en: ${pageUrl}.`,
    config: { responseMimeType: "application/json" },
  });
  return parseAiJson(response.text || "{}");
};
