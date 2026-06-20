import React, { useState } from 'react';
import { Users, BookOpen, Award, AlertTriangle, FileText, Activity, Clock, Heart, Send, TrendingUp, TrendingDown, Smile } from 'lucide-react';
import { Student, StudentStatus } from '../types';
import { KpiCard } from './KpiCard';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, AreaChart, Area, CartesianGrid } from 'recharts';

interface DashboardProps {
  students: Student[];
}

export const Dashboard: React.FC<DashboardProps> = ({ students }) => {
  const [pulseCheckSent, setPulseCheckSent] = useState(false);
  const activeCount = students.filter(s => s.status === StudentStatus.ACTIVE).length;
  const absCount = students.filter(s => s.status === StudentStatus.ABS).length;
  
  // Calculate dynamic KPIs
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-11

  let totalPubs = 0;
  let totalRiskScore = 0;
  let activeStudentRiskCount = 0;
  let totalCreditsPerSemester = 0;
  let studentsWithCredits = 0;

  students.forEach(s => {
    // Count OWN publications
    const studentPubs = (s.publications || []).filter(p => p.category === 'OWN').length;
    totalPubs += studentPubs;

    if (s.status === StudentStatus.ACTIVE) {
      // Calculate semesters passed (approximate)
      let semesters = (currentYear - s.enrollmentYear) * 2;
      if (currentMonth >= 8) semesters += 1; // Fall semester started
      if (currentMonth < 2 && semesters > 0) semesters -= 1; // Spring hasn't really started crediting yet
      if (semesters < 1) semesters = 1;

      // Avg Credits / Semester
      const cps = s.totalCredits / semesters;
      totalCreditsPerSemester += cps;
      studentsWithCredits++;

      // Risk Calculation (Mock Logic)
      let risk = 0;
      const expectedCredits = semesters * 30; // Standard 30 credits per semester
      
      // Credit Risk
      if (s.totalCredits < expectedCredits * 0.6) risk += 50;
      else if (s.totalCredits < expectedCredits * 0.85) risk += 25;

      // Publication Risk (Expect at least 1 pub after 4 semesters)
      if (semesters >= 4 && studentPubs < 1) risk += 30;
      
      // Milestone Risk (Any failed milestone)
      if (s.milestones.some(m => m.status === 'Sikertelen')) risk += 20;

      totalRiskScore += Math.min(100, risk);
      activeStudentRiskCount++;
    }
  });

  const avgRiskScore = activeStudentRiskCount > 0 ? Math.round(totalRiskScore / activeStudentRiskCount) : 0;
  const avgCreditsPerSem = studentsWithCredits > 0 ? Math.round(totalCreditsPerSemester / studentsWithCredits) : 0;

  // Chart Data
  const statusData = [
    { name: 'Aktív', value: activeCount, color: '#2563eb' },
    { name: 'Abszolutórium', value: absCount, color: '#8b5cf6' },
    { name: 'Egyéb', value: students.length - activeCount - absCount, color: '#94a3b8' },
  ];

  const progressData = students.map(s => ({
    name: s.name.split(' ')[0] + ' ' + s.name.split(' ')[1].charAt(0) + '.',
    credits: s.totalCredits,
    target: 240
  }));

  // Mood Monitor Data (Mock)
  const moodHistory = [
    { week: '37. hét', stress: 2.1, satisfaction: 4.2 },
    { week: '38. hét', stress: 2.4, satisfaction: 4.0 },
    { week: '39. hét', stress: 3.8, satisfaction: 3.2 }, // Deadline spike
    { week: '40. hét', stress: 3.2, satisfaction: 3.6 },
    { week: '41. hét', stress: 2.8, satisfaction: 3.9 },
  ];

  const handleSendPulseCheck = () => {
    setPulseCheckSent(true);
    setTimeout(() => setPulseCheckSent(false), 3000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Átlag Kredit / Félév" 
          value={avgCreditsPerSem} 
          icon={<Clock size={24} />} 
          trend={avgCreditsPerSem >= 25 ? "+Megfelelő" : "-Alacsony"} 
          trendUp={avgCreditsPerSem >= 25} 
          color="blue"
        />
        <KpiCard 
          title="Összes Publikáció" 
          value={totalPubs} 
          icon={<FileText size={24} />} 
          trend="+3 az elmúlt hónapban" 
          trendUp={true} 
          color="purple"
        />
        <KpiCard 
          title="Átlagos Kockázat" 
          value={`${avgRiskScore}/100`} 
          icon={<Activity size={24} />} 
          trend={avgRiskScore < 30 ? "Stabil" : "Beavatkozás szükséges"}
          trendUp={avgRiskScore < 30}
          color={avgRiskScore > 50 ? "red" : "green"}
        />
        <KpiCard 
          title="Veszélyeztetett Hallgatók" 
          value={students.filter(s => s.status === StudentStatus.ACTIVE && ((s.totalCredits / ((currentYear - s.enrollmentYear) * 2 || 1)) < 20)).length} 
          icon={<AlertTriangle size={24} />} 
          trend="Kreditelmaradás miatt"
          trendUp={false}
          color="red"
        />
      </div>

      {/* Mood Monitor Section */}
      <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-xl shadow-sm border border-indigo-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
             <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
               <Heart className="text-rose-500" fill="currentColor" size={24} />
               Anonim Hangulat-monitor
             </h3>
             <p className="text-slate-500 text-sm mt-1">Heti "Pulse Check" aggregált eredmények és stressz-szint monitorozás.</p>
          </div>
          <button 
            onClick={handleSendPulseCheck}
            disabled={pulseCheckSent}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-sm
              ${pulseCheckSent 
                ? 'bg-green-100 text-green-700 cursor-default' 
                : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300'}`}
          >
            {pulseCheckSent ? (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Kiküldve
              </>
            ) : (
              <>
                <Send size={16} />
                Heti Pulse Check Kiküldése
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           {/* Chart */}
           <div className="lg:col-span-2 bg-white p-4 rounded-xl border border-slate-100 shadow-sm h-64">
              <h4 className="text-sm font-semibold text-slate-600 mb-4">Trendek (Utolsó 5 hét)</h4>
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={moodHistory} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorStress" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorSat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} domain={[0, 5]} />
                    <Tooltip 
                      contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                    />
                    <Legend iconType="circle" />
                    <Area type="monotone" dataKey="stress" name="Átlagos Stressz (1-5)" stroke="#f43f5e" fillOpacity={1} fill="url(#colorStress)" strokeWidth={2} />
                    <Area type="monotone" dataKey="satisfaction" name="Elégedettség (1-5)" stroke="#10b981" fillOpacity={1} fill="url(#colorSat)" strokeWidth={2} />
                 </AreaChart>
              </ResponsiveContainer>
           </div>

           {/* Insights / Alert */}
           <div className="space-y-4">
              {/* Current Status */}
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
                 <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide font-bold">E heti Átlag</p>
                    <div className="flex items-baseline gap-2 mt-1">
                       <span className="text-2xl font-bold text-slate-800">2.8</span>
                       <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <TrendingDown size={12} /> -0.4
                       </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Skála: 1 (Alacsony) - 5 (Magas)</p>
                 </div>
                 <div className="p-3 bg-green-50 rounded-full text-green-500">
                    <Smile size={28} />
                 </div>
              </div>

              {/* Alert Box */}
              <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                 <div className="flex items-start gap-3">
                    <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />
                    <div>
                       <h4 className="font-bold text-amber-900 text-sm">Figyelem: Biológia DI</h4>
                       <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                          A Biológia Doktori Iskolában <strong>15%-kal nőtt</strong> a jelentett stressz szint az elmúlt héten. Lehetséges ok: Közeleg a féléves beszámoló határideje.
                       </p>
                       <button className="mt-3 text-xs font-bold text-amber-700 hover:text-amber-900 underline">
                          Részletes adatok megtekintése
                       </button>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Hallgatói Státusz Eloszlás</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Kredit Előrehaladás</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={progressData}>
                <XAxis dataKey="name" fontSize={12} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="credits" name="Megszerzett Kredit" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="target" name="Cél" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
