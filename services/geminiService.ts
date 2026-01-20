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
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("API Key no configurada. Verifica las variables de entorno.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Convierte un archivo a una parte compatible con Gemini.
 * Si el tipo es soportado para multimodal (PDF, Imágenes), usa inlineData.
 * Si es un tipo basado en texto (XML, JSON, Texto), lo lee y lo envía como texto.
 */
const fileToPart = async (file: File): Promise<{ inlineData?: { data: string; mimeType: string }; text?: string } | null> => {
  const supportedInlineTypes = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
  ];

  if (supportedInlineTypes.includes(file.type)) {
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
          reject(new Error("Failed to read file as base64"));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else if (file.type.includes('text') || file.type.includes('xml') || file.type.includes('json') || file.name.endsWith('.xml') || file.name.endsWith('.json')) {
    try {
      const textContent = await file.text();
      return { text: `Contenido del archivo ${file.name}:\n${textContent.substring(0, 50000)}` }; // Cap at 50k chars for safety
    } catch (e) {
      console.warn("Could not read file as text:", file.name);
      return { text: `[Archivo adjunto: ${file.name} (No se pudo leer el texto)]` };
    }
  } else {
    // Para archivos no soportados (ZIP, DOCX), simplemente indicamos su existencia
    return { text: `[Archivo adjunto no procesable directamente: ${file.name} (${file.type})]` };
  }
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
      // Ignoramos HTML y archivos demasiado pequeños que suelen ser errores de redirección
      if (blob.type.includes('text/html') || blob.size < 500) return null;
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
      else if (blob.type.includes("xml")) extension = ".xml";
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
  const parts: any[] = [];
  if (filePart) parts.push(filePart);

  const prompt = `
    Analiza este documento de licitación (Hoja Resumen). Extrae los siguientes datos con precisión.
    IMPORTANTE: Toda la información debe ser redactada en IDIOMA ESPAÑOL.
    
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
  parts.push({ text: prompt });

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
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) { 
    console.error("Error in extractMetadata:", error);
    throw error; 
  }
};

export const buildAnalysisSystemPrompt = (rules: string) => {
  return `
    Actúa como un Analista Senior de Licitaciones Públicas (Bid Manager). Analiza los pliegos (PCAP y PPT).
    REGLAS DE NEGOCIO: ${rules}

    Tu objetivo es generar un "Informe Ejecutivo de Viabilidad" para decidir el Go/No-Go. Debes analizar el texto proporcionado y extraer EXCLUSIVAMENTE la siguiente información estructurada. Sé crítico: si falta información, indícalo.
    
    IMPORTANTE: Todo el contenido del informe y cualquier texto generado DEBE estar obligatoriamente en IDIOMA ESPAÑOL.

    DEBES REALIZAR EL ANÁLISIS EN LOS SIGUIENTES 6 APARTADOS OBLIGATORIOS:

    1. ANÁLISIS ECONÓMICO (PRECIO Y COSTES)
    - Presupuesto Base de Licitación (Sin IVA): [Cifra exacta]
    - Modelo de Precio: ¿Es a tanto alzado (precio cerrado total) o precios unitarios (pago por uso/hora)?
    - Base del Cálculo: ¿Qué incluye el precio? (Ej: ¿Incluye dietas, desplazamientos, licencias de software, repuestos?). Extrae cualquier detalle que afecte al cálculo de costes directos.

    2. ALCANCE DEL SERVICIO (QUÉ HAY QUE HACER)
    - Resumen del Objeto: Explica en 2-3 frases sencillas qué trabajo físico o intelectual hay que entregar. Evita la jerga legal.
    - Entregables Clave: Lista los productos/informes/servicios principales que se esperan.

    3. RECURSOS Y CRONOGRAMA
    - Duración: [Meses/Años] + [Posibles Prórrogas].
    - Equipo Mínimo Exigido (Adscripción de Medios): Lista los perfiles obligatorios, titulaciones requeridas y años de experiencia mínimos especificados.
    - Dedicación: ¿Se exige dedicación exclusiva o presencialidad en las oficinas del cliente?

    4. REQUISITOS BLOQUEANTES Y SOLVENCIA (CRÍTICO)
    - Certificaciones: ¿Se exige ISO 9001, 14001, ENS (Esquema Nacional de Seguridad) o alguna clasificación empresarial específica (Grupo/Subgrupo)?
    - Solvencia Técnica Específica: ¿Piden haber realizado proyectos idénticos por un importe concreto en los últimos 3 años? (Detalla la cifra o el número de trabajos).
    - Penalidades: ¿Hay alguna cláusula de penalización inusual o muy agresiva que deba conocer?

    5. ENFOQUE ESTRATÉGICO SUGERIDO
    - Criterios de Valoración: Resume rápido: ¿Gana el más barato (Subasta) o importa la calidad? (Ej: 60% Precio / 40% Técnico).
    - Ángulo de Ataque: Basado en lo anterior, ¿cómo deberíamos plantear la propuesta? (Ej: "Centrarse en automatizar para bajar precio" o "Destacar la metodología para ganar los puntos subjetivos").

    6. PUNTUACIÓN
    - Pon el modelo de puntuación y revisa que piden en cada apartado de puntuación.

    DECISIÓN FINAL: KEEP, DISCARD, REVIEW.
    Responde estrictamente en JSON.
  `;
};

export const analyzeTenderWithGemini = async (tender: TenderDocument, rules: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const parts: any[] = [{ text: `Expediente: ${tender.name}\nPresupuesto: ${tender.budget}\nCriterios: ${tender.scoringSystem}` }];
  
  if (tender.summaryFile) {
    const part = await fileToPart(tender.summaryFile);
    if (part) parts.push(part);
  }
  if (tender.adminFile) {
    const part = await fileToPart(tender.adminFile);
    if (part) parts.push(part);
  }
  if (tender.techFile) {
    const part = await fileToPart(tender.techFile);
    if (part) parts.push(part);
  }

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      decision: { type: Type.STRING, enum: ["KEEP", "DISCARD", "REVIEW"] },
      summaryReasoning: { type: Type.STRING },
      economic: { type: Type.OBJECT, properties: { budget: { type: Type.STRING }, model: { type: Type.STRING }, basis: { type: Type.STRING } } },
      scope: { type: Type.OBJECT, properties: { objective: { type: Type.STRING }, deliverables: { type: Type.ARRAY, items: { type: Type.STRING } } } },
      resources: { type: Type.OBJECT, properties: { duration: { type: Type.STRING }, team: { type: Type.STRING }, dedication: { type: Type.STRING } } },
      solvency: { type: Type.OBJECT, properties: { certifications: { type: Type.STRING }, specificSolvency: { type: Type.STRING }, penalties: { type: Type.STRING } } },
      strategy: { type: Type.OBJECT, properties: { valuationCriteria: { type: Type.STRING }, angle: { type: Type.STRING } } },
      scoring: { type: Type.OBJECT, properties: { priceWeight: { type: Type.NUMBER }, formulaWeight: { type: Type.NUMBER }, valueWeight: { type: Type.NUMBER }, details: { type: Type.STRING }, subCriteria: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, weight: { type: Type.NUMBER }, category: { type: Type.STRING, enum: ["PRICE", "FORMULA", "VALUE"] } } } } }, required: ["priceWeight", "formulaWeight", "valueWeight", "details", "subCriteria"] },
      registrationChecklist: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { task: { type: Type.STRING }, description: { type: Type.STRING }, completed: { type: Type.BOOLEAN } } } }
    },
    required: ["decision", "summaryReasoning", "economic", "scope", "resources", "solvency", "strategy", "scoring", "registrationChecklist"],
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: parts }],
      config: { 
        systemInstruction: buildAnalysisSystemPrompt(rules), 
        responseMimeType: "application/json", 
        responseSchema: responseSchema,
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};