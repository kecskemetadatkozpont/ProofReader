import React from 'react';
import { Supervisor } from '../types';
import { X, BookOpen, Users, GraduationCap, Award, BrainCircuit } from 'lucide-react';

interface SupervisorDetailModalProps {
  supervisor: Supervisor & { matchScore?: number; reasoning?: string };
  onClose: () => void;
}

export const SupervisorDetailModal: React.FC<SupervisorDetailModalProps> = ({ supervisor, onClose }) => {
  const capacityPercent = (supervisor.capacityCurrent / supervisor.capacityMax) * 100;
  const isOverloaded = supervisor.capacityCurrent >= supervisor.capacityMax;
  const showMatchingInfo = supervisor.matchScore !== undefined;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="relative bg-slate-900 text-white p-6 pb-12">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
          <div className="flex items-center gap-4">
             <img 
               src={supervisor.avatarUrl} 
               alt={supervisor.name} 
               className="w-20 h-20 rounded-full border-4 border-white/20 shadow-lg"
             />
             <div>
               <h2 className="text-2xl font-bold">{supervisor.name}</h2>
               <p className="text-blue-300 font-medium">{supervisor.department}</p>
             </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 -mt-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-6">
            <div className={`grid gap-6 ${showMatchingInfo ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* Match Score - only if available */}
              {showMatchingInfo && (
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                   <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Illeszkedés</div>
                   <div className={`text-3xl font-bold ${
                      (supervisor.matchScore || 0) > 75 ? 'text-green-600' : (supervisor.matchScore || 0) > 50 ? 'text-amber-600' : 'text-slate-400'
                   }`}>
                      {supervisor.matchScore || 0}%
                   </div>
                </div>
              )}
              
              {/* Capacity */}
              <div className="p-3 bg-slate-50 rounded-lg">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kapacitás</span>
                    <span className={`text-xs font-bold ${isOverloaded ? 'text-red-600' : 'text-slate-700'}`}>
                      {supervisor.capacityCurrent} / {supervisor.capacityMax} hallgató
                    </span>
                 </div>
                 <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div 
                       className={`h-full rounded-full ${isOverloaded ? 'bg-red-500' : 'bg-green-500'}`} 
                       style={{ width: `${Math.min(capacityPercent, 100)}%` }}
                    ></div>
                 </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Reasoning - only if available */}
            {supervisor.reasoning && (
              <div>
                <h3 className="flex items-center gap-2 font-bold text-slate-800 mb-2">
                  <BrainCircuit size={18} className="text-indigo-600"/>
                  AI Elemzés
                </h3>
                <div className="bg-indigo-50 text-indigo-900 p-4 rounded-lg text-sm leading-relaxed border border-indigo-100">
                  {supervisor.reasoning}
                </div>
              </div>
            )}

            {/* Research Interests */}
            <div>
              <h3 className="flex items-center gap-2 font-bold text-slate-800 mb-3">
                <GraduationCap size={18} className="text-slate-600"/>
                Kutatási Területek
              </h3>
              <div className="flex flex-wrap gap-2">
                {supervisor.researchInterests.map((interest, idx) => (
                  <span key={idx} className="px-3 py-1 bg-slate-100 text-slate-700 text-sm rounded-full border border-slate-200">
                    {interest}
                  </span>
                ))}
              </div>
            </div>

            {/* Publications */}
            <div>
              <h3 className="flex items-center gap-2 font-bold text-slate-800 mb-3">
                <BookOpen size={18} className="text-slate-600"/>
                Kiemelt Publikációk (Scopus/MTMT)
              </h3>
              <ul className="space-y-3">
                {supervisor.publications.map((pub, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-slate-600 group hover:bg-slate-50 p-2 rounded transition-colors">
                    <Award size={16} className="text-slate-400 mt-1 flex-shrink-0 group-hover:text-blue-500" />
                    <span className="italic">"{pub}"</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 font-medium transition-colors"
          >
            Bezárás
          </button>
        </div>
      </div>
    </div>
  );
};
