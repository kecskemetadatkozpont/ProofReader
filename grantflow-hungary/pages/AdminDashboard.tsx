import React, { useState } from 'react';
import { Grant, GrantStatus, Task, KpiMetric } from '../types';
import { Shield, Activity, Users, FileText, CheckCircle, AlertCircle, ChevronDown, ChevronUp, User, Euro, File, Paperclip, ShieldCheck, ShieldAlert, Target, Settings, X, Send, Save, Bell, Globe } from 'lucide-react';
import StatsCard from '../components/StatsCard';

interface AdminDashboardProps {
  grants: Grant[];
  onUpdateGrant: (grant: Grant) => void;
}

// Mock User Data Structure
interface UserActivity {
  id: string;
  name: string;
  department: string;
  role: string;
  activeGrantId: string; // Linking to a grant in our system
  lastActive: string;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ grants, onUpdateGrant }) => {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  
  // Modal State
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [activeModalTab, setActiveModalTab] = useState<'edit' | 'broadcast'>('edit');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSent, setBroadcastSent] = useState(false);
  
  // Temporary state for the form
  const [tempGrantData, setTempGrantData] = useState<Partial<Grant>>({});

  // MOCK DATA: Simulate users working on the existing grants
  const userActivities: UserActivity[] = [
    { id: 'u1', name: 'Dr. Kovács János', department: 'Computer Science', role: 'Senior Researcher', activeGrantId: grants[0]?.id || '1', lastActive: '2 mins ago' },
    { id: 'u2', name: 'Prof. Szabó Anna', department: 'Biology', role: 'Head of Dept', activeGrantId: grants[1]?.id || '2', lastActive: '15 mins ago' },
    { id: 'u3', name: 'Dr. Nagy Péter', department: 'Physics', role: 'Postdoc', activeGrantId: grants[2]?.id || '3', lastActive: '1 hour ago' },
  ];

  // Helper to get grant for user
  const getGrantForUser = (grantId: string) => grants.find(g => g.id === grantId);

  // Helper to calculate progress
  const calculateProgress = (tasks?: Task[]) => {
    if (!tasks || tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.completed).length;
    return Math.round((completed / tasks.length) * 100);
  };

  const getStatusColor = (status: GrantStatus) => {
    switch (status) {
      case GrantStatus.PLANNING: return 'bg-blue-100 text-blue-700';
      case GrantStatus.DRAFTING: return 'bg-purple-100 text-purple-700';
      case GrantStatus.SUBMITTED: return 'bg-green-100 text-green-700';
      case GrantStatus.AWARDED: return 'bg-emerald-100 text-emerald-800';
      case GrantStatus.DISCOVERED: return 'bg-slate-100 text-slate-700';
      default: return 'bg-slate-100 text-slate-500';
    }
  };

  const getKpiStats = (kpis?: KpiMetric[]) => {
    if (!kpis) return { met: 0, pending: 0, risk: 0, total: 0 };
    return {
      met: kpis.filter(k => k.status === 'met').length,
      pending: kpis.filter(k => k.status === 'pending').length,
      risk: kpis.filter(k => k.status === 'risk').length,
      total: kpis.length
    };
  };

  const toggleRow = (userId: string) => {
    setExpandedRowId(expandedRowId === userId ? null : userId);
  };

  const openGrantManager = (e: React.MouseEvent, grant: Grant) => {
    e.stopPropagation();
    setEditingGrantId(grant.id);
    setTempGrantData({ ...grant });
    setBroadcastMessage('');
    setBroadcastSent(false);
    setActiveModalTab('edit');
  };

  const handleSaveGrant = () => {
    if (!editingGrantId) return;
    const original = grants.find(g => g.id === editingGrantId);
    if (!original) return;

    onUpdateGrant({ ...original, ...tempGrantData });
    setEditingGrantId(null);
  };

  const handleBroadcast = () => {
    // In a real app, this would send a WebSocket message or email
    if (!broadcastMessage.trim()) return;
    setBroadcastSent(true);
    setTimeout(() => {
        setBroadcastSent(false);
        setBroadcastMessage('');
    }, 3000);
  };

  return (
    <div className="space-y-6 animate-fade-in relative">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Shield className="w-6 h-6 text-uni-red" />
            Central Research Oversight
          </h2>
          <p className="text-slate-500">
            Real-time monitoring and management of all university grant applications.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100">
           <Activity className="w-4 h-4" />
           <span className="font-bold">System Active</span>
        </div>
      </header>

      {/* Admin Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatsCard 
          title="Active Researchers" 
          value={userActivities.length + 12} // Mock total
          icon={<Users className="w-6 h-6 text-blue-600" />} 
          trend="Currently Online" 
          trendUp={true} 
        />
        <StatsCard 
          title="Total Potential Funding" 
          value="€8.4M" 
          icon={<Euro className="w-6 h-6 text-green-600" />} 
          trend="Combined Drafts" 
          trendUp={true} 
        />
        <StatsCard 
          title="Applications in Progress" 
          value={grants.filter(g => g.status !== 'SUBMITTED').length + 5} 
          icon={<FileText className="w-6 h-6 text-purple-600" />} 
          trend="Across 5 Departments" 
          trendUp={true} 
        />
        <StatsCard 
          title="Critical KPI Risks" 
          value="2" 
          icon={<AlertCircle className="w-6 h-6 text-red-600" />} 
          trend="Requires Attention" 
          trendUp={false} 
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* MAIN TABLE */}
        <div className="xl:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
             <h3 className="font-bold text-slate-800">Active Projects by Researcher</h3>
             <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Last updated: Just now</div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider bg-white">
                  <th className="px-6 py-3 font-semibold">Researcher / Dept</th>
                  <th className="px-6 py-3 font-semibold">Project</th>
                  <th className="px-6 py-3 font-semibold text-center">Progress</th>
                  <th className="px-6 py-3 font-semibold">KPI Health</th>
                  <th className="px-6 py-3 font-semibold text-center">Manage</th>
                  <th className="px-6 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {userActivities.map(user => {
                  const grant = getGrantForUser(user.activeGrantId);
                  if (!grant) return null;
                  
                  const progress = calculateProgress(grant.tasks);
                  const isExpanded = expandedRowId === user.id;
                  const kpiStats = getKpiStats(grant.liveKpis);

                  return (
                    <React.Fragment key={user.id}>
                      <tr 
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
                        onClick={() => toggleRow(user.id)}
                      >
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 border-2 border-white shadow-sm">
                                 <User className="w-5 h-5" />
                              </div>
                              <div>
                                 <div className="font-bold text-slate-800 text-sm">{user.name}</div>
                                 <div className="text-xs text-slate-500">{user.department}</div>
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           <div className="font-medium text-slate-800 text-sm truncate max-w-[200px]" title={grant.title}>{grant.title}</div>
                           <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(grant.status)}`}>
                              {grant.status}
                           </span>
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex flex-col items-center gap-1">
                              <span className="text-xs font-bold text-slate-700">{progress}%</span>
                              <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                 <div 
                                    className="h-full bg-accent rounded-full" 
                                    style={{ width: `${progress}%` }}
                                 ></div>
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                            {kpiStats.total === 0 ? (
                                <span className="text-xs text-slate-400 italic">No KPIs set</span>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {kpiStats.risk > 0 && (
                                        <div className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-bold border border-red-100" title={`${kpiStats.risk} At Risk`}>
                                            <ShieldAlert className="w-3 h-3" /> {kpiStats.risk}
                                        </div>
                                    )}
                                    {kpiStats.met > 0 && (
                                        <div className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-bold border border-green-100" title={`${kpiStats.met} Met`}>
                                            <ShieldCheck className="w-3 h-3" /> {kpiStats.met}
                                        </div>
                                    )}
                                    {kpiStats.pending > 0 && kpiStats.risk === 0 && kpiStats.met === 0 && (
                                        <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 text-slate-500 rounded text-xs font-bold border border-slate-200">
                                            <Activity className="w-3 h-3" /> {kpiStats.pending}
                                        </div>
                                    )}
                                </div>
                            )}
                        </td>
                        <td className="px-6 py-4 text-center">
                           <button 
                             onClick={(e) => openGrantManager(e, grant)}
                             className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                             title="Manage Grant Parameters"
                           >
                              <Settings className="w-4 h-4" />
                           </button>
                        </td>
                        <td className="px-6 py-4 text-right">
                           {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                        </td>
                      </tr>
                      
                      {/* EXPANDED DETAILS */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 animate-in fade-in duration-200">
                          <td colSpan={6} className="px-6 py-4 border-b border-slate-200">
                             <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pl-14">
                                {/* Tasks View */}
                                <div className="bg-white p-4 rounded-lg border border-slate-200">
                                   <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                      <CheckSquare className="w-4 h-4" /> Active Tasks
                                   </h4>
                                   <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                      {!grant.tasks || grant.tasks.length === 0 ? (
                                         <p className="text-xs text-slate-400 italic">No tasks assigned yet.</p>
                                      ) : (
                                         grant.tasks.map(task => (
                                            <div key={task.id} className="flex items-center gap-2 text-sm">
                                               {task.completed ? <CheckCircle className="w-4 h-4 text-green-500" /> : <div className="w-4 h-4 rounded-full border border-slate-300"></div>}
                                               <span className={task.completed ? 'text-slate-400 line-through' : 'text-slate-700'}>{task.title}</span>
                                            </div>
                                         ))
                                      )}
                                   </div>
                                </div>

                                {/* KPI View (New) */}
                                <div className="bg-white p-4 rounded-lg border border-slate-200">
                                   <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                      <Target className="w-4 h-4" /> KPI Monitor
                                   </h4>
                                   <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                      {!grant.liveKpis || grant.liveKpis.length === 0 ? (
                                         <p className="text-xs text-slate-400 italic">No KPIs tracked.</p>
                                      ) : (
                                         grant.liveKpis.map(kpi => (
                                            <div key={kpi.id} className="flex items-start gap-2 text-sm p-2 rounded border border-slate-50 hover:bg-slate-50">
                                               <div className="mt-0.5">
                                                  {kpi.status === 'met' ? <ShieldCheck className="w-4 h-4 text-green-500" /> :
                                                   kpi.status === 'risk' ? <ShieldAlert className="w-4 h-4 text-red-500" /> :
                                                   <div className="w-4 h-4 rounded-full border-2 border-slate-300"></div>}
                                               </div>
                                               <div>
                                                  <p className="text-xs font-bold text-slate-700 leading-tight">{kpi.name}</p>
                                                  <p className="text-[10px] text-slate-400">{kpi.currentValue} / {kpi.targetValue}</p>
                                               </div>
                                            </div>
                                         ))
                                      )}
                                   </div>
                                </div>

                                {/* Files View */}
                                <div className="bg-white p-4 rounded-lg border border-slate-200">
                                   <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                      <File className="w-4 h-4" /> Assets
                                   </h4>
                                   <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                      {!grant.knowledgeBase || grant.knowledgeBase.length === 0 ? (
                                         <p className="text-xs text-slate-400 italic">No files uploaded.</p>
                                      ) : (
                                         grant.knowledgeBase.map(asset => (
                                            <div key={asset.id} className="flex items-center justify-between text-sm p-2 bg-slate-50 rounded border border-slate-100">
                                               <div className="flex items-center gap-2 overflow-hidden">
                                                  <FileText className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                                  <span className="truncate">{asset.name}</span>
                                               </div>
                                               <span className="text-[10px] bg-white px-1 border rounded text-slate-500">{asset.type}</span>
                                            </div>
                                         ))
                                      )}
                                   </div>
                                </div>
                             </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* LIVE FEED SIDEBAR */}
        <div className="bg-slate-900 rounded-xl p-6 text-slate-300 flex flex-col h-full shadow-lg">
           <h3 className="font-bold text-white mb-4 flex items-center gap-2">
             <Activity className="w-5 h-5 text-accent" /> Live Feed
           </h3>
           <div className="space-y-6 overflow-y-auto flex-1 custom-scrollbar pr-2">
              <div className="relative pl-4 border-l border-slate-700">
                 <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-accent animate-ping opacity-75"></div>
                 <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-accent"></div>
                 <p className="text-xs font-bold text-white">Dr. Kovács János</p>
                 <p className="text-xs mt-1">Uploaded <span className="text-accent">Budget_Draft_v2.xlsx</span> to Horizon Europe Grant.</p>
                 <span className="text-[10px] text-slate-500 mt-1 block">Just now</span>
              </div>

              <div className="relative pl-4 border-l border-slate-700">
                 <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-slate-700"></div>
                 <p className="text-xs font-bold text-white">Prof. Szabó Anna</p>
                 <p className="text-xs mt-1">Marked task <span className="italic">"Ethics Approval"</span> as completed.</p>
                 <span className="text-[10px] text-slate-500 mt-1 block">15 mins ago</span>
              </div>

              <div className="relative pl-4 border-l border-slate-700">
                 <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-slate-700"></div>
                 <p className="text-xs font-bold text-white">Dr. Nagy Péter</p>
                 <p className="text-xs mt-1">Started new draft for <span className="text-white">NKFIH OTKA</span>.</p>
                 <span className="text-[10px] text-slate-500 mt-1 block">1 hour ago</span>
              </div>

              <div className="relative pl-4 border-l border-slate-700">
                 <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-slate-700"></div>
                 <p className="text-xs font-bold text-white">System AI</p>
                 <p className="text-xs mt-1">Generated 12 new tasks for <span className="text-white">ERC Advanced Grant</span>.</p>
                 <span className="text-[10px] text-slate-500 mt-1 block">2 hours ago</span>
              </div>
           </div>
        </div>
      </div>

      {/* --- GRANT MANAGEMENT MODAL --- */}
      {editingGrantId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]">
             {/* Modal Header */}
             <div className="p-6 border-b border-slate-100 flex justify-between items-start">
               <div>
                  <h3 className="text-xl font-bold text-slate-800">Grant Management Console</h3>
                  <p className="text-sm text-slate-500">Edit central parameters or broadcast messages to researchers.</p>
               </div>
               <button onClick={() => setEditingGrantId(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
               </button>
             </div>

             {/* Tabs */}
             <div className="flex border-b border-slate-100 px-6">
                <button 
                  onClick={() => setActiveModalTab('edit')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeModalTab === 'edit' ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <Settings className="w-4 h-4" /> Edit Parameters
                </button>
                <button 
                  onClick={() => setActiveModalTab('broadcast')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeModalTab === 'broadcast' ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <Bell className="w-4 h-4" /> Broadcast Message
                </button>
             </div>

             {/* Modal Body */}
             <div className="p-6 overflow-y-auto flex-1">
                {activeModalTab === 'edit' ? (
                   <div className="space-y-4">
                      {/* Central Warning Banner */}
                      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-4 flex items-center gap-3">
                         <Globe className="w-5 h-5 text-blue-600 flex-shrink-0" />
                         <p className="text-xs text-blue-800 font-medium">
                            Global Configuration: You are editing the master grant record. Changes to budget, deadlines, or requirements will instantly update for all {userActivities.filter(u => u.activeGrantId === editingGrantId).length + 2} researchers working on this project.
                         </p>
                      </div>

                      <div>
                         <label className="block text-sm font-bold text-slate-700 mb-1">Grant Title</label>
                         <input 
                           className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none"
                           value={tempGrantData.title || ''}
                           onChange={(e) => setTempGrantData({...tempGrantData, title: e.target.value})}
                         />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-sm font-bold text-slate-700 mb-1">Funder</label>
                           <input 
                             className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none"
                             value={tempGrantData.funder || ''}
                             onChange={(e) => setTempGrantData({...tempGrantData, funder: e.target.value})}
                           />
                        </div>
                        <div>
                           <label className="block text-sm font-bold text-slate-700 mb-1">Total Budget</label>
                           <input 
                             className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none"
                             value={tempGrantData.amount || ''}
                             onChange={(e) => setTempGrantData({...tempGrantData, amount: e.target.value})}
                           />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-sm font-bold text-slate-700 mb-1">Deadline</label>
                           <input 
                             type="date"
                             className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none"
                             value={tempGrantData.deadline || ''}
                             onChange={(e) => setTempGrantData({...tempGrantData, deadline: e.target.value})}
                           />
                        </div>
                        <div>
                           <label className="block text-sm font-bold text-slate-700 mb-1">Status</label>
                           <select 
                             className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none"
                             value={tempGrantData.status || GrantStatus.PLANNING}
                             onChange={(e) => setTempGrantData({...tempGrantData, status: e.target.value as GrantStatus})}
                           >
                             {Object.values(GrantStatus).map(s => <option key={s} value={s}>{s}</option>)}
                           </select>
                        </div>
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
                         <textarea 
                           className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-accent outline-none h-24 resize-none"
                           value={tempGrantData.description || ''}
                           onChange={(e) => setTempGrantData({...tempGrantData, description: e.target.value})}
                         />
                      </div>
                   </div>
                ) : (
                   <div className="space-y-4">
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex gap-3">
                         <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                         <div>
                            <h4 className="font-bold text-amber-800 text-sm">Broadcast to Researchers</h4>
                            <p className="text-xs text-amber-700 mt-1">
                               This message will be sent instantly to all researchers and PIs currently assigned to this grant project. Use this for urgent deadline changes or policy updates.
                            </p>
                         </div>
                      </div>
                      
                      {broadcastSent ? (
                        <div className="bg-green-50 border border-green-200 p-8 rounded-lg text-center animate-in zoom-in duration-300">
                           <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                           <h4 className="font-bold text-green-800">Message Sent Successfully!</h4>
                           <p className="text-sm text-green-600">Notified active researchers.</p>
                        </div>
                      ) : (
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Message Content</label>
                            <textarea 
                                className="w-full p-3 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-accent outline-none h-32 resize-none shadow-inner"
                                placeholder="e.g. Please note that the internal deadline has been extended by 48 hours due to the holiday..."
                                value={broadcastMessage}
                                onChange={(e) => setBroadcastMessage(e.target.value)}
                            />
                        </div>
                      )}
                   </div>
                )}
             </div>

             {/* Modal Footer */}
             <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end gap-3">
                <button 
                  onClick={() => setEditingGrantId(null)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                >
                   Close
                </button>
                {activeModalTab === 'edit' ? (
                   <button 
                     onClick={handleSaveGrant}
                     className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 flex items-center gap-2 shadow-sm"
                   >
                      <Save className="w-4 h-4" /> Save Global Changes
                   </button>
                ) : (
                   <button 
                     onClick={handleBroadcast}
                     disabled={!broadcastMessage.trim() || broadcastSent}
                     className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-blue-600 flex items-center gap-2 shadow-sm disabled:opacity-50"
                   >
                      <Send className="w-4 h-4" /> Send Broadcast
                   </button>
                )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Simple internal component for the CheckSquare used in details
const CheckSquare = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
);

export default AdminDashboard;