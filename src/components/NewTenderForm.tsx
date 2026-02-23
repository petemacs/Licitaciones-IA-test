
import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Upload, Link as LinkIcon, FileText, X, Loader2, FileCheck, Trash2, Globe, Euro, Fingerprint, CheckCircle2, ExternalLink } from 'lucide-react';
import { TenderDocument, TenderStatus } from '../types';
import { extractMetadataFromTenderFile, scrapeDocsFromWeb, extractLinksFromPdf, probeLinksInBatches, fetchFileFromUrl } from '../services/geminiService';

interface Props {
  onAddTender: (tender: TenderDocument) => void;
  tenders: TenderDocument[];
}

const NewTenderForm: React.FC<Props> = ({ onAddTender, tenders }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [scoringSystem, setScoringSystem] = useState('');
  const [expedientNumber, setExpedientNumber] = useState('');
  const [deadline, setDeadline] = useState('');
  const [tenderPageUrl, setTenderPageUrl] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [techUrl, setTechUrl] = useState('');
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [techFile, setTechFile] = useState<File | null>(null);
  const [summaryFile, setSummaryFile] = useState<File | null>(null);

  const [isExtracting, setIsExtracting] = useState(false);
  const [isDownloading, setIsDownloading] = useState<{admin: boolean, tech: boolean}>({ admin: false, tech: false });
  const [logs, setLogs] = useState<string[]>([]);
  const [duplicateError, setDuplicateError] = useState(false);
  
  const [dragActive, setDragActive] = useState<{summary: boolean, admin: boolean, tech: boolean}>({
    summary: false, admin: false, tech: false
  });

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // FUNCIÓN CRÍTICA: Captura el archivo binario del enlace y lo inyecta como FILE
  const runAutoCapture = async (url: string, type: 'admin' | 'tech') => {
    if (!url || !url.startsWith('http')) return;
    
    setIsDownloading(prev => ({ ...prev, [type]: true }));
    addLog(`> Iniciando captura de PDF FÍSICO (${type.toUpperCase()})...`);
    
    try {
      const file = await fetchFileFromUrl(url, type === 'admin' ? 'PCAP_Capturado.pdf' : 'PPT_Capturado.pdf');
      if (file) {
        if (type === 'admin') setAdminFile(file);
        else setTechFile(file);
        addLog(`> [ÉXITO] ${type.toUpperCase()} descargado y adjunto automáticamente.`);
      } else {
        addLog(`> [AVISO] Servidor bloqueado. Se usará búsqueda web para este documento.`);
      }
    } catch (e) {
      addLog(`> [ERROR] No se pudo descargar el binario de ${type.toUpperCase()}.`);
    } finally {
      setIsDownloading(prev => ({ ...prev, [type]: false }));
    }
  };

  // Vigilantes de URLs para disparar descargas proactivas
  useEffect(() => {
    if (adminUrl && !adminFile && !isDownloading.admin) runAutoCapture(adminUrl, 'admin');
  }, [adminUrl, adminFile]);

  useEffect(() => {
    if (techUrl && !techFile && !isDownloading.tech) runAutoCapture(techUrl, 'tech');
  }, [techUrl, techFile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    const normalizedNewExpedient = (expedientNumber || '').trim().toLowerCase();
    const isDuplicate = tenders.some(t => t.expedientNumber && t.expedientNumber.trim().toLowerCase() === normalizedNewExpedient && normalizedNewExpedient !== '');

    if (isDuplicate) {
       setDuplicateError(true);
       return;
    }

    onAddTender({
      id: crypto.randomUUID(),
      name, budget, scoringSystem, expedientNumber, deadline,
      tenderPageUrl, adminUrl, adminFile, techUrl, techFile, summaryFile,
      status: TenderStatus.PENDING,
      createdAt: Date.now(),
    });
    resetForm();
    setIsOpen(false);
  };

  const resetForm = () => {
    setName(''); setBudget(''); setScoringSystem(''); setExpedientNumber(''); setDeadline('');
    setTenderPageUrl(''); setAdminUrl(''); setTechUrl('');
    setAdminFile(null); setTechFile(null); setSummaryFile(null);
    setLogs([]); setDuplicateError(false);
  };

  const handleManualScrape = async () => {
    if (!tenderPageUrl) return;
    setIsExtracting(true);
    addLog("> Escaneando plataforma de contratación...");
    try {
      const res = await scrapeDocsFromWeb(tenderPageUrl);
      if (res.adminUrl) setAdminUrl(res.adminUrl);
      if (res.techUrl) setTechUrl(res.techUrl);
      addLog("> Escaneo web finalizado.");
    } catch (err) { addLog("  [!] Error al escanear web."); }
    finally { setIsExtracting(false); }
  };

  const handleFile = async (file: File, type: 'summary' | 'admin' | 'tech') => {
    if (type === 'summary') {
      // Al subir un resumen nuevo, reseteamos detecciones previas
      setAdminUrl(''); setTechUrl(''); setAdminFile(null); setTechFile(null);
      setSummaryFile(file);
      setIsExtracting(true);
      setLogs(["> Leyendo Hoja Resumen..."]);
      try {
        const metadata = await extractMetadataFromTenderFile(file);
        if (metadata.name) setName(metadata.name);
        if (metadata.budget) setBudget(metadata.budget);
        if (metadata.expedientNumber) setExpedientNumber(metadata.expedientNumber);
        if (metadata.deadline) setDeadline(metadata.deadline);
        if (metadata.tenderPageUrl) setTenderPageUrl(metadata.tenderPageUrl);
        if (metadata.scoringSystem) setScoringSystem(metadata.scoringSystem);

        // Si la IA encontró enlaces directos en el texto del PDF, los usamos
        if (metadata.adminUrl) {
          setAdminUrl(metadata.adminUrl);
          addLog(`> Detectado enlace PCAP: ${metadata.adminUrl.substring(0, 30)}...`);
        }
        if (metadata.techUrl) {
          setTechUrl(metadata.techUrl);
          addLog(`> Detectado enlace PPT: ${metadata.techUrl.substring(0, 30)}...`);
        }

        // Mantenemos la lógica anterior por si acaso (aunque extractLinksFromPdf esté vacío por ahora)
        const rawLinks = await extractLinksFromPdf(file);
        if (rawLinks.length > 0) {
          addLog(`> Detectados ${rawLinks.length} enlaces. Identificando pliegos...`);
          const probe = await probeLinksInBatches(rawLinks);
          if (probe.adminUrl) setAdminUrl(probe.adminUrl);
          if (probe.techUrl) setTechUrl(probe.techUrl);
        }
        addLog("> Análisis de resumen listo.");
      } catch (err: any) { 
        console.error(err);
        addLog(`  [!] Error: ${err.message || "Error al procesar PDF."}`); 
      }
      finally { setIsExtracting(false); }
    } else {
      if (type === 'admin') setAdminFile(file);
      else if (type === 'tech') setTechFile(file);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent, type: 'summary' | 'admin' | 'tech') => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(prev => ({...prev, [type]: true}));
    else if (e.type === "dragleave") setDragActive(prev => ({...prev, [type]: false}));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, type: 'summary' | 'admin' | 'tech') => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(prev => ({...prev, [type]: false}));
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], type);
  }, []);

  const UploadZone = ({ type, file, url, label }: { type: 'summary' | 'admin' | 'tech', file: File | null, url?: string, label: string }) => {
    const downloading = type !== 'summary' ? isDownloading[type as 'admin' | 'tech'] : false;
    const hasUrlOnly = !file && url && url.length > 0;
    
    if (file || hasUrlOnly || downloading) {
      return (
        <div className={`relative bg-neutral-900 border rounded-xl p-3 shadow-lg flex items-center gap-3 transition-all ${file ? 'border-lime-500/30 bg-lime-500/5' : downloading ? 'border-blue-500/30 animate-pulse bg-blue-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
           {file && <div className="absolute -top-2 -right-2 bg-lime-500 text-black p-0.5 rounded-full shadow-lg border border-black/20"><CheckCircle2 size={12} /></div>}
           <div className={`p-2 rounded-lg border border-white/5 shrink-0 ${file ? 'bg-neutral-800 text-lime-400' : downloading ? 'bg-neutral-800 text-blue-400' : 'bg-amber-900/20 text-amber-400'}`}>
               {downloading ? <Loader2 size={18} className="animate-spin" /> : (type === 'summary' ? <FileText size={18} /> : (file ? <FileCheck size={18} /> : <LinkIcon size={18} />))}
           </div>
           <div className="min-w-0 flex-1">
               <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">{label}</p>
               <div className="flex flex-col">
                 <p className={`text-xs font-medium truncate ${file ? 'text-white' : 'text-amber-200'}`}>
                   {downloading ? "Capturando binario..." : (file ? file.name : "Enlace detectado")}
                 </p>
                 {hasUrlOnly && !downloading && (
                   <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500 hover:underline truncate flex items-center gap-1 mt-0.5">
                     {url} <ExternalLink size={10} />
                   </a>
                 )}
               </div>
           </div>
           {!downloading && (
             <button type="button" onClick={() => {
               if (type === 'summary') setSummaryFile(null);
               else if (type === 'admin') { setAdminFile(null); setAdminUrl(''); }
               else { setTechFile(null); setTechUrl(''); }
             }} className="text-neutral-500 hover:text-red-400 p-1 transition-colors"><Trash2 size={16} /></button>
           )}
        </div>
      );
    }
    return (
      <div 
        className={`relative border border-dashed rounded-xl transition-all h-20 flex flex-col items-center justify-center cursor-pointer ${dragActive[type] ? 'border-lime-500 bg-lime-500/10' : 'border-neutral-700 bg-neutral-900/30 hover:border-neutral-500'}`}
        onDragEnter={(e) => handleDrag(e, type)} onDragOver={(e) => handleDrag(e, type)} onDragLeave={(e) => handleDrag(e, type)} onDrop={(e) => handleDrop(e, type)}
      >
        <input type="file" accept=".pdf" onChange={(e) => e.target.files && handleFile(e.target.files[0], type)} className="absolute inset-0 opacity-0 cursor-pointer" />
        <Upload size={18} className="text-neutral-500 mb-1" />
        <p className="text-[9px] font-bold text-neutral-400 uppercase">{label}</p>
      </div>
    );
  };

  const isWorking = isExtracting || isDownloading.admin || isDownloading.tech;

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="w-full py-5 border border-dashed border-neutral-700 bg-neutral-900/50 rounded-xl flex items-center justify-center gap-3 text-neutral-400 hover:border-lime-500/50 hover:text-lime-400 hover:bg-lime-500/5 transition-all group duration-300">
        <div className="bg-neutral-800 p-2 rounded-full group-hover:bg-lime-500 group-hover:text-black transition-all shadow-lg"><Plus size={20} /></div>
        <span className="font-bold text-base tracking-tight">Nuevo Expediente</span>
      </button>
    );
  }

  return (
    <div className="bg-neutral-900 rounded-2xl shadow-2xl border border-white/10 p-5 animate-in fade-in zoom-in-95 duration-300 relative overflow-hidden flex flex-col max-h-[90vh]">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Crear Expediente</h3>
          <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-widest">Auto-descarga proactiva activa</p>
        </div>
        <button onClick={() => { setIsOpen(false); resetForm(); }} className="text-neutral-500 hover:text-white p-1 hover:bg-neutral-800 rounded-full transition-colors"><X size={20} /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1 scrollbar-hide">
        <UploadZone type="summary" file={summaryFile} label="Hoja Resumen (PDF)" />
        
        {(isWorking || logs.length > 0) && (
           <div className="bg-black/50 rounded-lg p-3 font-mono text-[9px] text-lime-500 border border-white/10 h-24 overflow-y-auto flex flex-col-reverse shadow-inner">
              {isWorking && <div className="animate-pulse flex items-center gap-2 font-bold"><Loader2 size={10} className="animate-spin"/> CAPTURANDO ARCHIVOS FÍSICOS...</div>}
              {logs.slice().reverse().map((log, i) => <div key={i} className="mb-0.5">{log}</div>)}
           </div>
        )}

        <div className="space-y-3 pt-2 border-t border-white/5">
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white outline-none focus:border-lime-500/50" placeholder="Título" />
          <div className="grid grid-cols-2 gap-3">
             <div className="relative"><Euro className="absolute left-2.5 top-2.5 text-neutral-500" size={12} /><input value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full pl-8 px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white outline-none" placeholder="Importe" /></div>
             <div className="relative"><Fingerprint className="absolute left-2.5 top-2.5 text-neutral-500" size={12} /><input value={expedientNumber} onChange={(e) => setExpedientNumber(e.target.value)} className="w-full pl-8 px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white outline-none" placeholder="Expediente" /></div>
          </div>
          <div className="relative">
            <LinkIcon className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
            <input value={tenderPageUrl} onChange={(e) => setTenderPageUrl(e.target.value)} className="w-full pl-8 pr-10 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white outline-none" placeholder="URL Plataforma Contratación" />
            {tenderPageUrl && <button type="button" onClick={handleManualScrape} disabled={isExtracting} className="absolute right-1 top-1 p-1.5 bg-neutral-700 rounded hover:text-lime-400 transition-colors disabled:opacity-50"><Globe size={14} /></button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
           <UploadZone type="admin" file={adminFile} url={adminUrl} label="P. ADMIN (PCAP)" />
           <UploadZone type="tech" file={techFile} url={techUrl} label="P. TÉCNICO (PPT)" />
        </div>

        <button type="submit" disabled={duplicateError || isWorking} className={`w-full ${duplicateError ? 'bg-red-500/20 text-red-500' : isWorking ? 'bg-neutral-800 text-neutral-600' : 'bg-lime-400 hover:bg-lime-300 text-black'} font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 mt-2 shadow-lg`}>
          {isWorking ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} strokeWidth={2.5} />}
          <span>{isWorking ? 'CAPTURANDO BINARIOS...' : 'Confirmar Expediente'}</span>
        </button>
      </form>
    </div>
  );
};

export default NewTenderForm;
