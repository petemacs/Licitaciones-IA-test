
import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Loader2, Archive, Grid, Clock, ArrowRightCircle, HelpCircle, XCircle, ShieldAlert, Trash2, Database, Cloud, Search, ArrowUpDown } from 'lucide-react';
import NewTenderForm from './components/NewTenderForm';
import BusinessRulesEditor from './components/BusinessRulesEditor';
import TenderCard from './components/TenderCard';
import TenderDetailView from './components/TenderDetailView';
import { TenderDocument, TenderStatus } from './types';
import { analyzeTenderWithGemini } from './services/geminiService';
import { isCloudConfigured } from './services/supabaseClient';
import { 
  loadTendersFromStorage, 
  saveTenderToStorage, 
  deleteTenderFromStorage, 
  loadRulesFromStorage, 
  saveRulesToStorage,
  uploadFileToSupabase
} from './services/storageService';

type ViewMode = 'BOARD' | 'ARCHIVE';

const statusConfigs = {
  [TenderStatus.PENDING]: { label: 'PENDIENTE', color: 'text-neutral-400', border: 'border-neutral-700', icon: Clock },
  [TenderStatus.IN_PROGRESS]: { label: 'EN TRAMITE', color: 'text-lime-400', border: 'border-lime-500/30', icon: ArrowRightCircle },
  [TenderStatus.IN_DOUBT]: { label: 'EN DUDA', color: 'text-amber-400', border: 'border-amber-500/30', icon: HelpCircle },
  [TenderStatus.REJECTED]: { label: 'DESCARTADO', color: 'text-red-400', border: 'border-red-500/30', icon: XCircle },
  [TenderStatus.ARCHIVED]: { label: 'ARCHIVADO', color: 'text-purple-400', border: 'border-purple-500/30', icon: Archive },
};

