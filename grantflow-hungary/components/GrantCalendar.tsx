import React, { useState } from 'react';
import { Grant } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, LayoutGrid, List, ChevronRight as ChevronRightIcon } from 'lucide-react';

interface GrantCalendarProps {
  grants: Grant[];
  onGrantClick: (grant: Grant) => void;
}

const GrantCalendar: React.FC<GrantCalendarProps> = ({ grants, onGrantClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay(); // 0 is Sunday
  
  // Adjust for Monday start (standard in EU/Hungary)
  const startingDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const prevStep = () => {
    if (viewMode === 'list') {
      // In list view, jump by year
      setCurrentDate(new Date(currentDate.getFullYear() - 1, 0, 1));
    } else {
      // In grid view, jump by month
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    }
  };

  const nextStep = () => {
    if (viewMode === 'list') {
      // In list view, jump by year
      setCurrentDate(new Date(currentDate.getFullYear() + 1, 0, 1));
    } else {
      // In grid view, jump by month
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    }
  };

  const getGrantsForDay = (day: number) => {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${month}-${dayStr}`;

    return grants.filter(g => g.deadline.includes(dateStr));
  };

  const renderDays = () => {
    const days = [];
    // Padding for previous month
    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-32 bg-slate-50 border border-slate-100/50"></div>);
    }

    // Days of current month
    for (let i = 1; i <= daysInMonth; i++) {
      const dailyGrants = getGrantsForDay(i);
      const isToday = new Date().toDateString() === new Date(currentDate.getFullYear(), currentDate.getMonth(), i).toDateString();

      days.push(
        <div key={i} className={`h-32 border border-slate-100 p-2 relative group hover:bg-slate-50 transition-colors ${isToday ? 'bg-blue-50/30' : 'bg-white'}`}>
          <div className={`text-sm font-semibold mb-1 ${isToday ? 'text-accent' : 'text-slate-400'}`}>
            {i}
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[90px] custom-scrollbar">
            {dailyGrants.map(grant => (
              <button
                key={grant.id}
                onClick={(e) => { e.stopPropagation(); onGrantClick(grant); }}
                className="w-full text-left bg-blue-100 text-blue-800 text-[10px] p-1.5 rounded border border-blue-200 hover:bg-blue-200 hover:border-blue-300 transition-colors truncate block"
                title={grant.title}
              >
                {grant.title}
              </button>
            ))}
          </div>
          {dailyGrants.length === 0 && (
             <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                <PlusIcon className="w-4 h-4 text-slate-200" />
             </div>
          )}
        </div>
      );
    }
    return days;
  };

  const renderListView = () => {
    const year = currentDate.getFullYear();
    
    // Find grants in this YEAR
    const yearlyGrants = grants.filter(g => g.deadline.startsWith(`${year}-`));
    
    // Sort by date
    yearlyGrants.sort((a, b) => a.deadline.localeCompare(b.deadline));

    if (yearlyGrants.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <CalendarIcon className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-lg font-medium">No deadlines found for {year}.</p>
                <p className="text-sm">Try navigating to a different year.</p>
            </div>
        );
    }

    // Group by Month
    const groupedByMonth: { [key: number]: Grant[] } = {};
    yearlyGrants.forEach(grant => {
        const monthIndex = parseInt(grant.deadline.split('-')[1]) - 1; // 0-based index
        if (!groupedByMonth[monthIndex]) {
            groupedByMonth[monthIndex] = [];
        }
        groupedByMonth[monthIndex].push(grant);
    });

    return (
        <div className="overflow-y-auto max-h-[600px] custom-scrollbar pb-6">
            {Object.keys(groupedByMonth).map(monthIndexStr => {
                const monthIndex = parseInt(monthIndexStr);
                const monthGrants = groupedByMonth[monthIndex];

                return (
                    <div key={monthIndex} className="animate-in fade-in duration-500">
                        {/* Month Sticky Header */}
                        <div className="bg-slate-100 px-4 py-2 border-y border-slate-200 sticky top-0 z-10 font-bold text-slate-700 text-sm flex items-center gap-2">
                           <CalendarIcon className="w-4 h-4 text-slate-400" />
                           {monthNames[monthIndex]} {year}
                        </div>
                        
                        <div className="divide-y divide-slate-100">
                           {monthGrants.map(grant => {
                                const dateParts = grant.deadline.split('-');
                                const day = parseInt(dateParts[2]);
                                const dateObj = new Date(grant.deadline);
                                const dayName = isNaN(dateObj.getTime()) ? '' : dayNames[dateObj.getDay()];
                                const isToday = new Date().toDateString() === dateObj.toDateString();

                                return (
                                    <div 
                                        key={grant.id} 
                                        onClick={() => onGrantClick(grant)}
                                        className={`flex items-center gap-4 p-4 hover:bg-slate-50 cursor-pointer transition-colors group ${isToday ? 'bg-blue-50/30' : ''}`}
                                    >
                                        <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-lg border flex-shrink-0 ${isToday ? 'bg-accent text-white border-accent' : 'bg-white border-slate-200 text-slate-600'}`}>
                                            <span className="text-[10px] font-bold uppercase">{monthNames[monthIndex].substring(0, 3)}</span>
                                            <span className="text-xl font-bold leading-none">{day}</span>
                                        </div>
                                        
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-slate-800 group-hover:text-accent transition-colors truncate">{grant.title}</h4>
                                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                                <span className="font-medium text-slate-400">{dayName}</span>
                                                <span className="text-slate-300">•</span>
                                                <span className="truncate">{grant.funder}</span>
                                            </div>
                                        </div>

                                        <div className="text-right flex items-center gap-3">
                                            {grant.amount && grant.amount !== 'N/A' && (
                                                <span className="hidden md:inline-block px-2 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded">
                                                    {grant.amount}
                                                </span>
                                            )}
                                            <ChevronRightIcon className="w-4 h-4 text-slate-300" />
                                        </div>
                                    </div>
                                );
                           })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
           <CalendarIcon className="w-5 h-5 text-primary" />
           <h3 className="font-bold text-lg text-slate-800">
             {viewMode === 'list' 
               ? `Agenda ${currentDate.getFullYear()}` 
               : `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
           </h3>
        </div>
        <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex bg-white rounded-lg border border-slate-200 p-0.5">
                <button 
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-slate-100 text-accent' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Grid View (Month)"
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
                <button 
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-slate-100 text-accent' : 'text-slate-400 hover:text-slate-600'}`}
                    title="List View (Year)"
                >
                    <List className="w-4 h-4" />
                </button>
            </div>

            <div className="h-4 w-px bg-slate-300"></div>

            <div className="flex gap-2">
            <button onClick={prevStep} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all text-slate-600">
                <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="text-xs font-medium px-3 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all text-slate-600">
                Today
            </button>
            <button onClick={nextStep} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all text-slate-600">
                <ChevronRight className="w-5 h-5" />
            </button>
            </div>
        </div>
      </div>

      {viewMode === 'grid' ? (
          <>
            {/* Weekday Headers */}
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase text-center py-2">
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
                <div>Sun</div>
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 bg-slate-100 gap-px border-b border-slate-200">
                {renderDays()}
            </div>
          </>
      ) : (
          renderListView()
      )}
      
      <div className="p-3 text-xs text-slate-400 text-center bg-slate-50">
         Showing deadlines based on "YYYY-MM-DD" format in grant data.
      </div>
    </div>
  );
};

const PlusIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);

export default GrantCalendar;