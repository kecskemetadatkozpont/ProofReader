import React, { useRef, useEffect, useState } from 'react';
import { Grant } from '../types';
import { Loader2, Plus, ExternalLink, RefreshCw, Terminal, Check, Search, Cpu, ChevronDown, ChevronUp, FileText, Target, Users, Download, LayoutList, CalendarDays, AlertTriangle, Filter, X } from 'lucide-react';
import GrantCalendar from '../components/GrantCalendar';

interface FindFundingProps {
  onAddToOpenCalls: (grant: Grant) => void;
  existingOpenCalls: Grant[];
  categories: { id: string; label: string; query: string }[];
  selectedCategories: string[];
  onToggleCategory: (id: string) => void;
  onStartSearch: () => void;
  streamedGrants: Grant[];
  loading: boolean;
  currentAction: string;
  logs: string[];
}

const FindFunding: React.FC<FindFundingProps> = ({ 
  onAddToOpenCalls,
  existingOpenCalls,
  categories,
  selectedCategories,
  onToggleCategory,
  onStartSearch,
  streamedGrants,
  loading,
  currentAction,
  logs
}) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // --- Filter State ---
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    funder: '',
    startDate: '',
    endDate: '',
    minAmount: ''
  });

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleCalendarClick = (grant: Grant) => {
    setViewMode('list');
    setExpandedId(grant.id);
    setTimeout(() => {
        const element = document.getElementById(`grant-stream-card-${grant.id}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
  };

  // --- Filtering Logic ---
  const filteredGrants = streamedGrants.filter(grant => {
    // 1. Funder Filter (Case insensitive)
    if (filters.funder && !grant.funder.toLowerCase().includes(filters.funder.toLowerCase())) {
        return false;
    }

    // 2. Deadline Filter
    if (filters.startDate || filters.endDate) {
        // Skip TBD or invalid dates if filtering by date
        if (!grant.deadline || grant.deadline === 'TBD') return false;
        
        const grantDate = new Date(grant.deadline);
        if (isNaN(grantDate.getTime())) return false; // Invalid date format in data

        if (filters.startDate) {
            if (grantDate < new Date(filters.startDate)) return false;
        }
        if (filters.endDate) {
            if (grantDate > new Date(filters.endDate)) return false;
        }
    }

    // 3. Amount Filter (Extract numeric value)
    if (filters.minAmount) {
        if (!grant.amount || grant.amount === 'N/A') return false;
        
        // Remove commas and find the first number sequence (e.g. "€4,000,000" -> "4000000")
        // This is a rough heuristic as it ignores currency differences (EUR vs HUF)
        const numericMatch = grant.amount.replace(/,/g, '').match(/(\d+(\.\d+)?)/);
        if (!numericMatch) return false;

        const amountValue = parseFloat(numericMatch[0]);
        const filterValue = parseFloat(filters.minAmount);
        
        if (amountValue < filterValue) return false;
    }

    return true;
  });

  const activeFilterCount = [filters.funder, filters.startDate, filters.endDate, filters.minAmount].filter(Boolean).length;

  return (
    <div className="space-y-6 h-full flex flex-col">
      <header>
        <h2 className="text-2xl font-bold text-primary">Find Funding</h2>
        <p className="text-slate-500">
          Global grant scanner powered by Google Gemini. Select sources to search worldwide.
        </p>
      </header>

      {/* Control Panel */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-6">
        {/* Category Tabs */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {categories.map(cat => {
            const isSelected = selectedCategories.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => onToggleCategory(cat.id)}
                disabled={loading}
                className={`px-4 py-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                  isSelected
                    ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white hover:border-accent'
                } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="font-semibold text-sm">{cat.label}</span>
                {isSelected && <Check className="w-4 h-4" />}
              </button>
            );
          })}
        </div>

        {/* Action Button & Terminal */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <button
            onClick={onStartSearch}
            disabled={loading || selectedCategories.length === 0}
            className="w-full md:w-auto md:min-w-[200px] bg-accent hover:bg-blue-600 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
          >
            {loading ? (
               <>
                 <Loader2 className="w-5 h-5 animate-spin" />
                 Scanning...
               </>
            ) : (
               <>
                 <Search className="w-5 h-5" />
                 Start Global Scan
               </>
            )}
          </button>

          {/* Terminal / Status Log */}
          <div className="flex-1 w-full bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 h-32 flex flex-col shadow-inner border border-slate-700">
            <div className="flex items-center gap-2 border-b border-slate-700 pb-2 mb-2 text-slate-400">
              <Terminal className="w-4 h-4" />
              <span>System Activity Log</span>
              {loading && <span className="animate-pulse ml-auto text-accent">● Live</span>}
            </div>
            <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
               {logs.length === 0 ? (
                 <span className="text-slate-600 opacity-50">Select sources (e.g., NKFIH, Charity) and click Scan.</span>
               ) : (
                 logs.map((log, i) => (
                   <div key={i} className="break-words">
                     <span className="opacity-50 mr-2">{'>'}</span>
                     {log}
                   </div>
                 ))
               )}
               {loading && (
                 <div className="animate-pulse opacity-70">
                   <span className="opacity-50 mr-2">{'>'}</span>
                   {currentAction}
                 </div>
               )}
            </div>
          </div>
        </div>
      </div>

      {/* Results Header with Toggle */}
      <div className="flex justify-between items-center">
         <div className="flex items-center gap-3">
             <h3 className="font-bold text-lg text-slate-800">Results Stream</h3>
             {filteredGrants.length !== streamedGrants.length ? (
                 <span className="text-xs font-bold text-white bg-accent px-2 py-1 rounded-full">
                    {filteredGrants.length} / {streamedGrants.length}
                 </span>
             ) : (
                 <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                    {streamedGrants.length} total
                 </span>
             )}
         </div>
         
         <div className="flex gap-2">
            <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    showFilters || activeFilterCount > 0
                    ? 'bg-blue-50 border-blue-200 text-accent' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
            >
                <Filter className="w-4 h-4" />
                {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filter'}
            </button>

            <div className="bg-white border border-slate-200 rounded-lg p-1 flex">
                <button 
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded transition-colors ${viewMode === 'list' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
                  title="List View"
                >
                  <LayoutList className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setViewMode('calendar')}
                  className={`p-2 rounded transition-colors ${viewMode === 'calendar' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
                  title="Calendar View"
                >
                  <CalendarDays className="w-4 h-4" />
                </button>
            </div>
         </div>
      </div>

      {/* FILTER PANEL */}
      {showFilters && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm animate-in slide-in-from-top-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Funder / Keyword</label>
                    <input 
                        type="text"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-accent focus:bg-white outline-none transition-all"
                        placeholder="e.g. Horizon, NKFIH"
                        value={filters.funder}
                        onChange={e => setFilters({...filters, funder: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Deadline From</label>
                    <input 
                        type="date"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-accent focus:bg-white outline-none transition-all"
                        value={filters.startDate}
                        onChange={e => setFilters({...filters, startDate: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Deadline To</label>
                    <input 
                        type="date"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-accent focus:bg-white outline-none transition-all"
                        value={filters.endDate}
                        onChange={e => setFilters({...filters, endDate: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Min Amount (Value)</label>
                    <input 
                        type="number"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-accent focus:bg-white outline-none transition-all"
                        placeholder="e.g. 5000000"
                        value={filters.minAmount}
                        onChange={e => setFilters({...filters, minAmount: e.target.value})}
                    />
                </div>
            </div>
            {activeFilterCount > 0 && (
                <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                    <button 
                        onClick={() => setFilters({ funder: '', startDate: '', endDate: '', minAmount: '' })}
                        className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
                    >
                        <X className="w-3.5 h-3.5" /> Clear All Filters
                    </button>
                </div>
            )}
        </div>
      )}

      {/* Results Stream Area */}
      <div className="flex-1 bg-slate-50/50 rounded-xl border border-slate-100 p-6 overflow-y-auto min-h-[400px]">
        {streamedGrants.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <RefreshCw className="w-12 h-12 mb-4 opacity-10" />
            <p>Scan results will appear here in real-time.</p>
          </div>
        )}

        {filteredGrants.length === 0 && streamedGrants.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Filter className="w-10 h-10 mb-3 opacity-20" />
                <p>No grants match your active filters.</p>
                <button 
                    onClick={() => setFilters({ funder: '', startDate: '', endDate: '', minAmount: '' })}
                    className="mt-2 text-accent text-sm hover:underline"
                >
                    Clear filters
                </button>
            </div>
        )}

        {viewMode === 'calendar' && filteredGrants.length > 0 ? (
           <GrantCalendar grants={filteredGrants} onGrantClick={handleCalendarClick} />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredGrants.map((grant, idx) => {
              const isAdded = existingOpenCalls.some(
                g => g.id === grant.id || g.title === grant.title
              );
              const isExpanded = expandedId === grant.id;

              return (
                <div 
                  key={grant.id} 
                  id={`grant-stream-card-${grant.id}`}
                  className={`bg-white border transition-all hover:shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-forwards rounded-lg overflow-hidden ${
                    isExpanded ? 'border-accent ring-1 ring-accent/20' : 'border-slate-200'
                  }`}
                  style={{ animationDelay: '0.1s' }}
                >
                  <div className="p-5">
                    <div className="flex flex-col h-full justify-between">
                      <div onClick={() => toggleExpand(grant.id)} className="cursor-pointer group">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className="bg-blue-50 text-accent text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                              {grant.funder}
                            </span>
                            <span className="text-slate-400 text-xs">
                              Match: {grant.matchScore}%
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {grant.url && (
                              <a 
                                href={grant.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-slate-400 hover:text-accent transition-colors"
                                title="Open Source"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                            <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                              <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-accent" />
                            </div>
                          </div>
                        </div>
                        
                        <h4 className="font-bold text-lg text-slate-800 mb-2 leading-tight group-hover:text-accent transition-colors">
                          {grant.title}
                        </h4>
                        <p className="text-sm text-slate-600 mb-4 line-clamp-2 leading-relaxed">{grant.description}</p>
                        
                        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 mb-4 border-t border-slate-50 pt-3">
                          <span className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded">
                            Deadline: <span className={grant.deadline.includes('202') ? 'text-green-600' : ''}>{grant.deadline}</span>
                          </span>

                          {grant.preProposalDeadline && (
                            <span className="flex items-center gap-1 bg-orange-50 text-orange-700 px-2 py-1 rounded border border-orange-100" title="Pre-qualification or Draft Deadline">
                              <AlertTriangle className="w-3 h-3" />
                              Pre-qual: <span className="font-bold">{grant.preProposalDeadline}</span>
                            </span>
                          )}

                          {grant.amount !== 'N/A' && (
                            <span className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded">
                              Funding: <span className="text-slate-700">{grant.amount}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Expanded Content Section */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 pt-4 mb-4 bg-slate-50/50 -mx-5 px-5 pb-5">
                            <h5 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                              <Target className="w-4 h-4 text-accent" /> Submission Conditions & KPIs
                            </h5>
                            <div className="grid grid-cols-1 gap-4 mb-4">
                              {grant.eligibility && (
                                <div className="text-sm">
                                  <span className="font-semibold text-slate-700 block text-xs uppercase tracking-wider mb-1">Eligibility</span>
                                  <p className="text-slate-600">{grant.eligibility}</p>
                                </div>
                              )}
                              {grant.kpis && (
                                <div className="text-sm">
                                  <span className="font-semibold text-slate-700 block text-xs uppercase tracking-wider mb-1">Expected KPIs</span>
                                  <p className="text-slate-600">{grant.kpis}</p>
                                </div>
                              )}
                            </div>

                            {grant.detailedDescription && (
                              <div className="mb-4">
                                <span className="font-semibold text-slate-700 block text-xs uppercase tracking-wider mb-1">Detailed Info</span>
                                <p className="text-sm text-slate-600 leading-relaxed">{grant.detailedDescription}</p>
                              </div>
                            )}

                            {grant.documents && grant.documents.length > 0 && (
                              <div className="mt-4">
                                <span className="font-semibold text-slate-700 block text-xs uppercase tracking-wider mb-2">Downloadable Documents</span>
                                <div className="flex flex-col gap-2">
                                    {grant.documents.map((doc, i) => (
                                      <a 
                                        key={i} 
                                        href={doc.url} 
                                        target="_blank" 
                                        rel="noreferrer"
                                        className="flex items-center gap-3 p-2 bg-white border border-slate-200 rounded hover:border-accent group transition-colors"
                                      >
                                        <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-accent">
                                          {doc.type === 'pdf' ? <FileText className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                                        </div>
                                        <div className="flex-1">
                                          <p className="text-sm font-medium text-slate-700 group-hover:text-accent">{doc.name}</p>
                                          <p className="text-[10px] text-slate-400 uppercase">{doc.type || 'Web Resource'}</p>
                                        </div>
                                      </a>
                                    ))}
                                </div>
                              </div>
                            )}
                        </div>
                      )}

                      <button 
                        onClick={() => onAddToOpenCalls(grant)}
                        disabled={isAdded}
                        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 group ${
                          isAdded 
                            ? 'bg-green-100 text-green-700 cursor-default' 
                            : 'bg-slate-900 text-white hover:bg-accent'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check className="w-4 h-4" /> Added to Open Calls
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" /> Add to Open Calls
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {loading && (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <Cpu className="w-8 h-8 text-accent animate-bounce mb-2 opacity-50" />
                <p className="text-xs text-slate-400 font-mono animate-pulse">{currentAction}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FindFunding;