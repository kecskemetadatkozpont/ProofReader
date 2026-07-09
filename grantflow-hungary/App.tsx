import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import FindFunding from './pages/FindFunding';
import MyGrants from './pages/MyGrants';
import GrantDetail from './pages/GrantDetail';
import OpenCalls from './pages/OpenCalls';
import Sources from './pages/Sources';
import AdminDashboard from './pages/AdminDashboard'; // Import new page
import Tasks from './pages/Tasks'; // Import Tasks page
import { MOCK_GRANTS, OFFICE_CURATED_GRANTS } from './constants';
import { Grant, Task, GrantStatus } from './types';
import { findStructuredOpportunities, analyzeGrantRequirements, generateGrantPlan } from './services/geminiService.ts';

// Constants moved here to support the lifted logic
export const CATEGORIES = [
  { id: 'nkfih', label: '🇭🇺 NKFIH / OTKA', query: 'Hungarian National Research NKFIH active calls OTKA Misszió pályázat Nemzeti Kiválóság Helyreállítási Terv' },
  { id: 'horizon', label: '🇪🇺 EU Horizon Europe', query: 'Horizon Europe calls for universities open now' },
  { id: 'challenges', label: '⚙️ Engineering Challenges', query: 'global engineering innovation challenges and competitions for universities 2024 2025' },
  { id: 'scholarships', label: '🔬 Research Scholarships', query: 'research scholarships and fellowships for Hungarian researchers' },
  { id: 'charity', label: '🌿 Charity & NGO', query: 'research grants from NGOs like Greenpeace, WWF, Bill & Melinda Gates Foundation, and civil organizations' },
  { id: 'other', label: '🌐 Other Opportunities', query: 'miscellaneous academic research grants and funding opportunities for universities not covered by major government agencies' },
];

const LOADING_MESSAGES = [
  "Querying official databases...",
  "Reading eligibility criteria...",
  "Analyzing PDF guidelines...",
  "Cross-referencing University requirements...",
  "Extracting budget details...",
  "Validating submission deadlines...",
  "Structuring data for display..."
];

