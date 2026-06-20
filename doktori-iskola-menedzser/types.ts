
export enum UserRole {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  STUDENT = 'STUDENT'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  linkedId?: string; // Links to Student.id or Supervisor.id
}

export interface Project {
  id: string;
  title: string;
  description: string;
  supervisorId: string;
  supervisorName: string;
  tags: string[];
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

export enum StudentStatus {
  ACTIVE = 'Aktív',
  PASSIVE = 'Passzív',
  GRADUATED = 'Fokozatot szerzett',
  DROPPED_OUT = 'Lemorzsolódott',
  ABS = 'Abszolutórium'
}

export enum MilestoneType {
  COURSE = 'Tanegység',
  PUBLICATION = 'Publikáció',
  EXAM = 'Vizsga',
  TEACHING = 'Oktatás',
  DISSERTATION = 'Disszertáció'
}

export enum MilestoneStatus {
  PENDING = 'Tervezett',
  IN_PROGRESS = 'Folyamatban',
  COMPLETED = 'Teljesítve',
  FAILED = 'Sikertelen'
}

export interface Milestone {
  id: string;
  title: string;
  type: MilestoneType;
  credits: number; // Kreditérték
  deadline: string;
  status: MilestoneStatus;
  description?: string;
  completionDate?: string;
  proofDoc?: {
    name: string;
    uploadedAt: string;
    status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  };
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
}

export type PublicationCategory = 'OWN' | 'REFERENCE';
export type PublicationStatus = 'PLANNED' | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'ACCEPTED' | 'PUBLISHED';

export interface Publication {
  id: string;
  title: string;
  authors: string;
  venue?: string; // Journal or Conference name
  year: number;
  category: PublicationCategory;
  status?: PublicationStatus; // Only for OWN
  url?: string;
  source?: 'MANUAL' | 'MTMT';
  odtSynced?: boolean;
}

export interface OnboardingTask {
  id: string;
  title: string;
  category: 'ADMIN' | 'SAFETY' | 'ACCESS' | 'IT';
  isCompleted: boolean;
  deadline?: string;
  points: number;
}

export interface Skill {
  name: string;
  currentLevel: number; // 1-10
  targetLevel: number; // 1-10
  category: 'RESEARCH' | 'SOFT' | 'TECHNICAL';
}

export interface IDPGoal {
  id: string;
  title: string;
  deadline: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'ACHIEVED';
  relatedSkill: string;
}

export interface CourseRecommendation {
  title: string;
  provider: string; // e.g. "Coursera", "Internal", "Workshop"
  focusSkill: string;
  duration: string;
}

export interface CommitteeMember {
  id: string;
  name: string;
  role: 'CHAIR' | 'SECRETARY' | 'MEMBER' | 'EXTERNAL';
  institution: string;
  email?: string;
}

export interface ComplexExam {
  status: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'SCHEDULED' | 'COMPLETED';
  plannedDate?: string;
  committee: CommitteeMember[];
  resultGrade?: string; // e.g. "Summa Cum Laude"
}

export interface DegreeRequirement {
  id: string;
  title: string;
  category: 'SCIENTIFIC' | 'ACADEMIC' | 'TEACHING';
  targetValue: number;
  currentValue: number;
  unit: string; // e.g. "db", "kredit", "óra"
  isAutoCalculated: boolean; // if true, derived from other data
  description?: string;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  enrollmentYear: number;
  supervisor: string; // Témavezető Név
  supervisorId?: string; // Link to Supervisor ID
  topic: string; // Kutatási téma
  status: StudentStatus;
  milestones: Milestone[];
  tasks: Task[];
  publications: Publication[];
  onboardingTasks: OnboardingTask[];
  skills: Skill[];
  idpGoals: IDPGoal[];
  courseRecommendations: CourseRecommendation[];
  totalCredits: number;
  requiredCredits: number;
  avatarUrl: string;
  ethicsStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  complexExam?: ComplexExam;
  degreeRequirements: DegreeRequirement[]; // New KPI field
}

export interface Supervisor {
  id: string;
  name: string;
  department: string;
  capacityCurrent: number;
  capacityMax: number;
  researchInterests: string[];
  publications: string[]; // Scopus/MTMT titles mock
  avatarUrl: string;
}

export interface SupervisorMatchResult {
  supervisorId: string;
  matchScore: number; // 0-100
  reasoning: string;
}

export interface KPIMetrics {
  avgCreditsPerSemester: number;
  publicationCount: number;
  monthsUntilDeadline: number;
  riskScore: number; // 0-100, where 100 is high risk
}

export type ViewState = 'DASHBOARD' | 'STUDENT_LIST' | 'STUDENT_DETAIL' | 'SUPERVISOR_LIST' | 'PROJECTS';
