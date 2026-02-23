
import React from 'react';
import { FileText, ExternalLink, Loader2, File, FileCode, FileSpreadsheet, Download, Sparkles, Euro, CalendarDays, Trash2, Fingerprint, AlertTriangle } from 'lucide-react';
import { TenderDocument, TenderStatus } from '../types';

interface Props {
  tender: TenderDocument;
  onAnalyze?: (tender: TenderDocument) => void;
  onDelete?: (tender: TenderDocument) => void;
  onOpenDetail?: (tender: TenderDocument) => void;
  isAnalyzing?: boolean;
}

const TenderCard: React.FC<Props> = ({ tender, onAnalyze, onDelete, onOpenDetail, isAnalyzing }) => {
  const getStatusColor = () => {
    switch (tender.status) {
      case TenderStatus.IN_PROGRESS: return 'bg-neutral-900 border-lime-500/50 shadow-[0_0_15px_rgba(132,204,22,0.1)]'; 
      case TenderStatus.IN_DOUBT: return 'bg-neutral-900 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)]'; 
      case TenderStatus.REJECTED: return 'bg-neutral-900 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]'; 
      case TenderStatus.ARCHIVED: return 'bg-neutral-900 border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.1)]'; 
      default: return 'bg-neutral-900 border-white/5 hover:border-white/10'; 
    }
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return 'Fecha no def.';
    const s = String(dateStr);
    if (s.includes('-')) {
      const parts = s.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return s;
  };

  const handleDownloadFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderDocumentRow = (
    type: 'SUMMARY' | 'ADMIN' | 'TECH',
    file: File | null, 
    url: string
  ) => {
    if (!file && !url) return null;

    let Icon = File;
    let colorClass = "text-neutral-400";
    let bgClass = "bg-neutral-800";
    let defaultLabel = "Enlace";

    if (type === 'ADMIN') { 
      Icon = FileSpreadsheet; 
      colorClass = "text-amber-400"; 
      bgClass = "bg-amber-950/30"; 
      defaultLabel = "PCAP";
    } 
    if (type === 'TECH') { 
      Icon = FileCode; 
      colorClass = "text-indigo-400"; 
      bgClass = "bg-indigo-950/30"; 
      defaultLabel = "PPT";
    } 
    if (type === 'SUMMARY') { 
      Icon = FileText; 
      colorClass = "text-blue-400"; 
      bgClass = "bg-blue-950/30"; 
    }

    const displayText = file 
      ? (type === 'SUMMARY' ? file.name.replace(/\.pdf$/i, '') : file.name)
      : defaultLabel;

    return (
      <div className="flex items-center gap-2 p-1.5 rounded-lg border border-white/5 bg-neutral-950/30 hover:bg-neutral-800 transition-colors group">
        <div className={`p-1.5 rounded-md ${bgClass} ${colorClass} border border-white/5`}>
          <Icon size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-neutral-300 truncate font-mono">
            {displayText}
          </p>
        </div>
        {!file && url && (
          <div className="p-1 text-amber-500" title="Solo enlace disponible. La IA buscará en la web para analizar este pliego.">
            <AlertTriangle size={12} />
          </div>
        )}
        {file ? (
          <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(file); }} className="p-1 text-neutral-500 hover:text-lime-400" title="Descargar PDF físico"><Download size={14} /></button>
        ) : (
          url && <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-neutral-500 hover:text-lime-400" title="Abrir enlace externo"><ExternalLink size={14} /></a>
        )}
      </div>
    );
  };

  const renderBudget = () => {
    if (!tender.budget) return <div className="text-[10px] text-neutral-600 font-medium italic">Sin importe</div>;
    const budgetStr = String(tender.budget);
    const hasCurrency = budgetStr.includes('EUR') || budgetStr.includes('€');
    return (
      <div className="inline-flex items-center gap-1.5 text-emerald-400 font-bold text-[13px] whitespace-nowrap bg-emerald-500/5 px-2 py-1 rounded-lg border border-emerald-500/10">
        <Euro size={12} className="shrink-0" />
        <span>{hasCurrency ? budgetStr : `${budgetStr} €`}</span>
      </div>
    );
  };

  return (
    <div 
      onClick={() => onOpenDetail && onOpenDetail(tender)}
      className={`rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1 ${getStatusColor()} relative overflow-hidden group cursor-pointer`}
    >
      <div className={`absolute top-0 left-0 w-1.5 h-full 
         ${tender.status === TenderStatus.IN_PROGRESS ? 'bg-lime-500' : 
           tender.status === TenderStatus.IN_DOUBT ? 'bg-amber-500' :
           tender.status === TenderStatus.REJECTED ? 'bg-red-500' : 
           tender.status === TenderStatus.ARCHIVED ? 'bg-purple-500' :
           'bg-transparent'}`
      }></div>
      <div className="pl-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-semibold bg-neutral-800/40 px-2 py-1 rounded-md w-fit">
            <CalendarDays size={12} className="text-neutral-500" />
            <span>{formatDate(tender.deadline)}</span>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete?.(tender); }} className="p-1.5 text-neutral-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"><Trash2 size={14} /></button>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-950 border border-white/5 rounded-md text-[11px] font-mono text-lime-400 font-bold tracking-tight w-fit">
          <Fingerprint size={12} className="text-neutral-600" />
          <span className="truncate max-w-[180px] uppercase">{tender.expedientNumber || 'SIN EXPEDIENTE'}</span>
        </div>
        <h4 className="font-bold text-neutral-100 leading-snug text-[13px] line-clamp-2 group-hover:text-white transition-colors pt-0.5">{tender.name}</h4>
        <div className="pt-1">{renderBudget()}</div>
      </div>
      <div className="mt-4 bg-neutral-800/20 rounded-xl p-1.5 space-y-1 border border-white/5 ml-2">
        {renderDocumentRow("SUMMARY", tender.summaryFile || null, "")}
        {renderDocumentRow("ADMIN", tender.adminFile || null, tender.adminUrl || "")}
        {renderDocumentRow("TECH", tender.techFile || null, tender.techUrl || "")}
      </div>
      <div className="mt-4 ml-2" onClick={(e) => e.stopPropagation()}>
        {tender.status === TenderStatus.PENDING ? (
          <div className="space-y-2">
            <button type="button" onClick={() => onAnalyze && onAnalyze(tender)} disabled={isAnalyzing} className={`w-full py-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-all ${isAnalyzing ? 'bg-neutral-800 text-neutral-500' : 'bg-lime-400 text-black hover:bg-lime-300 shadow-lg shadow-lime-500/10'}`}>
              {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isAnalyzing ? 'ANALIZANDO...' : 'ANALIZAR VIABILIDAD'}
            </button>
          </div>
        ) : tender.aiAnalysis && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-tight">
               <Sparkles size={12} className="text-purple-400" />
               <span>Análisis IA: {tender.aiAnalysis.decision}</span>
            </div>
            <p className="text-[10px] text-neutral-400 line-clamp-2 leading-relaxed italic">"{tender.aiAnalysis.summaryReasoning}"</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenderCard;