const App: React.FC = () => {
  // Global Grant State (My Applications)
  const [grants, setGrants] = useState<Grant[]>(MOCK_GRANTS);
  
  // Open Calls State (University List) - Initialized with constant data but mutable
  const [openCalls, setOpenCalls] = useState<Grant[]>(OFFICE_CURATED_GRANTS);

  // Find Funding (Scanner) State
  const [ocrSelectedCategories, setOcrSelectedCategories] = useState<string[]>([]);
  const [ocrStreamedGrants, setOcrStreamedGrants] = useState<Grant[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrCurrentAction, setOcrCurrentAction] = useState<string>("");
  const [ocrLogs, setOcrLogs] = useState<string[]>([]);

  // Helpers
  const addGrantToMyApplications = (newGrant: Grant) => {
    // Double check status before adding
    if (newGrant.processingStatus === 'analyzing') {
      alert("Please wait for the AI Analysis to complete before adding this grant.");
      return;
    }

    if (grants.some(g => g.id === newGrant.id)) {
      alert("This grant is already in your personal application list.");
      return;
    }
    setGrants(prev => [newGrant, ...prev]);
  };

  const addOcrLog = (message: string) => {
    setOcrLogs(prev => [...prev, `[${new Date().toLocaleTimeString().split(' ')[0]}] ${message}`]);
  };

  const addGrantToOpenCalls = async (newGrant: Grant) => {
    // Check if it already exists in Open Calls based on ID or Title (to avoid duplicates from AI)
    if (openCalls.some(g => g.id === newGrant.id || g.title === newGrant.title)) {
      return; // Already added, do nothing
    }
    
    // 1. Optimistic Update with 'analyzing' status
    // This immediately shows the card but blocks the add button
    const processingGrant: Grant = {
       ...newGrant,
       processingStatus: 'analyzing'
    };

    setOpenCalls(prev => [processingGrant, ...prev]);

    // 2. Background Enrichment: Automatically run Deep Analysis and Task Generation
    try {
      addOcrLog(`AUTO-PROCESSING: Generating standardized plan for ${newGrant.title.substring(0, 20)}...`);
      
      // Run AI services in parallel for speed
      const [analysis, aiTasks] = await Promise.all([
        analyzeGrantRequirements(newGrant),
        generateGrantPlan(newGrant.title, newGrant.description)
      ]);

      // Convert AI Tasks to internal Task objects
      const formattedTasks: Task[] = aiTasks.map((t, idx) => ({
        id: `auto-${newGrant.id}-${idx}`,
        title: t.taskName,
        description: t.description,
        completed: false,
        stage: t.stage as any,
        dueDate: new Date(Date.now() + t.estimatedDays * 86400000).toISOString().split('T')[0],
        content: '',
        attachments: []
      }));

      // Update the grant in the Open Calls list with the enriched data AND set status to complete
      setOpenCalls(prev => prev.map(g => {
        if (g.id === newGrant.id) {
          return {
            ...g,
            analysis: analysis,
            tasks: formattedTasks,
            processingStatus: 'complete' 
          };
        }
        return g;
      }));

      addOcrLog(`✓ COMPLETED: Standardized criteria & tasks attached to ${newGrant.title.substring(0, 20)}...`);

    } catch (error) {
      console.error("Error during auto-enrichment of grant:", error);
      addOcrLog(`WARNING: Could not auto-generate details for ${newGrant.title.substring(0, 20)}...`);
      
      // On failure, set status to failed or complete (with partial data) so user isn't blocked forever
      setOpenCalls(prev => prev.map(g => {
        if (g.id === newGrant.id) {
          return { ...g, processingStatus: 'failed' };
        }
        return g;
      }));
    }
  };

  const updateGrant = (updatedGrant: Grant) => {
    setGrants(prev => prev.map(g => g.id === updatedGrant.id ? updatedGrant : g));
  };

  // The Search Logic for Find Funding (Scanner)
  const runOpenCallsSearch = async () => {
    if (ocrSelectedCategories.length === 0) return;

    setOcrLoading(true);
    setOcrStreamedGrants([]); 
    setOcrLogs([]);
    addOcrLog("System initialized. Starting multi-source scan (Background Process)...");

    for (const catId of ocrSelectedCategories) {
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) continue;

      setOcrCurrentAction(`Connecting to ${cat.label}...`);
      addOcrLog(`SOURCE: ${cat.label} - Initiating connection...`);

      const timer = setInterval(() => {
        const msg = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
        setOcrCurrentAction(`${cat.label}: ${msg}`);
      }, 2000);

      try {
        addOcrLog(`Sending query: "${cat.query}"`);
        const opportunities = await findStructuredOpportunities(cat.query);
        
        clearInterval(timer);
        addOcrLog(`✓ Found ${opportunities.length} raw candidates from ${cat.label}. Processing...`);

        for (const grant of opportunities) {
          setOcrCurrentAction(`Processing: ${grant.title.substring(0, 30)}...`);
          await new Promise(resolve => setTimeout(resolve, 800));
          
          setOcrStreamedGrants(prev => [grant, ...prev]);
          addOcrLog(`+ Added opportunity: ${grant.title}`);
        }

      } catch (error) {
        clearInterval(timer);
        console.error(`Failed to fetch for ${cat.label}`, error);
        addOcrLog(`ERROR: Failed to fetch data from ${cat.label}`);
      }
    }

    setOcrCurrentAction("Scan complete.");
    addOcrLog("All tasks finished. Waiting for user input.");
    setOcrLoading(false);
  };

  const toggleOcrCategory = (id: string) => {
    setOcrSelectedCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  return (
    <HashRouter>
      <div className="flex h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col relative">
          {/* Header Area */}
          <div className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 flex-shrink-0">
             <div className="text-sm breadcrumbs text-slate-400">
               University of Technology / Research Office / <span className="text-slate-800 font-medium">Portal</span>
             </div>
             <div className="flex items-center space-x-4">
               {ocrLoading && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-accent rounded-full text-xs font-bold animate-pulse border border-blue-100">
                   <div className="w-2 h-2 bg-accent rounded-full animate-ping"></div>
                   AI Scanning in background...
                 </div>
               )}
               <div className="w-8 h-8 rounded-full bg-uni-red text-white flex items-center justify-center font-bold text-xs">
                 HU
               </div>
             </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              
              {/* Find Funding is now the AI Scanner */}
              <Route 
                path="/find-funding" 
                element={
                  <FindFunding 
                    onAddToOpenCalls={addGrantToOpenCalls}
                    existingOpenCalls={openCalls}
                    // Pass persistent state props
                    categories={CATEGORIES}
                    selectedCategories={ocrSelectedCategories}
                    onToggleCategory={toggleOcrCategory}
                    onStartSearch={runOpenCallsSearch}
                    streamedGrants={ocrStreamedGrants}
                    loading={ocrLoading}
                    currentAction={ocrCurrentAction}
                    logs={ocrLogs}
                  />
                } 
              />

              {/* Open Calls is now the Curated List */}
              <Route 
                path="/open-calls"
                element={<OpenCalls grants={openCalls} userGrants={grants} onAddGrant={addGrantToMyApplications} />}
              />

              <Route path="/my-grants" element={<MyGrants grants={grants} />} />
              <Route path="/tasks" element={<Tasks grants={grants} onUpdateGrant={updateGrant} />} />
              <Route path="/grant/:id" element={<GrantDetail grants={grants} onUpdateGrant={updateGrant} />} />
              
              <Route path="/sources" element={<Sources grants={grants} />} />
              
              {/* New Admin Route with updateGrant capability */}
              <Route path="/admin" element={<AdminDashboard grants={grants} onUpdateGrant={updateGrant} />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
  );
};

export default App;