const App: React.FC = () => {
  const DEFAULT_RULES = "1. Verificar requisitos de solvencia técnica.\n2. Si piden certificaciones obligatorias que no poseemos, descartar.";

  const [rules, setRules] = useState<string>(DEFAULT_RULES);
  const [tenders, setTenders] = useState<TenderDocument[]>([]);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [selectedTender, setSelectedTender] = useState<TenderDocument | null>(null);
  const [tenderToDelete, setTenderToDelete] = useState<TenderDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [viewMode, setViewMode] = useState<ViewMode>('BOARD');

  const [expedientFilter, setExpedientFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter] = useState<TenderStatus | ''>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const parseDeadline = (dateStr: string | undefined): number => {
    if (!dateStr) return 0;
    // Intenta extraer fecha y hora: dd/mm/yyyy ... hh:mm
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})(?:.*?(\d{2}):(\d{2}))?/);
    if (match) {
      const [_, day, month, year, hour, minute] = match;
      return new Date(
        parseInt(year), 
        parseInt(month) - 1, 
        parseInt(day), 
        hour ? parseInt(hour) : 0, 
        minute ? parseInt(minute) : 0
      ).getTime();
    }
    return 0;
  };

  const formatDeadlineDisplay = (dateStr: string | undefined) => {
    if (!dateStr) return '---';
    // Limpiar "Hasta el " y " a las "
    return dateStr.replace(/Hasta el /i, '').replace(/ a las /i, ' ');
  };
  
  useEffect(() => {
    const init = async () => {
      try {
        const savedRules = await loadRulesFromStorage(DEFAULT_RULES);
        const savedTenders = await loadTendersFromStorage();
        setRules(savedRules);
        setTenders(savedTenders);
      } catch (e) {
        console.warn("Error inicializando almacenamiento:", e);
      } finally {
        setIsLoaded(true);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (isLoaded) saveRulesToStorage(rules);
  }, [rules, isLoaded]);

  const handleAddTender = async (newTender: TenderDocument) => {
    setIsSaving(true);
    try {
      let tenderToSave = { ...newTender };

      if (isCloudConfigured) {
        if (newTender.summaryFile) {
          const url = await uploadFileToSupabase(newTender.summaryFile, 'summaries');
          if (url) tenderToSave.summaryUrl = url;
        }
        if (newTender.adminFile) {
          const url = await uploadFileToSupabase(newTender.adminFile, 'admin');
          if (url) tenderToSave.adminUrl = url;
        }
        if (newTender.techFile) {
          const url = await uploadFileToSupabase(newTender.techFile, 'tech');
          if (url) tenderToSave.techUrl = url;
        }
      }

      await saveTenderToStorage(tenderToSave);
      setTenders(prev => [tenderToSave, ...prev]);
    } catch (err) {
      setError("Error al guardar el pliego.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTender = async (updatedTender: TenderDocument) => {
    setIsSaving(true);
    try {
      let tenderToSave = { ...updatedTender };

      if (isCloudConfigured) {
        // Subir archivos nuevos si se han añadido manualmente en el detalle
        if (updatedTender.summaryFile && !updatedTender.summaryUrl) {
          tenderToSave.summaryUrl = await uploadFileToSupabase(updatedTender.summaryFile, 'summaries') || "";
        }
        if (updatedTender.adminFile && (!updatedTender.adminUrl || !updatedTender.adminUrl.startsWith('http'))) {
          tenderToSave.adminUrl = await uploadFileToSupabase(updatedTender.adminFile, 'admin') || "";
        }
        if (updatedTender.techFile && (!updatedTender.techUrl || !updatedTender.techUrl.startsWith('http'))) {
          tenderToSave.techUrl = await uploadFileToSupabase(updatedTender.techFile, 'tech') || "";
        }
      }

      await saveTenderToStorage(tenderToSave);
      setTenders(prev => prev.map(t => t.id === tenderToSave.id ? tenderToSave : t));
      if (selectedTender?.id === tenderToSave.id) setSelectedTender(tenderToSave);
    } catch (err) {
      console.error(err);
      setError("Error al actualizar el expediente.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteTender = async () => {
    if (tenderToDelete) {
      setIsSaving(true);
      try {
        await deleteTenderFromStorage(tenderToDelete);
        setTenders(prev => prev.filter(t => t.id !== tenderToDelete.id));
        if (selectedTender?.id === tenderToDelete.id) setSelectedTender(null);
      } catch (e) {
        setError("No se pudo eliminar el expediente.");
      } finally {
        setTenderToDelete(null);
        setIsSaving(false);
      }
    }
  };

  const handleStatusChange = async (tenderId: string, newStatus: TenderStatus) => {
    const tender = tenders.find(t => t.id === tenderId);
    if (!tender) return;

    const updatedTender = { ...tender, status: newStatus };
    await handleUpdateTender(updatedTender);
  };

  const handleAnalyze = async (tender: TenderDocument) => {
    setAnalyzingIds(prev => new Set(prev).add(tender.id));
    try {
      // Pasamos una copia para que geminiService pueda inyectar archivos descargados si es necesario
      const tenderCopy = { ...tender };
      const analysis = await analyzeTenderWithGemini(tenderCopy, rules);
      
      let newStatus = tender.status;
      if (analysis.decision === 'KEEP') newStatus = TenderStatus.IN_PROGRESS;
      else if (analysis.decision === 'DISCARD') newStatus = TenderStatus.REJECTED;
      else if (analysis.decision === 'REVIEW') newStatus = TenderStatus.IN_DOUBT;
      
      const updatedTender = { 
        ...tenderCopy, 
        status: newStatus, 
        aiAnalysis: analysis 
      };
      
      await handleUpdateTender(updatedTender);
    } catch (err: any) {
      setError(`Error al analizar: ${err.message || "Fallo en la API"}`);
    } finally {
      setAnalyzingIds(prev => { const next = new Set(prev); next.delete(tender.id); return next; });
    }
  };

  const filteredHistoryTenders = useMemo(() => {
    let result = tenders.filter(t => 
      (t.expedientNumber || '').toLowerCase().includes(expedientFilter.toLowerCase()) &&
      (t.name || '').toLowerCase().includes(nameFilter.toLowerCase()) &&
      (statusFilter === '' || t.status === statusFilter)
    );
    result.sort((a, b) => {
      const dateA = parseDeadline(a.deadline);
      const dateB = parseDeadline(b.deadline);
      return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return result;
  }, [tenders, expedientFilter, nameFilter, statusFilter, sortDirection]);

  if (!isLoaded) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 gap-2 font-mono"><Loader2 className="animate-spin text-lime-500"/> CARGANDO...</div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col font-sans">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-neutral-950/70 backdrop-blur-xl">
        <div className="max-w-[1920px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-lime-400 p-2 rounded-lg text-black shadow-[0_0_15px_rgba(163,230,53,0.3)]"><Layout size={18} strokeWidth={2.5} /></div>
            <h1 className="text-lg font-bold text-white tracking-tight">Licitaciones AI</h1>
          </div>
          
          <div className="flex items-center gap-4">
             {isCloudConfigured ? (
               <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full">
                 <Cloud size={12} className="text-blue-400" />
                 <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">Sincronización Nube Activa</span>
               </div>
             ) : (
               <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                 <Database size={12} className="text-amber-400" />
                 <span className="text-[10px] font-bold text-amber-400 uppercase tracking-tighter">Persistencia Local (IndexedDB)</span>
               </div>
             )}
             
             {isSaving && <div className="flex items-center gap-2 px-3 py-1 bg-lime-500/10 border border-lime-500/20 rounded-full animate-pulse"><Loader2 size={12} className="text-lime-500 animate-spin" /><span className="text-[10px] font-bold text-lime-500 uppercase tracking-tighter">Guardando...</span></div>}
             <div className="w-px h-6 bg-white/5 mx-1"></div>
             <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-lime-400">AI</div></div>
          </div>
        </div>
      </header>

      {error && (
        <div className="fixed top-20 right-6 z-50 bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-300">
          <span className="font-medium">{error}</span>
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-white font-bold">✕</button>
        </div>
      )}

      {selectedTender && (
        <TenderDetailView 
          tender={selectedTender} 
          onClose={() => setSelectedTender(null)} 
          onStatusChange={handleStatusChange} 
          onUpdateTender={handleUpdateTender}
          onAnalyze={handleAnalyze}
          isAnalyzing={analyzingIds.has(selectedTender.id)}
        />
      )}

      {tenderToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-white/10 p-8 rounded-3xl shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mb-6 border border-red-500/20">
                <ShieldAlert size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Eliminar Expediente</h3>
              <p className="text-sm text-neutral-400 mb-8 leading-relaxed px-4">
                Esta acción eliminará el pliego y sus archivos PDF asociados permanentemente de tu base de datos.
              </p>
              
              <div className="flex gap-3 w-full">
                <button onClick={() => setTenderToDelete(null)} className="flex-1 px-4 py-3 rounded-xl bg-neutral-800 text-neutral-300 font-bold text-sm hover:bg-neutral-700 transition-colors">Cancelar</button>
                <button onClick={confirmDeleteTender} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-900/20">
                  <Trash2 size={16} /> Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="relative z-10 flex-1 max-w-[1920px] mx-auto w-full px-6 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-12 xl:col-span-3 space-y-4">
          <div className="flex p-1 bg-neutral-900 rounded-xl border border-white/5">
             <button onClick={() => setViewMode('BOARD')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all ${viewMode === 'BOARD' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}><Grid size={14} /> Tablero</button>
             <button onClick={() => setViewMode('ARCHIVE')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all ${viewMode === 'ARCHIVE' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}><Archive size={14} /> Histórico</button>
          </div>
          <div className="sticky top-24 space-y-4">
            <NewTenderForm onAddTender={handleAddTender} tenders={tenders} />
            <BusinessRulesEditor rules={rules} setRules={setRules} />
          </div>
        </aside>

        <div className="col-span-12 xl:col-span-9 h-fit min-h-screen pb-20">
          {viewMode === 'BOARD' ? (
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { title: 'Pendientes', count: tenders.filter(t => t.status === TenderStatus.PENDING).length, items: tenders.filter(t => t.status === TenderStatus.PENDING), color: 'bg-neutral-500' },
                  { title: 'En Duda', count: tenders.filter(t => t.status === TenderStatus.IN_DOUBT).length, items: tenders.filter(t => t.status === TenderStatus.IN_DOUBT), color: 'bg-amber-500' },
                  { title: 'En Trámite', count: tenders.filter(t => t.status === TenderStatus.IN_PROGRESS).length, items: tenders.filter(t => t.status === TenderStatus.IN_PROGRESS), color: 'bg-lime-400' },
                  { title: 'Descartados', count: tenders.filter(t => t.status === TenderStatus.REJECTED).length, items: tenders.filter(t => t.status === TenderStatus.REJECTED), color: 'bg-red-500' }
                ].map((col, i) => (
                  <div key={i} className="flex flex-col bg-neutral-900/30 rounded-2xl border border-white/5 overflow-hidden h-fit">
                    <div className="p-3 border-b border-white/5 bg-neutral-900/60 sticky top-0 z-10 flex items-center justify-between backdrop-blur-sm">
                      <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${col.color}`}></div><h3 className="font-bold text-xs uppercase tracking-tight">{col.title}</h3></div>
                      <span className="text-[10px] font-bold text-neutral-500">{col.count}</span>
                    </div>
                    <div className="p-2 space-y-2 overflow-y-visible">
                      {col.items.map(t => <TenderCard key={t.id} tender={t} onAnalyze={handleAnalyze} onDelete={() => setTenderToDelete(t)} onOpenDetail={setSelectedTender} isAnalyzing={analyzingIds.has(t.id)} />)}
                      {col.count === 0 && (
                        <div className="py-10 text-center flex flex-col items-center justify-center opacity-20">
                          <Layout size={32} className="mb-2" />
                          <p className="text-[10px] font-bold">VACÍO</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
             </div>
          ) : (
            <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-6 h-fit min-h-[600px] flex flex-col">
               <div className="flex items-start justify-between mb-6 px-2">
                 <div className="flex items-center gap-4">
                    <div className="bg-purple-500/10 p-3 rounded-2xl border border-purple-500/20 text-purple-400">
                       <Archive size={24} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white tracking-tight">Archivo Histórico</h2>
                      <p className="text-xs text-neutral-500 mt-0.5 font-medium">Todos los expedientes registrados en tu base de datos.</p>
                    </div>
                 </div>
               </div>

               <div className="flex gap-4 mb-6 px-2">
                 <div className="relative flex-1 max-w-xs">
                   <Search className="absolute left-3 top-2.5 text-neutral-500" size={14} />
                   <input 
                     value={expedientFilter}
                     onChange={(e) => setExpedientFilter(e.target.value)}
                     placeholder="Buscar por Nº Expediente..." 
                     className="w-full pl-9 pr-4 py-2 bg-neutral-950/50 border border-white/10 rounded-xl text-xs text-white focus:border-lime-500/50 outline-none"
                   />
                 </div>
                 <div className="relative flex-1 max-w-md">
                   <Search className="absolute left-3 top-2.5 text-neutral-500" size={14} />
                   <input 
                     value={nameFilter}
                     onChange={(e) => setNameFilter(e.target.value)}
                     placeholder="Buscar por Título..." 
                     className="w-full pl-9 pr-4 py-2 bg-neutral-950/50 border border-white/10 rounded-xl text-xs text-white focus:border-lime-500/50 outline-none"
                   />
                 </div>
               </div>

               <div className="flex-1 overflow-auto rounded-3xl border border-white/10 bg-neutral-900/40 shadow-inner relative">
                  <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[800px]">
                    <thead className="sticky top-0 bg-neutral-900/90 backdrop-blur-md z-20">
                      <tr>
                        <th className="p-4 font-bold text-neutral-400 w-32 text-xs border-b border-white/5">Nº Expediente</th>
                        <th className="p-4 font-bold text-neutral-400 text-xs border-b border-white/5">Título del Expediente</th>
                        <th className="p-4 font-bold text-neutral-400 w-44 text-xs text-right border-b border-white/5">Presupuesto</th>
                        <th 
                          className="p-4 font-bold text-neutral-400 w-40 text-xs text-center border-b border-white/5 cursor-pointer hover:text-white transition-colors select-none group"
                          onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                        >
                          <div className="flex items-center justify-center gap-1">
                            Fecha Límite
                            <ArrowUpDown size={12} className={`transition-transform ${sortDirection === 'asc' ? 'rotate-0' : 'rotate-180'} opacity-50 group-hover:opacity-100`} />
                          </div>
                        </th>
                        <th className="p-4 font-bold text-neutral-400 w-36 text-xs text-center border-b border-white/5">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredHistoryTenders.map(t => (
                        <tr key={t.id} onClick={() => setSelectedTender(t)} className="hover:bg-white/[0.03] cursor-pointer transition-all group">
                          <td className="p-4 font-mono text-[10px] text-lime-400 font-bold">{t.expedientNumber || '---'}</td>
                          <td className="p-4 font-bold text-white text-[12px] truncate">{t.name}</td>
                          <td className="p-4 text-right text-emerald-400 font-bold text-[13px]">{t.budget || '---'}</td>
                          <td className="p-4 text-center text-neutral-400 text-[10px]">{formatDeadlineDisplay(t.deadline)}</td>
                          <td className="p-4 text-center">
                             <div className={`inline-block px-2 py-1 rounded-full text-[9px] font-bold border ${statusConfigs[t.status].border} ${statusConfigs[t.status].color}`}>{statusConfigs[t.status].label}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredHistoryTenders.length === 0 && (
                    <div className="p-20 text-center text-neutral-600">No hay expedientes registrados.</div>
                  )}
               </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
