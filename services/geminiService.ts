
import { GoogleGenAI, Type } from "@google/genai";
import { TenderDocument, AnalysisResult } from "../types";
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined' && 'Worker' in window) {
  // @ts-ignore
  const version = pdfjsLib.version || (pdfjsLib.default && pdfjsLib.default.version) || '4.0.379';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key no configurada.");
  return new GoogleGenAI({ apiKey });
};

export const fetchFileFromUrl = async (url: string): Promise<File | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const fileName = url.split('/').pop() || 'document.pdf';
    return new File([blob], fileName, { type: blob.type });
  } catch (e) {
    console.error("Error fetching file from URL:", url);
    return null;
  }
};

const fileToPart = async (file: File): Promise<{ inlineData?: { data: string; mimeType: string }; text?: string } | null> => {
  const supportedInlineTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

  if (supportedInlineTypes.includes(file.type)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve({ inlineData: { data: reader.result.split(',')[1], mimeType: file.type } });
        } else reject(new Error("Failed base64"));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else if (file.type.includes('text') || file.type.includes('json') || file.name.endsWith('.xml')) {
    const textContent = await file.text();
    return { text: `Archivo ${file.name}:\n${textContent.substring(0, 30000)}` };
  }
  return null;
};

export const analyzeTenderWithGemini = async (tender: TenderDocument, rules: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const parts: any[] = [{ text: `Expediente: ${tender.name}\nNº: ${tender.expedientNumber}\nPresupuesto: ${tender.budget}` }];
  
  const filesToProcess: File[] = [];
  
  if (tender.summaryFile) filesToProcess.push(tender.summaryFile);
  else if (tender.summaryUrl) {
    const f = await fetchFileFromUrl(tender.summaryUrl);
    if (f) filesToProcess.push(f);
  }

  if (tender.adminFile) filesToProcess.push(tender.adminFile);
  else if (tender.adminUrl && tender.adminUrl.startsWith('http')) {
    const f = await fetchFileFromUrl(tender.adminUrl);
    if (f) filesToProcess.push(f);
  }

  if (tender.techFile) filesToProcess.push(tender.techFile);
  else if (tender.techUrl && tender.techUrl.startsWith('http')) {
    const f = await fetchFileFromUrl(tender.techUrl);
    if (f) filesToProcess.push(f);
  }

  for (const file of filesToProcess) {
    const part = await fileToPart(file);
    if (part) parts.push(part);
  }

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      decision: { type: Type.STRING, enum: ["KEEP", "DISCARD", "REVIEW"] },
      summaryReasoning: { type: Type.STRING },
      economic: { type: Type.OBJECT, properties: { budget: { type: Type.STRING }, model: { type: Type.STRING }, basis: { type: Type.STRING } } },
      scope: { type: Type.OBJECT, properties: { objective: { type: Type.STRING }, deliverables: { type: Type.ARRAY, items: { type: Type.STRING } } } },
      resources: { type: Type.OBJECT, properties: { duration: { type: Type.STRING }, team: { type: Type.STRING }, dedication: { type: Type.STRING } } },
      solvency: { type: Type.OBJECT, properties: { certifications: { type: Type.STRING }, specificSolvency: { type: Type.STRING }, penalties: { type: Type.STRING } } },
      strategy: { type: Type.OBJECT, properties: { valuationCriteria: { type: Type.STRING }, angle: { type: Type.STRING } } },
      scoring: { type: Type.OBJECT, properties: { priceWeight: { type: Type.NUMBER }, formulaWeight: { type: Type.NUMBER }, valueWeight: { type: Type.NUMBER }, details: { type: Type.STRING }, subCriteria: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, weight: { type: Type.NUMBER }, category: { type: Type.STRING, enum: ["PRICE", "FORMULA", "VALUE"] } } } } } },
      registrationChecklist: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { task: { type: Type.STRING }, description: { type: Type.STRING }, completed: { type: Type.BOOLEAN } } } }
    },
    required: ["decision", "summaryReasoning", "economic", "scope", "resources", "solvency", "strategy", "scoring", "registrationChecklist"],
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: { parts },
    config: { 
      systemInstruction: buildAnalysisSystemPrompt(rules), 
      responseMimeType: "application/json", 
      responseSchema: responseSchema,
    },
  });

  return JSON.parse(response.text || "{}");
};

export const buildAnalysisSystemPrompt = (rules: string) => `
Actúa como un Bid Manager Senior. Analiza los pliegos adjuntos basándote en estas REGLAS DE NEGOCIO: ${rules}. 
Tu objetivo es decidir Go/No-Go. Redacta todo en IDIOMA ESPAÑOL.
Extrae detalles económicos, alcance, recursos necesarios, requisitos de solvencia y el modelo de puntuación detallado.
Responde estrictamente en JSON.
`;

export const classifyFile = (file: File, url: string = ""): 'ADMIN' | 'TECH' | 'UNKNOWN' => {
  const combinedText = (file.name + " " + url).toLowerCase();
  if (combinedText.includes('pcap') || combinedText.includes('admin') || combinedText.includes('clausula')) return 'ADMIN';
  if (combinedText.includes('ppt') || combinedText.includes('tecnic') || combinedText.includes('memoria')) return 'TECH';
  return 'UNKNOWN';
};

export const extractMetadataFromTenderFile = async (file: File): Promise<any> => {
  const ai = getAiClient();
  const filePart = await fileToPart(file);
  const prompt = `Analiza este documento y extrae: name, budget, scoringSystem, expedientNumber, deadline (YYYY-MM-DD), tenderPageUrl, adminUrl, techUrl. Idioma: Español. Responde JSON.`;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: { parts: [filePart!, { text: prompt }] },
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text || "{}");
};

export const extractLinksFromPdf = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const pdfjs = pdfjsLib.getDocument ? pdfjsLib : pdfjsLib.default;
    const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const links: Set<string> = new Set();
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const annotations = await page.getAnnotations();
      for (const ant of annotations) if (ant.subtype === 'Link' && ant.url) links.add(ant.url);
    }
    return Array.from(links);
  } catch (e) { return []; }
};

export const scrapeDocsFromWeb = async (_pageUrl: string): Promise<any> => ({ candidates: [] });
export const probeLinksInBatches = async (_links: string[]): Promise<any> => ({});
