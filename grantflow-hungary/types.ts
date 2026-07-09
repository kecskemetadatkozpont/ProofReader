
export enum GrantStatus {
  DISCOVERED = 'DISCOVERED',
  PLANNING = 'PLANNING',
  DRAFTING = 'DRAFTING',
  SUBMITTED = 'SUBMITTED',
  AWARDED = 'AWARDED',
  REJECTED = 'REJECTED'
}

export interface GrantDocument {
  name: string;
  url: string;
  type?: 'pdf' | 'doc' | 'web';
}

export interface TaskAttachment {
  id: string;
  name: string;
  size: string;
  url: string;
  type: string;
}

export interface KnowledgeAsset {
  id: string;
  name: string;
  type: 'file' | 'link' | 'cv' | 'review'; // Added 'review' type
  url: string;
  addedAt: string;
  size?: string; // Only for files
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email?: string;
  cvUrl?: string;
  cvName?: string;
  verificationStatus: 'pending' | 'verified' | 'mismatch' | 'none';
  verificationMessage?: string; // AI reasoning
}

export interface KpiMetric {
  id: string;
  category: 'team' | 'output' | 'admin';
  name: string; // e.g., "PhD Project Manager" or "3 Q1 Papers"
  status: 'met' | 'pending' | 'risk';
  currentValue: string; // e.g., "Verified" or "0 uploaded"
  targetValue: string; // e.g., "Required" or "3"
  aiAnalysis: string; // Explanation from Gemini
}

export interface HistoricalWinner {
  projectTitle: string;
  institution: string;
  year: string;
  summary: string;
  teamMembers?: string[];
  documents: GrantDocument[];
  scientometrics: {
    publications: string;
    citations: string;
    teamSize: string;
    hIndexAvg?: string;
  };
}

export interface GrantAnalysis {
  requiredTopics: string[];
  pmProfile: string[];
  teamProfile: string[]; 
  strictDeadlines: string[];
  successKPIs: string[];
  historicalData: HistoricalWinner[]; 
}

export interface Grant {
  id: string;
  title: string;
  funder: string;
  deadline: string;
  preProposalDeadline?: string; // New: Pre-qualification / Abstract deadline
  description: string;
  detailedDescription?: string; 
  amount?: string;
  status: GrantStatus;
  url?: string;
  matchScore?: number;
  tasks?: Task[];
  eligibility?: string; 
  kpis?: string; 
  documents?: GrantDocument[]; 
  analysis?: GrantAnalysis; 
  knowledgeBase?: KnowledgeAsset[];
  teamMembers?: TeamMember[]; // New: Team management
  liveKpis?: KpiMetric[]; // New: Live monitoring
  processingStatus?: 'idle' | 'analyzing' | 'complete' | 'failed'; 
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  completed: boolean;
  stage: 'PRE-AWARD' | 'SUBMISSION' | 'POST-AWARD';
  content?: string; 
  attachments?: TaskAttachment[]; 
}

export interface SearchResult {
  title: string;
  funder: string;
  description: string;
  deadline?: string;
  url?: string;
}

export interface AiTaskResponse {
  taskName: string;
  description: string;
  stage: string;
  estimatedDays: number;
}