import React, { useState } from 'react';
import { MOCK_SUPERVISORS } from '../constants';
import { Supervisor } from '../types';
import { SupervisorDetailModal } from './SupervisorDetailModal';
import { Search } from 'lucide-react';

export const SupervisorList: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupervisor, setSelectedSupervisor] = useState<Supervisor | null>(null);

  const filteredSupervisors = MOCK_SUPERVISORS.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.researchInterests.some(i => i.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="animate-fade-in space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Témavezetők</h2>
      </div>

       <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Keresés név, tanszék vagy kutatási terület alapján..." 
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all bg-slate-50 text-slate-900 placeholder-slate-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSupervisors.map(supervisor => (
          <div 
            key={supervisor.id}
            onClick={() => setSelectedSupervisor(supervisor)}
            className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group flex flex-col h-full"
          >
            <div className="flex items-center gap-4 mb-4">
               <img src={supervisor.avatarUrl} alt={supervisor.name} className="w-16 h-16 rounded-full object-cover border-2 border-slate-100 group-hover:border-blue-200" />
               <div>
                 <h3 className="font-bold text-lg text-slate-900 group-hover:text-blue-600 transition-colors">{supervisor.name}</h3>
                 <p className="text-xs text-slate-500">{supervisor.department}</p>
               </div>
            </div>
            
            <div className="mb-4 flex-1">
               <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kutatási Területek</h4>
               <div className="flex flex-wrap gap-2">
                 {supervisor.researchInterests.slice(0, 3).map(tag => (
                   <span key={tag} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md">
                      {tag}
                   </span>
                 ))}
                 {supervisor.researchInterests.length > 3 && (
                    <span className="px-2 py-1 bg-slate-100 text-slate-400 text-xs rounded-md">+{supervisor.researchInterests.length - 3}</span>
                 )}
               </div>
            </div>

            <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
               <div className="text-xs text-slate-500">
                  <span className="font-bold text-slate-700">{supervisor.publications.length}</span> publikáció
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${supervisor.capacityCurrent >= supervisor.capacityMax ? 'bg-red-500' : 'bg-green-500'}`}
                      style={{ width: `${(supervisor.capacityCurrent / supervisor.capacityMax) * 100}%` }}
                    ></div>
                 </div>
                 <span className="text-xs font-bold text-slate-600">{supervisor.capacityCurrent}/{supervisor.capacityMax}</span>
               </div>
            </div>
          </div>
        ))}
      </div>

      {selectedSupervisor && (
        <SupervisorDetailModal 
          supervisor={selectedSupervisor} 
          onClose={() => setSelectedSupervisor(null)} 
        />
      )}
    </div>
  );
}
