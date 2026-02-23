
import React, { useState, useRef, useEffect } from 'react';
import { X, Calendar, Euro, FileText, BarChart3, Download, FileSpreadsheet, FileCode, File, Sparkles, ChevronDown, Archive, XCircle, HelpCircle, ArrowRightCircle, Clock, Target, ShieldAlert, Lightbulb, Eye, Upload, Loader2 } from 'lucide-react';
import { TenderDocument, TenderStatus } from '../types';

interface Props {
  tender: TenderDocument;
  onClose: () => void;
  onStatusChange: (id: string, status: TenderStatus) => void;
  onUpdateTender?: (tender: TenderDocument) => void;
  onAnalyze?: (tender: TenderDocument) => void;
  isAnalyzing?: boolean;
}

const TenderDetailView: React.FC<Props> = ({ tender, onClose, onStatusChange, onUpdateTender, onAnalyze, isAnalyzing }) => {
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileType, setPendingFileType] = useState<'ADMIN' | 'TECH' | 'SUMMARY' | null>(null);

  const analysis = tender.aiAnalysis;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setIsStatusOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownloadFile = (file: File | null, url: string) => {
    if (file) {
      const blobUrl = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } else if (url && url.startsWith('http')) {
      window.open(url, '_blank');
    }
  };

  const handleManualUpload = (type: 'ADMIN' | 'TECH' | 'SUMMARY') => {
    setPendingFileType(type);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingFileType && onUpdateTender) {
      const updatedTender = { ...tender };
      if (pendingFileType === 'ADMIN') { updatedTender.adminFile = file; updatedTender.adminUrl = ''; }
      if (pendingFileType === 'TECH') { updatedTender.techFile = file; updatedTender.techUrl = ''; }
      if (pendingFileType === 'SUMMARY') { updatedTender.summaryFile = file; updatedTender.summaryUrl = ''; }
      onUpdateTender(updatedTender);
    }
    setPendingFileType(null);
    if (e.target) e.target.value = '';
  };

  const DocItem = ({ label, file, url, type }: { label: string, file: File | null, url: string, type: 'ADMIN' | 'TECH' | 'SUMMARY' }) => {
    let Icon = File;
    let color = "text-neutral-400";
    let bgColor = "bg-neutral-800";

    if (type === 'ADMIN') { Icon = FileSpreadsheet; color = "text-amber-400"; bgColor = "bg-amber-500/10"; }
    if (type === 'TECH') { Icon = FileCode; color = "text-indigo-400"; bgColor = "bg-indigo-500/10"; }
    if (type === 'SUMMARY') { Icon = FileText; color = "text-blue-400"; bgColor = "bg-blue-500/10"; }
    
    const hasFile = !!file;
    const hasUrl = !!url && url.startsWith('http');
    const displayText = hasFile ? file.name : (hasUrl ? "PDF en Nube" : "Pendiente");

    const handleOpen = (e: React.MouseEvent) => {
      e.preventDefault();
      if (file) {
        console.log(`Abriendo archivo local: ${file.name}, Tipo: ${file.type}, Tamaño: ${file.size}`);
        const blobUrl = URL.createObjectURL(file);
        window.open(blobUrl, '_blank');
        // Nota: No revocamos inmediatamente para permitir que se abra
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); 
      } else if (url) {
        console.log(`Abriendo URL remota: ${url}`);
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert("No hay documento disponible para visualizar.");
      }
    };

    return (
      <div className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${hasFile || hasUrl ? 'bg-neutral-900 border-white/5 shadow-sm' : 'bg-neutral-900/40 border-dashed border-white/5 opacity-60'}`}>
         <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-xl border border-white/5 ${(hasFile || hasUrl) ? `${bgColor} ${color}` : 'bg-neutral-800 text-neutral-600'}`}>
               <Icon size={20} />
            </div>
            <div className="min-w-0">
               <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">{label}</p>
               <p className={`text-sm font-medium truncate ${(hasFile || hasUrl) ? 'text-neutral-200' : 'text-neutral-500'}`} title={displayText}>
                 {displayText}
               </p>
            </div>
         </div>
         <div className="flex items-center gap-1">
             {(hasFile || hasUrl) ? (
               <>
                 <button onClick={handleOpen} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors" title="Ver documento"><Eye size={18} /></button>
                 <button onClick={() => handleDownloadFile(file, url)} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-lime-400 transition-colors" title="Descargar"><Download size={18} /></button>
               </>
             ) : (
               <button onClick={() => handleManualUpload(type)} className="p-2 bg-lime-400/10 hover:bg-lime-400/20 rounded-lg text-lime-400 transition-all border border-lime-400/20" title="Subir documento"><Upload size={18} /></button>
             )}
         </div>
      </div>
    );
  };

  const StatusSelector = () => {
    const statusConfig = {
      [TenderStatus.PENDING]: { label: 'PENDIENTE', color: 'text-neutral-400', bg: 'bg-neutral-800/50', border: 'border-neutral-700', icon: Clock },
      [TenderStatus.IN_PROGRESS]: { label: 'EN TRAMITE', color: 'text-lime-400', bg: 'bg-lime-400/10', border: 'border-lime-500/30', icon: ArrowRightCircle },
      [TenderStatus.IN_DOUBT]: { label: 'EN DUDA', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-500/30', icon: HelpCircle },
      [TenderStatus.REJECTED]: { label: 'DESCARTADO', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-500/30', icon: XCircle },
      [TenderStatus.ARCHIVED]: { label: 'ARCHIVADO', color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-500/30', icon: Archive },
    };
    const current = statusConfig[tender.status];
    const Icon = current.icon;
    return (
      <div className="relative" ref={statusRef}>
        <button onClick={() => setIsStatusOpen(!isStatusOpen)} className={`flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${current.color} ${current.bg} ${current.border} hover:brightness-125`}>
           <Icon size={14} /> <span>{current.label}</span> <ChevronDown size={12} className={`ml-1 transition-transform ${isStatusOpen ? 'rotate-180' : ''}`} />
        </button>
        {isStatusOpen && (
          <div className="absolute top-full left-0 mt-2 w-48 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl p-1 z-[60] animate-in fade-in zoom-in-95 duration-200">
             {Object.keys(statusConfig).map((key) => (
                <button key={key} onClick={() => { onStatusChange(tender.id, key as TenderStatus); setIsStatusOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 text-[11px] font-bold transition-colors text-left rounded-lg ${key === tender.status ? 'bg-white/5 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}>
                   {React.createElement(statusConfig[key as TenderStatus].icon, { size: 14, className: statusConfig[key as TenderStatus].color })} {statusConfig[key as TenderStatus].label}
                </button>
             ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".pdf" className="hidden" />
      <div className="w-full max-w-4xl h-full bg-neutral-950 border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/5 bg-neutral-900/50">
          <div className="flex-1 pr-8">
             <div className="flex items-center gap-4 mb-4">
               <StatusSelector />
               <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-medium">
                 <Calendar size={13} className="text-neutral-600" />
                 <span>{new Date(tender.createdAt).toLocaleDateString()}</span>
               </div>
               {onAnalyze && (
                  <button onClick={() => onAnalyze(tender)} disabled={isAnalyzing} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-lime-400 text-black text-[10px] font-bold hover:bg-lime-300 transition-all disabled:bg-neutral-800 disabled:text-neutral-500">
                    {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {isAnalyzing ? 'ANALIZANDO...' : 'VOLVER A ANALIZAR'}
                  </button>
               )}
             </div>
             <h2 className="text-2xl font-bold text-white leading-tight mb-3">{tender.name}</h2>
             {tender.budget && <div className="inline-flex items-center gap-2 bg-emerald-950/30 border border-emerald-500/20 px-3 py-1.5 rounded-lg text-emerald-400 font-mono font-bold text-sm"><Euro size={16} /> {tender.budget}</div>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 hover:text-white transition-colors"><X size={24} /></button>
        </div>

        {/* Tabs removed, only Analysis view remains */}
        <div className="flex px-8 border-b border-white/5 bg-neutral-900/30">
           <div className="px-6 py-4 text-xs font-bold border-b-2 border-lime-500 text-white">
             ANÁLISIS TÉCNICO
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
               <div className="space-y-6">
                  <div>
                     <h3 className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2 px-1"><FileText size={14} className="text-lime-400"/> DOCUMENTOS</h3>
                     <div className="space-y-3">
                        <DocItem label="Resumen Licitación" type="SUMMARY" file={tender.summaryFile || null} url={tender.summaryUrl || ""} />
                        <DocItem label="P. CLÁUSULAS ADMIN" type="ADMIN" file={tender.adminFile || null} url={tender.adminUrl || ""} />
                        <DocItem label="P. TÉCNICO" type="TECH" file={tender.techFile || null} url={tender.techUrl || ""} />
                     </div>
                  </div>
                  {analysis && (
                    <div className="bg-neutral-900/50 rounded-2xl p-5 border border-white/5">
                       <h3 className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2 px-1"><BarChart3 size={14} className="text-purple-400"/> REPARTO PUNTOS</h3>
                       <div className="h-2.5 w-full bg-neutral-800 rounded-full overflow-hidden flex mb-5 shadow-inner">
                           <div style={{ width: `${analysis.scoring.priceWeight}%` }} className="h-full bg-emerald-500"></div>
                           <div style={{ width: `${analysis.scoring.formulaWeight}%` }} className="h-full bg-blue-500"></div>
                           <div style={{ width: `${analysis.scoring.valueWeight}%` }} className="h-full bg-purple-500"></div>
                        </div>
                        <div className="space-y-2">
                           {analysis.scoring.subCriteria?.map((sub, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/50 border border-white/5">
                                 <div className="flex items-center gap-3"><span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${sub.category === 'PRICE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}`}>{sub.category}</span><span className="text-xs text-neutral-300 font-medium truncate max-w-[120px]">{sub.label}</span></div>
                                 <span className="font-mono font-bold text-white text-xs">{sub.weight}%</span>
                              </div>
                           ))}
                        </div>
                    </div>
                  )}
               </div>
               <div className="md:col-span-2 space-y-8">
                  {!analysis ? (
                     <div className="h-full flex flex-col items-center justify-center text-neutral-600 border-2 border-dashed border-neutral-800 rounded-3xl p-10 text-center bg-neutral-900/20">
                        <Sparkles size={48} className="mb-4 opacity-10 animate-pulse" />
                        <p className="text-sm font-medium opacity-50">Pulsa en "Analizar" para iniciar el flujo de trabajo.</p>
                     </div>
                  ) : (
                     <>
                        <section><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/10 pb-2"><Euro className="text-emerald-400" size={18} /> 1. Análisis Económico</h3><div className="grid grid-cols-2 gap-4"><div className="bg-neutral-900/80 p-4 rounded-xl border border-white/5"><p className="text-[10px] text-neutral-500 uppercase font-bold mb-1 tracking-wider">Modelo</p><p className="text-neutral-200 text-sm">{analysis.economic.model}</p></div><div className="bg-neutral-900/80 p-4 rounded-xl border border-white/5"><p className="text-[10px] text-neutral-500 uppercase font-bold mb-1 tracking-wider">Base</p><p className="text-neutral-200 text-sm">{analysis.economic.basis}</p></div></div></section>
                        <section><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/10 pb-2"><Target className="text-blue-400" size={18} /> 2. Objeto</h3><div className="bg-neutral-900/80 p-5 rounded-xl border border-white/5 space-y-5"><div><p className="text-neutral-200 leading-relaxed text-sm">{analysis.scope.objective}</p></div></div></section>
                        <section><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/10 pb-2"><ShieldAlert className="text-red-400" size={18} /> 3. Solvencia</h3><div className="space-y-4"><div className="bg-neutral-900/80 p-4 rounded-xl border border-white/5"><p className="text-neutral-200 text-sm">{analysis.solvency.specificSolvency}</p></div></div></section>
                        <section><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/10 pb-2"><Lightbulb className="text-yellow-400" size={18} /> 4. Estrategia Ganadora</h3><div className="bg-yellow-950/10 p-5 rounded-2xl border border-yellow-500/20"><p className="text-yellow-50/90 italic text-base leading-relaxed font-serif">"{analysis.strategy.angle}"</p></div></section>
                     </>
                  )}
               </div>
             </div>
        </div>
      </div>
    </div>
  );
};

export default TenderDetailView;
