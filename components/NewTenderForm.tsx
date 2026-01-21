
import React, { useState, useCallback } from 'react';
import { Plus, Upload, Link as LinkIcon, FileText, X, Loader2, FileCheck, Trash2, Globe, Euro, BarChart3, Fingerprint, CalendarDays, ShieldAlert } from 'lucide-react';
import { TenderDocument, TenderStatus } from '../types';
import { extractMetadataFromTenderFile, scrapeDocsFromWeb, extractLinksFromPdf, probeLinksInBatches } from '../services/geminiService';

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
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [techFile, setTechFile] = useState<File | null>(null);
  const [summaryFile, setSummaryFile] = useState<File | null>(null);

  const [isExtracting, setIsExtracting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [duplicateError, setDuplicateError] = useState(false);
  
  const [dragActive, setDragActive] = useState<{summary: boolean, admin: boolean, tech: boolean}>({
    summary: false, admin: false, tech: false
  });

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDuplicateError(false);

    if (!name) return;

    const normalizedNewExpedient = (expedientNumber || '').trim().toLowerCase();
    const normalizedNewName = (name || '').trim().toLowerCase();

    const isDuplicate = tenders.some(t => {
       const existingExpedient = (t.expedientNumber || '').trim().toLowerCase();
       const existingName = (t.name || '').trim().toLowerCase();
       return existingExpedient === normalizedNewExpedient && existingName === normalizedNewName;
    });

    if (isDuplicate) {
       setDuplicateError(true);
       return;
    }

    const newTender: TenderDocument = {
      id: crypto.randomUUID(),
      name,
      budget,
      scoringSystem,
      expedientNumber,
      deadline,
      tenderPageUrl,
      adminUrl: "",
      adminFile,
      techUrl: "",
      techFile,
      summaryFile,
      status: TenderStatus.PENDING,
      createdAt: Date.now(),
    };

    onAddTender(newTender);
    resetForm();
    setIsOpen(false);
  };

  const resetForm = () => {
    setName('');
    setBudget('');
    setScoringSystem('');
    setExpedientNumber('');
    setDeadline('');
    setTenderPageUrl('');
    setAdminFile(null);
    setTechFile(null);
    setSummaryFile(null);
    setLogs([]);
    setDuplicateError(false);
  };

  const handleManualScrape = async () => {
    if (!tenderPageUrl) return;
    setIsExtracting(true);
    setLogs(["> Iniciando escaneo manual..."]);
    
    try {
      addLog("> Buscando documentos en la web...");
      const scrapeResult = await scrapeDocsFromWeb(tenderPageUrl);
      
      let candidates: string[] = scrapeResult.candidates || [];
      if (scrapeResult.adminUrl) candidates.push(scrapeResult.adminUrl);
      if (scrapeResult.techUrl) candidates.push(scrapeResult.techUrl);
      
      if (candidates.length > 0) {
         addLog(`> Encontrados ${candidates.length} enlaces. Sondeando...`);
         const results = await probeLinksInBatches(candidates);
         
         if (results.admin) { setAdminFile(results.admin); addLog("  [OK] PCAP descargado"); }
         if (results.tech) { setTechFile(results.tech); addLog("  [OK] PPT descargado"); }
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFile = async (file: File, type: 'summary' | 'admin' | 'tech') => {
    if (type === 'summary') {
      setSummaryFile(file);
      setIsExtracting(true);
      setLogs(["> Iniciando motor de análisis..."]);
      
      try {
        const metadataPromise = extractMetadataFromTenderFile(file).then(data => {
            if (data.name) setName(data.name);
            if (data.budget) setBudget(data.budget);
            if (data.scoringSystem) setScoringSystem(data.scoringSystem);
            if (data.expedientNumber) setExpedientNumber(data.expedientNumber);
            if (data.deadline) setDeadline(data.deadline);
            addLog(`> Metadatos extraídos`);
            return data;
        });

        const linksPromise = extractLinksFromPdf(file).then(links => {
            addLog(`> PDF escaneado: ${links.length} enlaces`);
            return links;
        });

        const [data, internalLinks] = await Promise.all([metadataPromise, linksPromise]);
        
        let allCandidates = new Set<string>();
        internalLinks.forEach((l: string) => allCandidates.add(l));
        if (data.allLinks) data.allLinks.forEach((l: string) => allCandidates.add(l));
        if (data.adminUrl) allCandidates.add(data.adminUrl);
        if (data.techUrl) allCandidates.add(data.techUrl);
        
        let currentUrl = data.tenderPageUrl;
        if (!currentUrl) {
           for (const link of internalLinks) {
             if (link.toLowerCase().includes('contratacion') || link.toLowerCase().includes('placsp')) {
               currentUrl = link;
               break;
             }
           }
        }
        
        if (currentUrl) {
           setTenderPageUrl(currentUrl);
           if (allCandidates.size < 2) {
              const webDocs = await scrapeDocsFromWeb(currentUrl);
              webDocs.candidates.forEach((c: string) => allCandidates.add(c));
           }
        }

        const uniqueList = Array.from(allCandidates);
        if (uniqueList.length > 0) {
           const results = await probeLinksInBatches(uniqueList);
           if (results.admin) setAdminFile(results.admin);
           if (results.tech) setTechFile(results.tech);
        }
        addLog("> Proceso completado.");
      } catch (err: any) {
        addLog("  [ERROR] " + err.message);
      } finally {
        setIsExtracting(false);
      }
    } else {
      type === 'admin' ? setAdminFile(file) : setTechFile(file);
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

  const UploadZone = ({ type, file, label }: { type: 'summary' | 'admin' | 'tech', file: File | null, label: string }) => {
    const isActive = dragActive[type];
    if (file) {
      return (
        <div className="bg-neutral-900 border border-lime-500/30 rounded-xl p-3 shadow-lg flex items-center gap-3">
           <div className="p-2 bg-neutral-800 rounded-lg text-lime-400 border border-white/5 shrink-0">
               {type === 'summary' ? <FileText size={18} /> : <FileCheck size={18} />}
           </div>
           <div className="min-w-0 flex-1">
               <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">{label}</p>
               <p className="text-xs font-medium text-white truncate">{file.name}</p>
           </div>
           <button type="button" onClick={() => type === 'summary' ? setSummaryFile(null) : type === 'admin' ? setAdminFile(null) : setTechFile(null)} className="text-neutral-500 hover:text-red-400 p-1">
             <Trash2 size={16} />
           </button>
        </div>
      );
    }
    return (
      <div 
        className={`relative border border-dashed rounded-xl transition-all h-20 flex flex-col items-center justify-center cursor-pointer ${isActive ? 'border-lime-500 bg-lime-500/10' : 'border-neutral-700 bg-neutral-900/30 hover:border-neutral-500'}`}
        onDragEnter={(e) => handleDrag(e, type)} onDragOver={(e) => handleDrag(e, type)} onDragLeave={(e) => handleDrag(e, type)} onDrop={(e) => handleDrop(e, type)}
      >
        <input type="file" accept={type === 'summary' ? ".pdf,.jpg,.png" : ".pdf"} onChange={(e) => e.target.files && handleFile(e.target.files[0], type)} className="absolute inset-0 opacity-0 cursor-pointer" />
        <Upload size={18} className="text-neutral-500 mb-1" />
        <p className="text-[9px] font-bold text-neutral-400 uppercase">{label}</p>
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="w-full py-5 border border-dashed border-neutral-700 bg-neutral-900/50 rounded-xl flex items-center justify-center gap-3 text-neutral-400 hover:border-lime-500/50 hover:text-lime-400 hover:bg-lime-500/5 transition-all group duration-300">
        <div className="bg-neutral-800 p-2 rounded-full group-hover:bg-lime-500 group-hover:text-black transition-all"><Plus size={20} /></div>
        <span className="font-bold text-base tracking-tight">Nuevo Expediente</span>
      </button>
    );
  }

  return (
    <div className="bg-neutral-900 rounded-2xl shadow-2xl border border-white/10 p-5 animate-in fade-in zoom-in-95 duration-300 relative overflow-hidden flex flex-col max-h-[90vh]">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-bold text-white tracking-tight">Nuevo Expediente</h3>
        <button onClick={() => { setIsOpen(false); resetForm(); }} className="text-neutral-500 hover:text-white p-1 hover:bg-neutral-800 rounded-full transition-colors"><X size={20} /></button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1 scrollbar-hide">
        <UploadZone type="summary" file={summaryFile} label="Hoja Resumen" />
        {(isExtracting || logs.length > 0) && (
           <div className="bg-black rounded-lg p-3 font-mono text-[9px] text-lime-500 border border-white/10 h-24 overflow-y-auto flex flex-col-reverse">
              {isExtracting && <div className="animate-pulse flex items-center gap-2"><Loader2 size={10} className="animate-spin"/> Procesando...</div>}
              {logs.slice().reverse().map((log, i) => <div key={i}>{log}</div>)}
           </div>
        )}

        {duplicateError && (
           <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex items-center gap-3 text-red-200 animate-in slide-in-from-top-2">
              <ShieldAlert size={18} className="text-red-500 shrink-0" />
              <p className="text-[11px] font-bold leading-tight">
                 ¡ERROR! Este expediente ya está registrado (Mismo Nº Expediente y Título).
              </p>
           </div>
        )}

        <div className="space-y-3 pt-2 border-t border-white/5">
          <input required value={name} onChange={(e) => { setName(e.target.value); setDuplicateError(false); }} className={`w-full px-3 py-2 bg-neutral-800 border ${duplicateError ? 'border-red-500/50' : 'border-neutral-700'} rounded-lg text-xs text-white placeholder:text-neutral-600`} placeholder="Título del expediente" />
          
          <div className="grid grid-cols-2 gap-3">
             <div className="relative">
                <Euro className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
                <input value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full pl-8 px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white" placeholder="Presupuesto" />
             </div>
             <div className="relative">
                <Fingerprint className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
                <input value={expedientNumber} onChange={(e) => { setExpedientNumber(e.target.value); setDuplicateError(false); }} className={`w-full pl-8 px-2 py-2 bg-neutral-800 border ${duplicateError ? 'border-red-500/50' : 'border-neutral-700'} rounded-lg text-[11px] text-white`} placeholder="Nº Expediente" />
             </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
             <div className="relative">
                <CalendarDays className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
                <input type="text" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full pl-8 px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white" placeholder="Fecha Límite (YYYY-MM-DD)" />
             </div>
             <div className="relative">
                <BarChart3 className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
                <input value={scoringSystem} onChange={(e) => setScoringSystem(e.target.value)} className="w-full pl-8 px-2 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white" placeholder="Criterios" />
             </div>
          </div>

          <div className="relative">
            <LinkIcon className="absolute left-2.5 top-2.5 text-neutral-500" size={12} />
            <input value={tenderPageUrl} onChange={(e) => setTenderPageUrl(e.target.value)} className="w-full pl-8 pr-8 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] text-white" placeholder="URL Plataforma" />
            {tenderPageUrl && <button type="button" onClick={handleManualScrape} className="absolute right-1 top-1 p-1 bg-neutral-700 rounded hover:text-lime-400"><Globe size={14} /></button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
           <UploadZone type="admin" file={adminFile} label="PCAP" />
           <UploadZone type="tech" file={techFile} label="PPT" />
        </div>

        <button type="submit" disabled={duplicateError} className={`w-full ${duplicateError ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-lime-400 hover:bg-lime-300 text-black shadow-[0_0_15px_rgba(163,230,53,0.3)]'} font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2`}>
          <Plus size={18} strokeWidth={2.5} />
          <span>Crear Expediente</span>
        </button>
      </form>
    </div>
  );
};

export default NewTenderForm;
