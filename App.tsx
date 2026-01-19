
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layout, Search, Loader2, Archive, Grid, ArrowUpDown, Calendar, Inbox, Clock, ArrowRightCircle, HelpCircle, XCircle, Filter, ChevronDown, Check } from 'lucide-react';
import NewTenderForm from './components/NewTenderForm';
import BusinessRulesEditor from './components/BusinessRulesEditor';
import TenderCard from './components/TenderCard';
import TenderDetailView from './components/TenderDetailView';
import { TenderDocument, TenderStatus } from './types';
import { analyzeTenderWithGemini } from './services/geminiService';
import { loadTendersFromStorage, saveTendersToStorage, loadRulesFromStorage, saveRulesToStorage } from './services/storageService';

type ViewMode = 'BOARD' | 'ARCHIVE';

const App: React.FC = () => {
  const DEFAULT_RULES = "1. Verificar requisitos de solvencia técnica: ¿Se exigen certificaciones específicas (ISO 9001, 14001, ENS, etc)?\n2. Si piden certificaciones obligatorias que no poseemos, marcar para descartar.";

  const [rules, setRules] = useState<string>(DEFAULT_RULES);
  const [tenders, setTenders] = useState<TenderDocument[]>([]);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [selectedTender, setSelectedTender] = useState<TenderDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [viewMode, setViewMode] = useState<ViewMode>('BOARD');

  // Archive Filter/Sort States
  const [expedientFilter, setExpedientFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TenderStatus | ''>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Custom Dropdown State
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const savedRules = await loadRulesFromStorage(DEFAULT_RULES);
      const savedTenders = await loadTendersFromStorage();
      setRules(savedRules);
      setTenders(savedTenders);
      setIsLoaded(true);
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

  useEffect(() => {
    if (isLoaded) {
      const save = async () => {
        setIsSaving(true);
        await saveTendersToStorage(tenders);
        setTimeout(() => setIsSaving(false), 500);
      };
      save();
    }
  }, [tenders, isLoaded]);

  useEffect(() => {
    if (isLoaded) saveRulesToStorage(rules);
  }, [rules, isLoaded]);

  const handleAddTender = (newTender: TenderDocument) => setTenders(prev => [newTender, ...prev]);

  const handleStatusChange = (tenderId: string, newStatus: TenderStatus) => {
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, status: newStatus } : t));
    if (selectedTender?.id === tenderId) setSelectedTender(prev => prev ? { ...prev, status: newStatus } : null);
  };

  const handleAnalyze = async (tender: TenderDocument) => {
    if (!process.env.API_KEY) {
       setError("API KEY no encontrada.");
       setTimeout(() => setError(null), 5000);
       return;
    }
    setAnalyzingIds(prev => new Set(prev).add(tender.id));
    try {
      const analysis = await analyzeTenderWithGemini(tender, rules);
      let newStatus = TenderStatus.PENDING;
      if (analysis.decision === 'KEEP') newStatus = TenderStatus.IN_PROGRESS;
      else if (analysis.decision === 'DISCARD') newStatus = TenderStatus.REJECTED;
      else if (analysis.decision === 'REVIEW') newStatus = TenderStatus.IN_DOUBT;
      const updatedTender = { ...tender, status: newStatus, aiAnalysis: analysis };
      setTenders(prev => prev.map(t => t.id === tender.id ? updatedTender : t));
      if (selectedTender?.id === tender.id) setSelectedTender(updatedTender);
    } catch (err) {
      setError("Error al analizar el pliego.");
      setTimeout(() => setError(null), 5000);
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

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '---';
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const statusConfigs = {
    [TenderStatus.PENDING]: { label: 'PENDIENTE', color: 'text-neutral-400', border: 'border-neutral-700', icon: Clock },
    [TenderStatus.IN_PROGRESS]: { label: 'EN TRAMITE', color: 'text-lime-400', border: 'border-lime-500/30', icon: ArrowRightCircle },
    [TenderStatus.IN_DOUBT]: { label: 'EN DUDA', color: 'text-amber-400', border: 'border-amber-500/30', icon: HelpCircle },
    [TenderStatus.REJECTED]: { label: 'DESCARTADO', color: 'text-red-400', border: 'border-red-500/30', icon: XCircle },
    [TenderStatus.ARCHIVED]: { label: 'ARCHIVADO', color: 'text-purple-400', border: 'border-purple-500/30', icon: Archive },
  };

  const getStatusBadge = (status: TenderStatus) => {
    const config = statusConfigs[status] || statusConfigs[TenderStatus.PENDING];
    return (
      <div className={`inline-flex items-center justify-center min-w-[85px] px-2 py-1.5 rounded-3xl border ${config.border} bg-neutral-900/50`}>
        <span className={`text-[9px] font-bold tracking-wider text-center ${config.color}`}>
          {config.label}
        </span>
      </div>
    );
  };

  if (!isLoaded) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 gap-2"><Loader2 className="animate-spin"/> Cargando base de datos...</div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col font-sans">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-neutral-950/70 backdrop-blur-xl">
        <div className="max-w-[1920px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-lime-400 p-2 rounded-lg text-black"><Layout size={18} strokeWidth={2.5} /></div>
            <h1 className="text-lg font-bold text-white tracking-tight">Licitaciones AI</h1>
          </div>
          <div className="flex items-center gap-4">
             {isSaving && <div className="flex items-center gap-2"><Loader2 size={14} className="text-lime-500 animate-spin" /><span className="text-xs text-lime-500">Sincronizando...</span></div>}
             <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold">AI</div><span className="text-xs font-medium text-neutral-400">Admin</span></div>
          </div>
        </div>
      </header>

      {error && (
        <div className="fixed top-20 right-6 z-50 bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-300">
          <span className="font-medium">{error}</span>
        </div>
      )}

      {selectedTender && <TenderDetailView tender={selectedTender} onClose={() => setSelectedTender(null)} onStatusChange={handleStatusChange} />}

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
                      <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${col.color}`}></div><h3 className="font-bold text-xs">{col.title}</h3></div>
                      <span className="text-[10px] font-bold text-neutral-500">{col.count}</span>
                    </div>
                    <div className="p-2 space-y-2 overflow-y-auto scrollbar-hide">
                      {col.items.map(t => <TenderCard key={t.id} tender={t} onAnalyze={handleAnalyze} onOpenDetail={setSelectedTender} isAnalyzing={analyzingIds.has(t.id)} />)}
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
                      <p className="text-xs text-neutral-500 mt-0.5 font-medium">Listado completo de expedientes.</p>
                    </div>
                 </div>
                 <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest pt-2">
                    {tenders.length} registros
                 </div>
               </div>

               <div className="flex-1 overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/40 shadow-inner">
                  <table className="w-full text-left border-separate border-spacing-0 table-fixed">
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
                      {/* Search / Filters Row */}
                      <tr className="bg-neutral-900/30">
                         <td className="px-4 pb-3">
                            <div className="relative">
                               <Search className="absolute left-2.5 top-2 text-neutral-600" size={12} />
                               <input 
                                 value={expedientFilter} 
                                 onChange={e => setExpedientFilter(e.target.value)} 
                                 className="w-full bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-7 py-1.5 text-[10px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/30 transition-all" 
                                 placeholder="" 
                               />
                            </div>
                         </td>
                         <td className="px-4 pb-3">
                            <div className="relative">
                               <Search className="absolute left-2.5 top-2 text-neutral-600" size={12} />
                               <input 
                                 value={nameFilter} 
                                 onChange={e => setNameFilter(e.target.value)} 
                                 className="w-full bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-7 py-1.5 text-[10px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/30 transition-all" 
                                 placeholder="Buscar título..." 
                               />
                            </div>
                         </td>
                         <td colSpan={2}></td>
                         <td className="px-4 pb-3">
                            {/* CUSTOM STATUS DROPDOWN */}
                            <div className="relative" ref={statusDropdownRef}>
                               <button 
                                 onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                 className="w-full flex items-center justify-between bg-neutral-800/40 border border-neutral-700/40 rounded-lg px-3 py-1.5 text-[10px] text-white focus:outline-none focus:border-purple-500/30 transition-all cursor-pointer font-bold h-[30px]"
                               >
                                  <div className="flex items-center gap-1.5 truncate">
                                     <Filter size={10} className="text-neutral-500 shrink-0" />
                                     <span className="truncate uppercase">{statusFilter === '' ? 'TODOS' : statusConfigs[statusFilter as TenderStatus].label}</span>
                                  </div>
                                  <ChevronDown size={12} className={`text-neutral-500 transition-transform ${isStatusDropdownOpen ? 'rotate-180' : ''}`} />
                               </button>
                               
                               {isStatusDropdownOpen && (
                                 <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-950 border border-white/10 rounded-xl shadow-2xl z-[100] p-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <button 
                                      onClick={() => { setStatusFilter(''); setIsStatusDropdownOpen(false); }}
                                      className={`w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold text-left rounded-lg transition-colors ${statusFilter === '' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
                                    >
                                       <span>TODOS LOS ESTADOS</span>
                                       {statusFilter === '' && <Check size={10} className="text-lime-400" />}
                                    </button>
                                    <div className="h-px bg-white/5 my-1 mx-1"></div>
                                    {Object.entries(statusConfigs).map(([key, config]) => {
                                       const statusKey = key as TenderStatus;
                                       const isSelected = statusFilter === statusKey;
                                       const Icon = config.icon;
                                       return (
                                         <button 
                                           key={key}
                                           onClick={() => { setStatusFilter(statusKey); setIsStatusDropdownOpen(false); }}
                                           className={`w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold text-left rounded-lg transition-colors ${isSelected ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
                                         >
                                            <div className="flex items-center gap-2">
                                               <Icon size={12} className={config.color} />
                                               <span>{config.label}</span>
                                            </div>
                                            {isSelected && <Check size={10} className="text-lime-400" />}
                                         </button>
                                       );
                                    })}
                                 </div>
                               )}
                            </div>
                         </td>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 overflow-y-auto">
                      {filteredHistoryTenders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-24 text-center">
                            <div className="flex flex-col items-center justify-center gap-3">
                               <div className="p-3 bg-neutral-800/30 rounded-full border border-white/5 text-neutral-700">
                                  <Inbox size={32} />
                               </div>
                               <p className="text-xs text-neutral-500 italic font-medium">No se encontraron registros.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredHistoryTenders.map(t => (
                          <tr key={t.id} onClick={() => setSelectedTender(t)} className="hover:bg-white/[0.03] cursor-pointer transition-all group border-l-4 border-l-transparent hover:border-l-purple-500">
                            <td className="p-4 font-mono text-[10px] text-lime-400 font-bold truncate">{t.expedientNumber || '---'}</td>
                            <td className="p-4">
                               <div className="font-bold text-white text-[12px] truncate" title={t.name}>
                                 {t.name}
                               </div>
                            </td>
                            <td className="p-4 text-right">
                               <div className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                                  <span className="text-emerald-400 font-bold text-[13px]">
                                    {t.budget?.split(' ')[0] || '---'}
                                  </span>
                                  <span className="text-[9px] text-emerald-500/70 font-bold uppercase tracking-wider">
                                    {t.budget?.split(' ')[1] || 'EUR'}
                                  </span>
                               </div>
                            </td>
                            <td className="p-4 text-center">
                               <div className="flex items-center justify-center gap-1.5 text-neutral-400 text-[10px] font-medium whitespace-nowrap">
                                  <Calendar size={11} className="text-neutral-600" />
                                  <span>{formatDate(t.deadline)}</span>
                                </div>
                            </td>
                            <td className="p-4 text-center">
                               {getStatusBadge(t.status)}
                            </td>
                          </tr>
                        ))
                      )}
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
