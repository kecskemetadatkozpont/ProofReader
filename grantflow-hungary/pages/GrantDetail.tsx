import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Grant, Task, AiTaskResponse, GrantStatus, TaskAttachment, GrantAnalysis, KnowledgeAsset, TeamMember, KpiMetric } from '../types';
import { generateGrantPlan, draftProposalSection, analyzeGrantRequirements, verifyTeamMemberRequirement, evaluateLiveKpis } from '../services/geminiService';
import { Loader2, Wand2, CheckSquare, FileEdit, AlertCircle, ChevronDown, ChevronUp, Upload, File, X, Save, Paperclip, PenTool, Microscope, UserCheck, CalendarClock, Trophy, Users, History, FileText, Download, TrendingUp, GraduationCap, User, FolderOpen, Link as LinkIcon, Plus, Trash2, ShieldCheck, ShieldAlert, Activity, RefreshCw, Scale } from 'lucide-react';

interface GrantDetailProps {
  grants: Grant[];
  onUpdateGrant: (updatedGrant: Grant) => void;
}

const GrantDetail: React.FC<GrantDetailProps> = ({ grants, onUpdateGrant }) => {
  const { id } = useParams<{ id: string }>();
  const grant = grants.find(g => g.id === id);
  
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [draftSection, setDraftSection] = useState('Abstract');
  const [generatedDraft, setGeneratedDraft] = useState('');
  
  // Task Expansion State
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'files'>('editor');
  
  // Historical Expansion State
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  // Knowledge Base State
  const [kbFilter, setKbFilter] = useState<'all' | 'file' | 'link' | 'cv' | 'review'>('all');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const kbFileInputRef = useRef<HTMLInputElement>(null);
  const [kbUploadType, setKbUploadType] = useState<'file' | 'cv' | 'review'>('file');

  // Team & KPI State
  const [verifyingMemberId, setVerifyingMemberId] = useState<string | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [selectedMemberForCv, setSelectedMemberForCv] = useState<string | null>(null);

  // Task File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-refresh KPIs when critical data changes
  useEffect(() => {
    if (grant && grant.analysis && !grant.liveKpis && !loadingKpis) {
      handleRefreshKpis();
    }
  }, [grant?.analysis]);

  if (!grant) return <div>Grant not found</div>;

  // --- EXISTING HANDLERS ---
  const handleGeneratePlan = async () => {
    setLoadingTasks(true);
    try {
      const aiTasks: AiTaskResponse[] = await generateGrantPlan(grant.title, grant.description);
      const newTasks: Task[] = aiTasks.map((t, idx) => ({
        id: `gen-${Date.now()}-${idx}`,
        title: t.taskName,
        description: t.description,
        completed: false,
        stage: t.stage as any,
        dueDate: new Date(Date.now() + t.estimatedDays * 86400000).toISOString().split('T')[0],
        content: '',
        attachments: []
      }));
      onUpdateGrant({ ...grant, tasks: [...(grant.tasks || []), ...newTasks], status: GrantStatus.PLANNING });
    } catch (e) { console.error(e); } finally { setLoadingTasks(false); }
  };

  const handleDeepAnalysis = async () => {
    setLoadingAnalysis(true);
    try {
      const analysis = await analyzeGrantRequirements(grant);
      onUpdateGrant({ ...grant, analysis });
    } catch (e) { console.error(e); } finally { setLoadingAnalysis(false); }
  };

  const handleDraftSection = async () => {
    setLoadingDraft(true);
    try {
      const text = await draftProposalSection(`${grant.title} - ${grant.description}`, draftSection);
      setGeneratedDraft(text);
    } catch (e) { console.error(e); } finally { setLoadingDraft(false); }
  };

  const toggleTask = (taskId: string) => {
    if (!grant.tasks) return;
    const updatedTasks = grant.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
    onUpdateGrant({ ...grant, tasks: updatedTasks });
  };

  const toggleExpandTask = (taskId: string) => {
    if (expandedTaskId === taskId) { setExpandedTaskId(null); } else { setExpandedTaskId(taskId); setActiveTab('editor'); }
  };

  const toggleExpandHistory = (index: number) => { setExpandedHistoryId(expandedHistoryId === index ? null : index); }

  const updateTaskContent = (taskId: string, content: string) => {
    if (!grant.tasks) return;
    const updatedTasks = grant.tasks.map(t => t.id === taskId ? { ...t, content: content } : t);
    onUpdateGrant({ ...grant, tasks: updatedTasks });
  };

  // UPDATED: Syncs Task uploads with Knowledge Base
  const handleFileUpload = (taskId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !grant.tasks) return;
    const file = e.target.files[0];
    
    // 1. Create Attachment for Task
    const newAttachment: TaskAttachment = {
      id: `file-${Date.now()}`, 
      name: file.name, 
      size: `${(file.size / 1024).toFixed(1)} KB`, 
      url: URL.createObjectURL(file), 
      type: file.type
    };

    // 2. Create Asset for Knowledge Base (Synced)
    const newKbAsset: KnowledgeAsset = {
        id: newAttachment.id, // Keep ID synced
        name: `[Task] ${file.name}`, // Prefix to indicate source
        type: 'file',
        url: newAttachment.url,
        addedAt: new Date().toISOString().split('T')[0],
        size: newAttachment.size
    };

    // 3. Update Grant State
    const updatedTasks = grant.tasks.map(t => t.id === taskId ? { ...t, attachments: [...(t.attachments || []), newAttachment] } : t);
    const updatedKb = [...(grant.knowledgeBase || []), newKbAsset];

    onUpdateGrant({ ...grant, tasks: updatedTasks, knowledgeBase: updatedKb });
    
    // 4. Trigger KPI refresh as new doc might satisfy a requirement
    handleRefreshKpis();

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // UPDATED: Syncs Task deletion with Knowledge Base
  const removeAttachment = (taskId: string, attachmentId: string) => {
    if (!grant.tasks) return;
    
    // 1. Remove from Task
    const updatedTasks = grant.tasks.map(t => t.id === taskId ? { ...t, attachments: (t.attachments || []).filter(a => a.id !== attachmentId) } : t);
    
    // 2. Remove from Knowledge Base
    const updatedKb = (grant.knowledgeBase || []).filter(a => a.id !== attachmentId);

    onUpdateGrant({ ...grant, tasks: updatedTasks, knowledgeBase: updatedKb });
    handleRefreshKpis();
  };

  // --- KNOWLEDGE BASE HANDLERS ---
  const handleKbFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const newAsset: KnowledgeAsset = {
      id: `kb-${Date.now()}`, name: file.name, type: kbUploadType, url: URL.createObjectURL(file), addedAt: new Date().toISOString().split('T')[0], size: `${(file.size / 1024).toFixed(1)} KB`
    };
    onUpdateGrant({ ...grant, knowledgeBase: [...(grant.knowledgeBase || []), newAsset] });
    if (kbFileInputRef.current) kbFileInputRef.current.value = '';
    handleRefreshKpis(); // Refresh KPIs on new doc
  };

  const handleKbAddLink = () => {
    if (!newLinkUrl || !newLinkTitle) return;
    const newAsset: KnowledgeAsset = { id: `kb-link-${Date.now()}`, name: newLinkTitle, type: 'link', url: newLinkUrl, addedAt: new Date().toISOString().split('T')[0] };
    onUpdateGrant({ ...grant, knowledgeBase: [...(grant.knowledgeBase || []), newAsset] });
    setNewLinkUrl(''); setNewLinkTitle(''); setIsAddingLink(false);
  };

  const handleDeleteAsset = (assetId: string) => {
    // Also check if this asset belongs to a task and remove it from there too?
    // For now, we assume deleting from KB is the master delete action if initiated here.
    // Ideally, we'd scan tasks to remove the reference, but let's keep it simple: 
    // Docs uploaded in tasks appear in KB. Docs uploaded in KB stay in KB.
    
    onUpdateGrant({ ...grant, knowledgeBase: (grant.knowledgeBase || []).filter(a => a.id !== assetId) });
  };

  const triggerKbUpload = (type: 'file' | 'cv' | 'review') => { setKbUploadType(type); kbFileInputRef.current?.click(); };

  // --- TEAM MANAGEMENT & KPI HANDLERS ---

  const handleAddTeamMember = () => {
    const newMember: TeamMember = {
      id: `tm-${Date.now()}`,
      name: "New Colleague",
      role: "Researcher",
      verificationStatus: 'none'
    };
    onUpdateGrant({ ...grant, teamMembers: [...(grant.teamMembers || []), newMember] });
  };

  const updateTeamMember = (id: string, field: keyof TeamMember, value: string) => {
    const updatedMembers = (grant.teamMembers || []).map(m => 
      m.id === id ? { ...m, [field]: value, verificationStatus: 'none' as const } : m
    );
    onUpdateGrant({ ...grant, teamMembers: updatedMembers });
  };

  const handleCvUploadForMember = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !selectedMemberForCv) return;
    const file = e.target.files[0];
    
    // Update member with CV info
    const updatedMembers = (grant.teamMembers || []).map(m => 
      m.id === selectedMemberForCv ? { ...m, cvName: file.name, cvUrl: URL.createObjectURL(file), verificationStatus: 'pending' as const } : m
    );
    onUpdateGrant({ ...grant, teamMembers: updatedMembers });
    
    // Trigger Auto Verification
    handleVerifyMember(selectedMemberForCv, updatedMembers.find(m => m.id === selectedMemberForCv)!);
    
    if (cvInputRef.current) cvInputRef.current.value = '';
    setSelectedMemberForCv(null);
  };

  const handleVerifyMember = async (memberId: string, memberObj?: TeamMember) => {
    if (!grant.analysis) {
        alert("Please run 'Deep Analysis' first to get requirement criteria.");
        return;
    }
    const member = memberObj || grant.teamMembers?.find(m => m.id === memberId);
    if (!member) return;

    setVerifyingMemberId(memberId);
    try {
        const result = await verifyTeamMemberRequirement(member, grant.analysis);
        const updatedMembers = (grant.teamMembers || []).map(m => 
            m.id === memberId ? { 
                ...m, 
                verificationStatus: result.status, 
                verificationMessage: result.message 
            } : m
        );
        onUpdateGrant({ ...grant, teamMembers: updatedMembers });
        // Refresh KPIs after team update
        handleRefreshKpis(updatedMembers);
    } catch (e) {
        console.error(e);
    } finally {
        setVerifyingMemberId(null);
    }
  };

  const handleRefreshKpis = async (currentTeamMembers?: TeamMember[]) => {
      setLoadingKpis(true);
      try {
          // Pass current state to service
          const tempGrant = { ...grant, teamMembers: currentTeamMembers || grant.teamMembers };
          const newKpis = await evaluateLiveKpis(tempGrant);
          onUpdateGrant({ ...grant, liveKpis: newKpis });
      } catch (e) {
          console.error(e);
      } finally {
          setLoadingKpis(false);
      }
  };

  const filteredAssets = (grant.knowledgeBase || []).filter(
    asset => kbFilter === 'all' ? true : asset.type === kbFilter
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-full overflow-hidden">
      {/* LEFT: Main Info & Analysis */}
      <div className="xl:col-span-2 space-y-6 overflow-y-auto pr-2 pb-20 custom-scrollbar">
        {/* Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <span className="text-xs font-bold text-accent uppercase tracking-wider mb-2 block">{grant.funder}</span>
          <h1 className="text-3xl font-bold text-slate-800 mb-4">{grant.title}</h1>
          <p className="text-slate-600 leading-relaxed mb-6">{grant.description}</p>
          <div className="flex gap-4 border-t border-slate-100 pt-4">
            <div className="px-4 py-2 bg-slate-50 rounded-lg"><p className="text-xs text-slate-500 uppercase">Deadline</p><p className="font-semibold">{grant.deadline}</p></div>
            <div className="px-4 py-2 bg-slate-50 rounded-lg"><p className="text-xs text-slate-500 uppercase">Amount</p><p className="font-semibold text-green-700">{grant.amount || 'N/A'}</p></div>
          </div>
        </div>

        {/* --- LIVE KPI MONITOR (New Section) --- */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 relative overflow-hidden">
           <div className="flex justify-between items-center mb-6 relative z-10">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                 <Activity className="w-5 h-5 text-red-500" /> Live KPI Monitor
              </h3>
              <button 
                onClick={() => handleRefreshKpis()}
                disabled={loadingKpis}
                className="text-xs flex items-center gap-1 text-slate-500 hover:text-accent transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingKpis ? 'animate-spin' : ''}`} /> Refresh Analysis
              </button>
           </div>
           
           {!grant.liveKpis ? (
              <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
                 <p className="text-sm">Upload documents or add team members to start monitoring KPIs.</p>
              </div>
           ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {grant.liveKpis.map(kpi => (
                    <div key={kpi.id} className={`p-4 rounded-lg border flex flex-col justify-between h-32 ${
                        kpi.status === 'met' ? 'bg-green-50 border-green-100' :
                        kpi.status === 'pending' ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-100'
                    }`}>
                        <div className="flex justify-between items-start">
                           <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                               kpi.category === 'team' ? 'bg-blue-100 text-blue-700' :
                               kpi.category === 'output' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
                           }`}>
                              {kpi.category}
                           </span>
                           {kpi.status === 'met' ? <ShieldCheck className="w-5 h-5 text-green-500" /> : 
                            kpi.status === 'risk' ? <ShieldAlert className="w-5 h-5 text-red-500" /> : <div className="w-2 h-2 rounded-full bg-slate-300"></div>}
                        </div>
                        <div>
                           <h4 className="font-bold text-slate-800 text-sm leading-tight mb-1">{kpi.name}</h4>
                           <p className="text-xs text-slate-500 line-clamp-2">{kpi.aiAnalysis}</p>
                        </div>
                        <div className="w-full bg-white/50 h-1.5 rounded-full mt-2 overflow-hidden">
                           <div className={`h-full rounded-full ${
                               kpi.status === 'met' ? 'bg-green-500 w-full' : 
                               kpi.status === 'risk' ? 'bg-red-500 w-1/4' : 'bg-slate-300 w-1/2'
                           }`}></div>
                        </div>
                    </div>
                 ))}
              </div>
           )}
        </div>

        {/* --- TEAM MANAGEMENT (New Section) --- */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
           <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                 <Users className="w-5 h-5 text-accent" /> Consortium & Team
              </h3>
              <button onClick={handleAddTeamMember} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-700 flex items-center gap-2">
                 <Plus className="w-4 h-4" /> Add Colleague
              </button>
           </div>
           
           <div className="space-y-3">
              <input type="file" ref={cvInputRef} className="hidden" accept=".pdf,.doc,.docx" onChange={handleCvUploadForMember} />
              
              {!grant.teamMembers || grant.teamMembers.length === 0 ? (
                 <p className="text-slate-400 text-sm italic text-center py-4">No team members added yet.</p>
              ) : (
                 grant.teamMembers.map(member => (
                    <div key={member.id} className="border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row items-center gap-4 bg-white hover:border-accent/50 transition-colors">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 flex-shrink-0">
                           <User className="w-6 h-6" />
                        </div>
                        <div className="flex-1 w-full md:w-auto text-center md:text-left">
                           <input 
                              className="font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-accent focus:outline-none bg-transparent text-center md:text-left"
                              value={member.name}
                              onChange={(e) => updateTeamMember(member.id, 'name', e.target.value)}
                           />
                           <div className="flex items-center justify-center md:justify-start gap-2 mt-1">
                               <input 
                                  className="text-sm text-slate-500 border-b border-transparent hover:border-slate-300 focus:border-accent focus:outline-none bg-transparent w-32"
                                  value={member.role}
                                  onChange={(e) => updateTeamMember(member.id, 'role', e.target.value)}
                               />
                           </div>
                        </div>

                        {/* CV & Status Area */}
                        <div className="flex flex-col items-center md:items-end gap-2">
                            {member.verificationStatus === 'verified' && (
                                <div className="flex items-center gap-1 text-green-600 text-xs font-bold bg-green-50 px-2 py-1 rounded">
                                   <ShieldCheck className="w-3.5 h-3.5" /> AI Verified
                                </div>
                            )}
                            {member.verificationStatus === 'mismatch' && (
                                <div className="flex items-center gap-1 text-red-600 text-xs font-bold bg-red-50 px-2 py-1 rounded" title={member.verificationMessage}>
                                   <ShieldAlert className="w-3.5 h-3.5" /> Qualification Risk
                                </div>
                            )}
                            {member.verificationStatus === 'pending' && (
                                <div className="flex items-center gap-1 text-blue-600 text-xs font-bold bg-blue-50 px-2 py-1 rounded">
                                   <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...
                                </div>
                            )}

                            {member.cvUrl ? (
                                <a href={member.cvUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline flex items-center gap-1">
                                   <Paperclip className="w-3 h-3" /> {member.cvName || 'View CV'}
                                </a>
                            ) : (
                                <button 
                                   onClick={() => { setSelectedMemberForCv(member.id); cvInputRef.current?.click(); }}
                                   className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded hover:bg-slate-200 transition-colors"
                                >
                                   Upload CV to Verify
                                </button>
                            )}
                        </div>
                    </div>
                 ))
              )}
           </div>
        </div>

        {/* KNOWLEDGE BASE SECTION */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-accent" /> Project Knowledge Base
              </h3>
              
              <div className="flex items-center gap-2">
                {/* Hidden File Input */}
                <input 
                  type="file" 
                  ref={kbFileInputRef}
                  className="hidden"
                  onChange={handleKbFileUpload}
                />
                
                <div className="flex bg-slate-50 rounded-lg p-1 border border-slate-200">
                   <button 
                     onClick={() => setKbFilter('all')}
                     className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${kbFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     All
                   </button>
                   <button 
                     onClick={() => setKbFilter('file')}
                     className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${kbFilter === 'file' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     Docs
                   </button>
                   <button 
                     onClick={() => setKbFilter('review')}
                     className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${kbFilter === 'review' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     Reviews
                   </button>
                   <button 
                     onClick={() => setKbFilter('link')}
                     className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${kbFilter === 'link' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     Links
                   </button>
                   <button 
                     onClick={() => setKbFilter('cv')}
                     className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${kbFilter === 'cv' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     CVs
                   </button>
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-wrap gap-3 mb-6">
                <button 
                  onClick={() => triggerKbUpload('file')}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-xs font-bold border border-slate-200"
                >
                   <Upload className="w-3.5 h-3.5" /> Upload Document
                </button>
                <button 
                  onClick={() => triggerKbUpload('review')}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors text-xs font-bold border border-purple-200"
                >
                   <Scale className="w-3.5 h-3.5" /> Upload Review
                </button>
                <button 
                  onClick={() => triggerKbUpload('cv')}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-xs font-bold border border-slate-200"
                >
                   <User className="w-3.5 h-3.5" /> Upload CV
                </button>
                <button 
                  onClick={() => setIsAddingLink(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-xs font-bold border border-slate-200"
                >
                   <LinkIcon className="w-3.5 h-3.5" /> Add Link
                </button>
            </div>

            {/* Add Link Form */}
            {isAddingLink && (
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6 animate-in slide-in-from-top-2">
                 <h4 className="text-sm font-bold text-slate-700 mb-3">Add External Resource Link</h4>
                 <div className="flex flex-col md:flex-row gap-3">
                    <input 
                      type="text" 
                      placeholder="Title (e.g. Competitor Analysis)"
                      className="flex-1 p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-accent outline-none"
                      value={newLinkTitle}
                      onChange={(e) => setNewLinkTitle(e.target.value)}
                    />
                    <input 
                      type="text" 
                      placeholder="URL (https://...)"
                      className="flex-1 p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-accent outline-none"
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                    />
                    <div className="flex gap-2">
                       <button 
                         onClick={handleKbAddLink}
                         disabled={!newLinkTitle || !newLinkUrl}
                         className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
                       >
                         Add
                       </button>
                       <button 
                         onClick={() => setIsAddingLink(false)}
                         className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded text-sm hover:bg-slate-100"
                       >
                         Cancel
                       </button>
                    </div>
                 </div>
              </div>
            )}

            {/* Assets List */}
            <div className="space-y-2">
               {filteredAssets.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No assets found in Knowledge Base.</p>
                    <p className="text-xs">Upload documents, reviews, CVs or add links.</p>
                  </div>
               ) : (
                  filteredAssets.map(asset => (
                    <div key={asset.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg group hover:border-accent hover:shadow-sm transition-all">
                       <div className="flex items-center gap-3 overflow-hidden">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                             asset.type === 'link' ? 'bg-purple-50 text-purple-600' : 
                             asset.type === 'cv' ? 'bg-orange-50 text-orange-600' : 
                             asset.type === 'review' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'
                          }`}>
                             {asset.type === 'link' ? <LinkIcon className="w-5 h-5" /> : 
                              asset.type === 'cv' ? <User className="w-5 h-5" /> : 
                              asset.type === 'review' ? <Scale className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                             <a 
                               href={asset.url} 
                               target="_blank" 
                               rel="noreferrer"
                               className="font-medium text-slate-700 hover:text-accent truncate block text-sm"
                             >
                               {asset.name}
                             </a>
                             <div className="flex items-center gap-2 text-xs text-slate-400">
                                <span>{asset.addedAt}</span>
                                {asset.size && (
                                  <>
                                    <span>•</span>
                                    <span>{asset.size}</span>
                                  </>
                                )}
                                <span className={`uppercase tracking-wider font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                    asset.type === 'review' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {asset.type}
                                </span>
                             </div>
                          </div>
                       </div>
                       <button 
                         onClick={() => handleDeleteAsset(asset.id)}
                         className="text-slate-300 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                         title="Delete Asset"
                       >
                          <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                  ))
               )}
            </div>
        </div>

        {/* Existing Analysis & Tasks */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
           {/* ... Analysis content (simplified for brevity in this update, keeping layout logic) ... */}
           <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Microscope className="w-5 h-5 text-accent" /> Deep Analysis
            </h3>
            {!grant.analysis && (
              <button onClick={handleDeepAnalysis} disabled={loadingAnalysis} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-70 text-sm font-medium">
                {loadingAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Run Analysis
              </button>
            )}
           </div>
           {grant.analysis && (
              <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50 p-3 rounded">
                          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Team Requirements</p>
                          <ul className="text-sm space-y-1">{grant.analysis.teamProfile.map((t, i) => <li key={i}>• {t}</li>)}</ul>
                      </div>
                      <div className="bg-slate-50 p-3 rounded">
                          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Success KPIs</p>
                          <ul className="text-sm space-y-1">{grant.analysis.successKPIs.map((t, i) => <li key={i}>• {t}</li>)}</ul>
                      </div>
                  </div>
              </div>
           )}
        </div>

        {/* Tasks Section (Existing) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-accent" /> Submission To-Do List
            </h3>
            {(!grant.tasks || grant.tasks.length === 0) && (
              <button 
                onClick={handleGeneratePlan}
                disabled={loadingTasks}
                className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-70 animate-pulse text-sm font-medium"
              >
                {loadingTasks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Generate AI Plan
              </button>
            )}
          </div>

          <div className="space-y-4">
            {(!grant.tasks || grant.tasks.length === 0) ? (
              <div className="text-center py-12 text-slate-500 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
                 <CheckSquare className="w-10 h-10 mx-auto mb-2 opacity-20" />
                 <p>No active tasks.</p>
                 <p className="text-sm">Click "Generate AI Plan" to create a workflow for this grant.</p>
              </div>
            ) : (
              grant.tasks.map(task => {
                const isExpanded = expandedTaskId === task.id;
                
                return (
                  <div 
                    key={task.id} 
                    className={`rounded-xl border transition-all duration-300 overflow-hidden ${
                      isExpanded ? 'bg-white border-accent shadow-md ring-1 ring-accent/10' : 'bg-white border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    {/* Task Header */}
                    <div className="flex items-start gap-4 p-4 cursor-pointer" onClick={() => toggleExpandTask(task.id)}>
                      <input 
                        type="checkbox" 
                        checked={task.completed}
                        onChange={(e) => { e.stopPropagation(); toggleTask(task.id); }}
                        className="mt-1.5 w-5 h-5 text-accent rounded border-slate-300 focus:ring-accent cursor-pointer" 
                      />
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                           <p className={`font-semibold text-base ${task.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                             {task.title}
                           </p>
                           <div className="flex items-center gap-2">
                             <span className="text-[10px] uppercase font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded">
                               {task.stage}
                             </span>
                             {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                           </div>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">{task.description}</p>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50">
                        {/* Tabs */}
                        <div className="flex border-b border-slate-200">
                          <button
                            onClick={() => setActiveTab('editor')}
                            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
                              activeTab === 'editor' ? 'bg-white text-accent border-b-2 border-accent' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            <PenTool className="w-4 h-4" /> Text Editor
                          </button>
                          <button
                            onClick={() => setActiveTab('files')}
                            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
                              activeTab === 'files' ? 'bg-white text-accent border-b-2 border-accent' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            <Paperclip className="w-4 h-4" /> Attached Files ({task.attachments?.length || 0})
                          </button>
                        </div>

                        {/* Editor Content */}
                        {activeTab === 'editor' && (
                          <div className="p-4">
                             <div className="relative">
                               <textarea
                                 className="w-full h-40 p-4 rounded-lg border border-slate-200 focus:ring-2 focus:ring-accent focus:border-accent resize-none text-sm leading-relaxed text-slate-700 shadow-inner"
                                 placeholder="Draft your response, notes, or section content here..."
                                 value={task.content || ''}
                                 onChange={(e) => updateTaskContent(task.id, e.target.value)}
                               />
                               <div className="absolute bottom-3 right-3 flex gap-2">
                                  {task.content && (
                                    <div className="text-xs text-green-600 flex items-center gap-1 bg-green-50 px-2 py-1 rounded-full">
                                      <Save className="w-3 h-3" /> Auto-saved
                                    </div>
                                  )}
                               </div>
                             </div>
                             <p className="text-xs text-slate-400 mt-2">
                               Use this space to draft abstract text, copy requirements, or keep status notes.
                             </p>
                          </div>
                        )}

                        {/* Files Content */}
                        {activeTab === 'files' && (
                          <div className="p-4">
                             <div className="space-y-3 mb-4">
                                {(task.attachments || []).map(file => (
                                  <div key={file.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg group hover:border-accent transition-colors">
                                     <div className="flex items-center gap-3">
                                       <div className="w-8 h-8 bg-blue-50 text-accent rounded flex items-center justify-center">
                                         <File className="w-4 h-4" />
                                       </div>
                                       <div>
                                         <p className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{file.name}</p>
                                         <p className="text-xs text-slate-400">{file.size}</p>
                                       </div>
                                     </div>
                                     <button 
                                       onClick={() => removeAttachment(task.id, file.id)}
                                       className="text-slate-400 hover:text-red-500 p-1"
                                     >
                                       <X className="w-4 h-4" />
                                     </button>
                                  </div>
                                ))}
                             </div>

                             <div className="relative">
                               <input
                                 type="file"
                                 ref={fileInputRef}
                                 onChange={(e) => handleFileUpload(task.id, e)}
                                 className="hidden"
                               />
                               <button 
                                 onClick={() => fileInputRef.current?.click()}
                                 className="w-full h-24 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-500 hover:border-accent hover:text-accent hover:bg-blue-50 transition-all gap-2"
                               >
                                 <Upload className="w-6 h-6" />
                                 <span className="text-sm font-medium">Click to upload documents</span>
                                 <span className="text-xs text-slate-400">Added files will sync to Knowledge Base</span>
                               </button>
                             </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: AI Assistant (Existing) */}
      <div className="bg-slate-50 border-l border-slate-200 p-6 overflow-y-auto pb-20 custom-scrollbar">
        <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-purple-600" /> AI Proposal Assistant
        </h3>
        {/* ... (Existing drafting UI) ... */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">Draft Section</label>
          <select className="w-full p-2 border border-slate-300 rounded-lg mb-3 text-sm" value={draftSection} onChange={(e) => setDraftSection(e.target.value)}>
            <option>Project Abstract</option><option>Impact Statement</option><option>Methodology Overview</option>
          </select>
          <button onClick={handleDraftSection} disabled={loadingDraft} className="w-full bg-purple-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex justify-center items-center gap-2">
            {loadingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileEdit className="w-4 h-4" />} Draft Content
          </button>
        </div>
        {generatedDraft && (
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
             <textarea className="w-full h-64 p-3 text-sm text-slate-600 bg-slate-50 rounded-lg border-0 resize-none focus:ring-2 focus:ring-purple-200 outline-none" value={generatedDraft} onChange={(e) => setGeneratedDraft(e.target.value)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default GrantDetail;
