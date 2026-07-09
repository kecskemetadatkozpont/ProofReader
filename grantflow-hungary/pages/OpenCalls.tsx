import React, { useState } from 'react';
import { Grant } from '../types';
import { Plus, BadgeCheck, ShieldCheck, Clock, CalendarDays, Check, Loader2, Sparkles, ChevronDown, ChevronUp, Target, Users, FileText, Download, ExternalLink, LayoutList } from 'lucide-react';
import GrantCalendar from '../components/GrantCalendar';

interface OpenCallsProps {
  grants: Grant[];
  userGrants: Grant[];
  onAddGrant: (grant: Grant) => void;
}

const OpenCalls: React.FC<OpenCallsProps> = ({ grants, userGrants, onAddGrant }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  const handleAdd = (e: React.MouseEvent, grant: Grant) => {
    e.stopPropagation(); // Prevent toggling the card when clicking the button
    onAddGrant(grant);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  // When clicking on calendar item, switch to list view and expand the specific item
  const handleCalendarClick = (grant: Grant) => {
    setViewMode('list');
    setExpandedId(grant.id);
    // Use a small timeout to allow the list to render before scrolling
    setTimeout(() => {
        const element = document.getElementById(`grant-card-${grant.id}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex justify-between items-end pb-6 border-b border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
            <BadgeCheck className="w-6 h-6 text-accent" />
            Open Calls
          </h2>
          <p className="text-slate-500 mt-1">
            Official opportunities vetted by the Grant Office, ready for University application.
          </p>
        </div>
        <div className="flex items-center gap-4">
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
           <div className="hidden md:block">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-bold border border-green-100">
                <ShieldCheck className="w-4 h-4" />
                Verified by Office
              </span>
           </div>
        </div>
      </header>

      {viewMode === 'calendar' ? (
        <GrantCalendar grants={grants} onGrantClick={handleCalendarClick} />
      ) : (
        <div className="grid gap-4">
          {grants.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-500">No open calls available currently.</p>
            </div>
          ) : (
            grants.map((grant) => {
              const isAdded = userGrants.some(ug => ug.id === grant.id);
              const isAnalyzing = grant.processingStatus === 'analyzing';
              const isExpanded = expandedId === grant.id;
              
              return (
                <div 
                  key={grant.id}
                  id={`grant-card-${grant.id}`}
                  onClick={() => toggleExpand(grant.id)}
                  className={`bg-white rounded-xl border shadow-sm transition-all group relative overflow-hidden cursor-pointer ${
                    isExpanded ? 'border-accent ring-1 ring-accent/20 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  {/* Decoration Bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${isAnalyzing ? 'bg-orange-400 animate-pulse' : 'bg-accent'}`}></div>
                  
                  <div className="p-6">
                    <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center justify-between md:justify-start gap-3 mb-2">
                          <div className="flex items-center gap-3">
                            <span className="bg-blue-50 text-accent px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                              {grant.funder}
                            </span>
                            <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-orange-100">
                              Active
                            </span>
                          </div>
                          {/* Mobile chevron */}
                          <div className="md:hidden text-slate-400">
                             {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <h3 className="text-lg font-bold text-slate-800 mb-2 group-hover:text-accent transition-colors">
                            {grant.title}
                          </h3>
                          <div className="hidden md:block mt-1 transition-transform duration-300 text-slate-300 group-hover:text-accent">
                             {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>

                        <p className="text-slate-600 text-sm leading-relaxed mb-4 max-w-3xl">
                          {grant.description}
                        </p>

                        <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-4">
                          <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded">
                            <CalendarDays className="w-3.5 h-3.5" />
                            Internal Deadline: <span className="font-semibold text-slate-700">{grant.deadline}</span>
                          </div>
                          {grant.amount && (
                            <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded">
                              <Clock className="w-3.5 h-3.5" />
                              Budget: <span className="font-semibold text-slate-700">{grant.amount}</span>
                            </div>
                          )}
                        </div>

                        {/* AI Status Report Bar */}
                        {isAnalyzing && (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-center gap-3 animate-pulse">
                            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                            <div className="flex-1">
                              <p className="text-xs font-bold text-indigo-700">AI Status Report: Analysis Running</p>
                              <p className="text-[10px] text-indigo-600">Generating To-Do lists, extracting KPIs, and analyzing PM profile...</p>
                            </div>
                          </div>
                        )}

                        {grant.processingStatus === 'complete' && !isExpanded && (
                           <div className="flex items-center gap-2 text-xs text-green-600 font-medium">
                              <Sparkles className="w-3 h-3" /> AI Analysis & To-Do List Ready
                           </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-3 min-w-[140px]">
                        <button 
                          onClick={(e) => !isAdded && !isAnalyzing && handleAdd(e, grant)}
                          disabled={isAdded || isAnalyzing}
                          className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            isAdded 
                            ? 'bg-green-100 text-green-700 cursor-default' 
                            : isAnalyzing 
                              ? 'bg-slate-100 text-slate-400 cursor-wait'
                              : 'bg-slate-900 text-white hover:bg-accent'
                          }`}
                        >
                          {isAdded ? (
                            <>
                               <Check className="w-4 h-4" /> Added
                            </>
                          ) : isAnalyzing ? (
                            <>
                               <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                            </>
                          ) : (
                            <>
                               <Plus className="w-4 h-4" /> Add to My Apps
                            </>
                          )}
                        </button>
                        <div className="text-xs text-slate-400 text-right">
                           Ref ID: {grant.id.includes('auto') ? 'AI-SCAN' : grant.id.split('-')[1]}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="mt-6 pt-6 border-t border-slate-100 animate-in slide-in-from-top-2 duration-300">
                         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Left Column: Description & Eligibility */}
                            <div className="space-y-6">
                              {grant.detailedDescription && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-accent" /> Detailed Description
                                  </h4>
                                  <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100">
                                    {grant.detailedDescription}
                                  </p>
                                </div>
                              )}

                              {grant.eligibility && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-orange-500" /> Eligibility & Conditions
                                  </h4>
                                  <div className="text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-100">
                                    {grant.eligibility}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right Column: KPIs & Documents */}
                            <div className="space-y-6">
                               {grant.kpis && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Target className="w-4 h-4 text-green-600" /> Expected KPIs & Outputs
                                  </h4>
                                  <div className="text-sm text-slate-700 bg-green-50 p-3 rounded-lg border border-green-100">
                                    {grant.kpis}
                                  </div>
                                </div>
                              )}

                              <div>
                                 <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                   <Download className="w-4 h-4 text-blue-600" /> Official Documents
                                 </h4>
                                 {grant.documents && grant.documents.length > 0 ? (
                                   <div className="flex flex-col gap-2">
                                      {grant.documents.map((doc, i) => (
                                        <a 
                                          key={i} 
                                          href={doc.url} 
                                          target="_blank" 
                                          rel="noreferrer"
                                          onClick={(e) => e.stopPropagation()} // Allow clicking links without collapsing
                                          className="flex items-center gap-3 p-2 bg-white border border-slate-200 rounded hover:border-accent group transition-colors shadow-sm"
                                        >
                                           <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-accent">
                                             {doc.type === 'pdf' ? <FileText className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                                           </div>
                                           <div className="flex-1">
                                             <p className="text-sm font-medium text-slate-700 group-hover:text-accent">{doc.name}</p>
                                             <p className="text-[10px] text-slate-400 uppercase">{doc.type || 'Web Resource'}</p>
                                           </div>
                                        </a>
                                      ))}
                                   </div>
                                 ) : (
                                   <p className="text-sm text-slate-400 italic">No documents attached.</p>
                                 )}
                              </div>
                            </div>
                         </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          
          <div className="mt-8 p-6 bg-slate-100 rounded-xl border border-dashed border-slate-300 text-center">
             <p className="text-slate-500 text-sm">
               Looking for something else? Use the <strong className="text-slate-700">Find Funding</strong> tool to scan global databases.
             </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default OpenCalls;