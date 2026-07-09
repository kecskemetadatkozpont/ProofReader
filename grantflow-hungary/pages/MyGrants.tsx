import React, { useState } from 'react';
import { Grant, GrantStatus } from '../types';
import { Calendar, Briefcase, ArrowRight, Activity, LayoutList, CalendarDays } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import GrantCalendar from '../components/GrantCalendar';

interface MyGrantsProps {
  grants: Grant[];
}

const MyGrants: React.FC<MyGrantsProps> = ({ grants }) => {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const navigate = useNavigate();

  const getStatusColor = (status: GrantStatus) => {
    switch (status) {
      case GrantStatus.DISCOVERED: return 'bg-gray-100 text-gray-700';
      case GrantStatus.PLANNING: return 'bg-blue-100 text-blue-700';
      case GrantStatus.DRAFTING: return 'bg-purple-100 text-purple-700';
      case GrantStatus.SUBMITTED: return 'bg-amber-100 text-amber-700';
      case GrantStatus.AWARDED: return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-500';
    }
  };

  const handleCalendarClick = (grant: Grant) => {
    navigate(`/grant/${grant.id}`);
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-primary">My Applications</h2>
          <p className="text-slate-500">Manage your pipeline from discovery to submission.</p>
        </div>
        
        <div className="flex items-center gap-3">
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
           <button className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium">
             + Add Manually
           </button>
        </div>
      </header>

      {viewMode === 'calendar' ? (
        <GrantCalendar grants={grants} onGrantClick={handleCalendarClick} />
      ) : (
        <div className="grid gap-4">
          {grants.map((grant) => (
            <div key={grant.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow flex flex-col md:flex-row gap-6 items-start md:items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${getStatusColor(grant.status)}`}>
                    {grant.status}
                  </span>
                  {grant.amount && (
                    <span className="text-sm font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded">
                      {grant.amount}
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">{grant.title}</h3>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1"><Briefcase className="w-4 h-4" /> {grant.funder}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> Due: {grant.deadline}</span>
                  {grant.matchScore && (
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <Activity className="w-4 h-4" /> {grant.matchScore}% Match
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-3 w-full md:w-auto">
                <Link 
                  to={`/grant/${grant.id}`}
                  className="flex-1 md:flex-none text-center bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-lg hover:border-accent hover:text-accent transition-all font-medium flex items-center justify-center gap-2"
                >
                  Manage Process <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))}

          {grants.length === 0 && (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-500">No active grants found. Go to "Find Funding" to start.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyGrants;