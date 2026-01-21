
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layout, Search, Loader2, Archive, Grid, ArrowUpDown, Calendar, Inbox, Clock, ArrowRightCircle, HelpCircle, XCircle, Filter, ChevronDown, Check, ShieldAlert, Trash2 } from 'lucide-react';
import NewTenderForm from './components/NewTenderForm';
import BusinessRulesEditor from './components/BusinessRulesEditor';
import TenderCard from './components/TenderCard';
import TenderDetailView from './components/TenderDetailView';
import { TenderDocument, TenderStatus } from './types';
import { analyzeTenderWithGemini } from './services/geminiService';
import { 
  loadTendersFromStorage, 
  saveTenderToSupabase, 
  deleteTenderFromSupabase, 
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
  const DEFAULT_RULES = "1. Verificar requisitos de solvencia técnica: ¿Se exigen certificaciones específicas (ISO 9001, 14001, ENS, etc)?\n2. Si piden certificaciones obligatorias que no poseemos, marcar para descartar.";

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
  const [statusFilter, setStatusFilter] = useState<TenderStatus | ''>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Inicialización: Cargar desde Supabase
  useEffect(() => {
    const init = async () => {
      try {
        const savedRules = await loadRulesFromStorage(DEFAULT_RULES);
        const savedTenders = await loadTendersFromStorage();
        setRules(savedRules);
        setTenders(savedTenders);
      } catch (e) {
        setError("Error de conexión con Supabase. Verifica tus credenciales.");
      } finally {
        setIsLoaded(true);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setIsStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Guardar reglas cuando cambian
  useEffect(() => {
    if (isLoaded) saveRulesToStorage(rules);
  }, [rules, isLoaded]);

  const handleAddTender = async (newTender: TenderDocument) => {
    setIsSaving(true);
    try {
      // 1. Subir archivos a Storage
      let adminUrl = newTender.adminUrl;
      let techUrl = newTender.techUrl;
      let summaryUrl = newTender.summaryUrl;

      if (newTender.summaryFile) {
        summaryUrl = await uploadFileToSupabase(newTender.summaryFile, 'summaries') || "";
      }
      if (newTender.adminFile) {
        adminUrl = await uploadFileToSupabase(newTender.adminFile, 'admin') || "";
      }
      if (newTender.techFile) {
        techUrl = await uploadFileToSupabase(newTender.techFile, 'tech') || "";
      }

      const tenderToSave = { ...newTender, adminUrl, techUrl, summaryUrl };
      
      // 2. Guardar en DB
      await saveTenderToSupabase(tenderToSave);
      
      // 3. Actualizar UI
      setTenders(prev => [tenderToSave, ...prev]);
    } catch (err) {
      setError("Error al guardar el pliego en la nube.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteTender = async () => {
    if (tenderToDelete) {
      setIsSaving(true);
      try {
        await deleteTenderFromSupabase(tenderToDelete);
        setTenders(prev => prev.filter(t => t.id !== tenderToDelete.id));
        if (selectedTender?.id === tenderToDelete.id) setSelectedTender(null);
      } catch (e) {
        setError("No se pudo eliminar el expediente de Supabase.");
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
    setTenders(prev => prev.map(t => t.id === tenderId ? updatedTender : t));
    if (selectedTender?.id === tenderId) setSelectedTender(updatedTender);

    try {
      await saveTenderToSupabase(updatedTender);
    } catch (e) {
      setError("Error al sincronizar el cambio de estado.");
    }
  };

  const handleAnalyze = async (tender: TenderDocument) => {
    setAnalyzingIds(prev => new Set(prev).add(tender.id));
    try {
      const analysis = await analyzeTenderWithGemini(tender, rules);
      let newStatus = TenderStatus.PENDING;
      if (analysis.decision === 'KEEP') newStatus = TenderStatus.IN_PROGRESS;
      else if (analysis.decision === 'DISCARD') newStatus = TenderStatus.REJECTED;
      else if (analysis.decision === 'REVIEW') newStatus = TenderStatus.IN_DOUBT;
      
      const updatedTender = { ...tender, status: newStatus, aiAnalysis: analysis };
      await saveTenderToSupabase(updatedTender);
      
      setTenders(prev => prev.map(t => t.id === tender.id ? updatedTender : t));
      if (selectedTender?.id === tender.id) setSelectedTender(updatedTender);
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
      const dateA = a.deadline || '';
      const dateB = b.deadline || '';
      return sortDirection === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });
    return result;
  }, [tenders, expedientFilter, nameFilter, statusFilter, sortDirection]);

  if (!isLoaded) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 gap-2 font-mono"><Loader2 className="animate-spin text-lime-500"/> CONECTANDO CON SUPABASE...</div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col font-sans">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-neutral-950/70 backdrop-blur-xl">
        <div className="max-w-[1920px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-lime-400 p-2 rounded-lg text-black"><Layout size={18} strokeWidth={2.5} /></div>
            <h1 className="text-lg font-bold text-white tracking-tight">Licitaciones AI <span className="text-[10px] text-lime-500/50 ml-1 font-mono uppercase tracking-widest">Cloud</span></h1>
          </div>
          <div className="flex items-center gap-4">
             {isSaving && <div className="flex items-center gap-2 px-3 py-1 bg-lime-500/10 border border-lime-500/20 rounded-full animate-pulse"><Loader2 size={12} className="text-lime-500 animate-spin" /><span className="text-[10px] font-bold text-lime-500 uppercase tracking-tighter">Sincronizando...</span></div>}
             <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold">AI</div><span className="text-xs font-medium text-neutral-400">Admin</span></div>
          </div>
        </div>
      </header>

      {error && (
        <div className="fixed top-20 right-6 z-50 bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-300">
          <span className="font-medium">{error}</span>
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-white font-bold">✕</button>
        </div>
      )}

      {selectedTender && <TenderDetailView tender={selectedTender} onClose={() => setSelectedTender(null)} onStatusChange={handleStatusChange} />}

      {tenderToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-white/10 p-8 rounded-3xl shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mb-6 border border-red-500/20">
                <ShieldAlert size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Eliminar de la Nube</h3>
              <p className="text-sm text-neutral-400 mb-8 leading-relaxed px-4">
                Esta acción eliminará el pliego y sus archivos asociados de **Supabase**. No se puede deshacer.
                <span className="text-neutral-500 font-mono text-[11px] mt-2 block italic">"{tenderToDelete.name}"</span>
              </p>
              
              <div className="flex gap-3 w-full">
                <button onClick={() => setTenderToDelete(null)} className="flex-1 px-4 py-3 rounded-xl bg-neutral-800 text-neutral-300 font-bold text-sm hover:bg-neutral-700 transition-colors">Cancelar</button>
                <button onClick={confirmDeleteTender} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-900/20">
                  <Trash2 size={16} /> Borrar Todo
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
             <button onClick={() => setViewMode('ARCHIVE')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all ${viewMode === 'ARCHIVE' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}><Archive size={14} /> Archivo</button>
          </div>
          <div className="sticky top-24 space-y-4">
            <NewTenderForm onAddTender={handleAddTender} tenders={tenders} />
            <BusinessRulesEditor rules={rules} setRules={setRules} />
          </div>
        </aside>

        <div className="col-span-12 xl:col-span-9">
          {viewMode === 'BOARD' ? (
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { title: 'Pendientes', count: tenders.filter(t => t.status === TenderStatus.PENDING).length, items: tenders.filter(t => t.status === TenderStatus.PENDING), color: 'bg-neutral-500' },
                  { title: 'En Duda', count: tenders.filter(t => t.status === TenderStatus.IN_DOUBT).length, items: tenders.filter(t => t.status === TenderStatus.IN_DOUBT), color: 'bg-amber-500' },
                  { title: 'En Trámite', count: tenders.filter(t => t.status === TenderStatus.IN_PROGRESS).length, items: tenders.filter(t => t.status === TenderStatus.IN_PROGRESS), color: 'bg-lime-400' },
                  { title: 'Descartados', count: tenders.filter(t => t.status === TenderStatus.REJECTED).length, items: tenders.filter(t => t.status === TenderStatus.REJECTED), color: 'bg-red-500' }
                ].map((col, i) => (
                  <div key={i} className="flex flex-col bg-neutral-900/50 rounded-2xl border border-white/5 overflow-hidden h-[calc(100vh-10rem)]">
                    <div className="p-3 border-b border-white/5 bg-neutral-900/80 sticky top-0 z-10 flex items-center justify-between">
                      <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${col.color}`}></div><h3 className="font-bold text-xs uppercase tracking-tight">{col.title}</h3></div>
                      <span className="text-[10px] font-bold text-neutral-500">{col.count}</span>
                    </div>
                    <div className="p-2 space-y-2 overflow-y-auto scrollbar-hide">
                      {col.items.map(t => <TenderCard key={t.id} tender={t} onAnalyze={handleAnalyze} onDelete={() => setTenderToDelete(t)} onOpenDetail={setSelectedTender} isAnalyzing={analyzingIds.has(t.id)} />)}
                    </div>
                  </div>
                ))}
             </div>
          ) : (
            <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-6 h-[calc(100vh-10rem)] flex flex-col">
               <div className="flex items-start justify-between mb-6 px-2">
                 <div className="flex items-center gap-4">
                    <div className="bg-purple-500/10 p-3 rounded-2xl border border-purple-500/20 text-purple-400">
                       <Archive size={24} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white tracking-tight">Archivo Histórico</h2>
                      <p className="text-xs text-neutral-500 mt-0.5 font-medium">Todos los registros sincronizados en Supabase.</p>
                    </div>
                 </div>
                 <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest pt-2">
                    {tenders.length} registros
                 </div>
               </div>

               <div className="flex-1 overflow-auto rounded-3xl border border-white/10 bg-neutral-900/40 shadow-inner relative">
                  <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[800px]">
                    <thead className="sticky top-0 bg-neutral-900/90 backdrop-blur-md z-20">
                      <tr>
                        <th className="p-4 font-bold text-neutral-400 w-32 text-xs">Nº Expediente</th>
                        <th className="p-4 font-bold text-neutral-400 text-xs">Título del Expediente</th>
                        <th className="p-4 font-bold text-neutral-400 w-44 text-xs text-right">Presupuesto</th>
                        <th className="p-4 font-bold text-neutral-400 w-36 text-xs text-center cursor-pointer group" onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}>
                           <div className="flex items-center justify-center gap-1.5">
                             <span>Fecha Límite</span>
                             <ArrowUpDown size={12} className="text-neutral-600 group-hover:text-neutral-400"/>
                           </div>
                        </th>
                        <th className="p-4 font-bold text-neutral-400 w-36 text-xs text-center">Estado</th>
                      </tr>
                      <tr className="bg-neutral-900/30">
                         <td className="px-4 pb-3">
                            <input value={expedientFilter} onChange={e => setExpedientFilter(e.target.value)} className="w-full bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-3 py-1.5 text-[10px] text-white focus:outline-none focus:border-purple-500/30 transition-all" />
                         </td>
                         <td className="px-4 pb-3">
                            <input value={nameFilter} onChange={e => setNameFilter(e.target.value)} className="w-full bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-3 py-1.5 text-[10px] text-white focus:outline-none focus:border-purple-500/30 transition-all" placeholder="Buscar título..." />
                         </td>
                         <td colSpan={2}></td>
                         <td className="px-4 pb-3">
                            <div className="relative" ref={statusDropdownRef}>
                               <button onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)} className="w-full flex items-center justify-between bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-3 py-1.5 text-[10px] text-white focus:outline-none h-[30px] uppercase font-bold">
                                  <span className="truncate">{statusFilter === '' ? 'TODOS' : statusConfigs[statusFilter as TenderStatus].label}</span>
                                  <ChevronDown size={12} className="text-neutral-500" />
                               </button>
                               {isStatusDropdownOpen && (
                                 <div className="absolute top-full right-0 mt-1 w-52 bg-neutral-950 border border-white/10 rounded-xl shadow-2xl z-[100] p-1 overflow-y-auto max-h-[220px]">
                                    <button onClick={() => { setStatusFilter(''); setIsStatusDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-[10px] font-bold rounded-lg ${statusFilter === '' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5'}`}>TODOS LOS ESTADOS</button>
                                    {Object.entries(statusConfigs).map(([key, config]) => (
                                       <button key={key} onClick={() => { setStatusFilter(key as TenderStatus); setIsStatusDropdownOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold rounded-lg ${statusFilter === key ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5'}`}>
                                          <div className={`w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-')}`}></div> {config.label}
                                       </button>
                                    ))}
                                 </div>
                               )}
                            </div>
                         </td>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredHistoryTenders.map(t => (
                        <tr key={t.id} onClick={() => setSelectedTender(t)} className="hover:bg-white/[0.03] cursor-pointer transition-all group border-l-4 border-l-transparent hover:border-l-purple-500">
                          <td className="p-4 font-mono text-[10px] text-lime-400 font-bold">{t.expedientNumber || '---'}</td>
                          <td className="p-4 font-bold text-white text-[12px] truncate">{t.name}</td>
                          <td className="p-4 text-right text-emerald-400 font-bold text-[13px]">{t.budget || '---'}</td>
                          <td className="p-4 text-center text-neutral-400 text-[10px]">{t.deadline || '---'}</td>
                          <td className="p-4 text-center">
                             <div className={`inline-block px-2 py-1 rounded-full text-[9px] font-bold border ${statusConfigs[t.status].border} ${statusConfigs[t.status].color}`}>{statusConfigs[t.status].label}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
