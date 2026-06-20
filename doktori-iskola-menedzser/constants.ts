
import { Student, StudentStatus, MilestoneType, MilestoneStatus, Supervisor, OnboardingTask, Skill, DegreeRequirement } from './types';

export const REQUIRED_CREDITS_TOTAL = 240;

const DEFAULT_ONBOARDING_TASKS: OnboardingTask[] = [
  // Fázis 1: Adminisztráció és Hozzáférés
  { 
    id: 'o1', 
    title: 'Hivatalos beiratkozás a Dékáni Hivatalban', 
    category: 'ADMIN', 
    isCompleted: true, 
    points: 50, 
    deadline: '2025-09-05' 
  },
  { 
    id: 'o2', 
    title: 'Egyetemi IT fiók és Email aktiválása', 
    category: 'IT', 
    isCompleted: true, 
    points: 20, 
    deadline: '2025-09-06' 
  },
  { 
    id: 'o3', 
    title: 'Belépőkártya és laboratóriumi kulcsok igénylése', 
    category: 'ACCESS', 
    isCompleted: false, 
    points: 30, 
    deadline: '2025-09-10' 
  },
  // Fázis 2: Biztonság
  { 
    id: 'o4', 
    title: 'Kötelező Tűz- és Munkavédelmi oktatás', 
    category: 'SAFETY', 
    isCompleted: false, 
    points: 40, 
    deadline: '2025-09-15' 
  },
  { 
    id: 'o5', 
    title: 'Laboratóriumi eszközhasználati tréning', 
    category: 'SAFETY', 
    isCompleted: false, 
    points: 40, 
    deadline: '2025-09-20' 
  },
  // Fázis 3: Akadémiai indítás
  { 
    id: 'o6', 
    title: 'Első féléves tárgyfelvétel (Neptun)', 
    category: 'ADMIN', 
    isCompleted: true, 
    points: 20, 
    deadline: '2025-09-12' 
  },
  { 
    id: 'o7', 
    title: 'Témavezetői nyitóértekezlet (Munkaterv egyeztetés)', 
    category: 'ADMIN', 
    isCompleted: false, 
    points: 60, 
    deadline: '2025-09-25' 
  },
  { 
    id: 'o8', 
    title: 'Kutatási adatkezelési terv (DMP) vázlat', 
    category: 'IT', 
    isCompleted: false, 
    points: 30, 
    deadline: '2025-10-01' 
  },
  { 
    id: 'o9', 
    title: 'MTMT profil létrehozása és összerendelése', 
    category: 'ADMIN', 
    isCompleted: false, 
    points: 25, 
    deadline: '2025-10-05' 
  },
  { 
    id: 'o10', 
    title: 'Bemutatkozás a tanszéki értekezleten', 
    category: 'ACCESS', 
    isCompleted: false, 
    points: 50, 
    deadline: '2025-10-10' 
  }
];

const DEFAULT_SKILLS: Skill[] = [
  { name: 'Akadémiai írás', currentLevel: 4, targetLevel: 8, category: 'RESEARCH' },
  { name: 'Statisztika', currentLevel: 5, targetLevel: 7, category: 'TECHNICAL' },
  { name: 'Prezentáció', currentLevel: 6, targetLevel: 9, category: 'SOFT' },
  { name: 'Kutatásmódszertan', currentLevel: 7, targetLevel: 9, category: 'RESEARCH' },
  { name: 'Pályázatírás', currentLevel: 2, targetLevel: 6, category: 'SOFT' },
];

const DEFAULT_REQUIREMENTS: DegreeRequirement[] = [
  { id: 'req1', title: 'Összes kredit', category: 'ACADEMIC', targetValue: 240, currentValue: 0, unit: 'kredit', isAutoCalculated: true, description: 'A 8 félév alatt megszerzendő összes kredit.' },
  { id: 'req2', title: 'Q1/Q2 Folyóiratcikk', category: 'SCIENTIFIC', targetValue: 2, currentValue: 0, unit: 'db', isAutoCalculated: false, description: 'Legalább két, magas impakt faktorú folyóiratban megjelent cikk.' },
  { id: 'req3', title: 'Konferencia előadás', category: 'SCIENTIFIC', targetValue: 4, currentValue: 0, unit: 'db', isAutoCalculated: false, description: 'Nemzetközi vagy hazai tudományos konferencián tartott előadás.' },
  { id: 'req4', title: 'Oktatási tevékenység', category: 'TEACHING', targetValue: 40, currentValue: 0, unit: 'óra', isAutoCalculated: false, description: 'BSc vagy MSc hallgatók oktatása, laborgyakorlatok tartása.' },
  { id: 'req5', title: 'Nemzetközi mobilitás', category: 'ACADEMIC', targetValue: 4, currentValue: 0, unit: 'hét', isAutoCalculated: false, description: 'Külföldi részképzés vagy kutatóút.' },
];

export const INITIAL_STUDENTS: Student[] = [
  {
    id: '1',
    name: 'Kovács Péter',
    email: 'kovacs.peter@uni.hu',
    enrollmentYear: 2022,
    supervisor: 'Dr. Nagy István',
    topic: 'Mesterséges intelligencia az orvosi diagnosztikában',
    status: StudentStatus.ACTIVE,
    totalCredits: 120,
    requiredCredits: 240,
    avatarUrl: 'https://picsum.photos/200/200',
    onboardingTasks: DEFAULT_ONBOARDING_TASKS,
    skills: DEFAULT_SKILLS,
    idpGoals: [],
    courseRecommendations: [],
    degreeRequirements: [
      { ...DEFAULT_REQUIREMENTS[0], currentValue: 120 }, // Credits
      { ...DEFAULT_REQUIREMENTS[1], currentValue: 1 },   // Q1 papers
      { ...DEFAULT_REQUIREMENTS[2], currentValue: 2 },   // Conferences
      { ...DEFAULT_REQUIREMENTS[3], currentValue: 18 },  // Teaching
      { ...DEFAULT_REQUIREMENTS[4], currentValue: 0 },   // Mobility
    ],
    tasks: [
      { id: 't1', title: 'Szakirodalom feldolgozása (Transformer modellek)', status: 'DONE', priority: 'HIGH' },
      { id: 't2', title: 'Adatbázis tisztítása', status: 'IN_PROGRESS', priority: 'MEDIUM', dueDate: '2025-02-15' },
      { id: 't3', title: 'Kísérleti környezet beállítása', status: 'TODO', priority: 'HIGH' },
      { id: 't4', title: 'Heti konzultáció előkészítése', status: 'TODO', priority: 'LOW' }
    ],
    publications: [
      {
        id: 'p1',
        title: 'Deep Learning in Oncology: A Review',
        authors: 'Kovács P., Nagy I.',
        venue: 'Medical Image Analysis Journal',
        year: 2023,
        category: 'OWN',
        status: 'PUBLISHED',
        url: 'https://doi.org/example'
      },
      {
        id: 'p2',
        title: 'Novel Transformer Architectures for CT Scans',
        authors: 'Kovács P.',
        venue: 'IEEE Access',
        year: 2024,
        category: 'OWN',
        status: 'UNDER_REVIEW'
      },
      {
        id: 'r1',
        title: 'Attention Is All You Need',
        authors: 'Vaswani et al.',
        venue: 'NIPS',
        year: 2017,
        category: 'REFERENCE',
        url: 'https://arxiv.org/abs/1706.03762'
      }
    ],
    milestones: [
      {
        id: 'm1',
        title: 'Kutatásmódszertan I.',
        type: MilestoneType.COURSE,
        credits: 5,
        deadline: '2022-12-15',
        status: MilestoneStatus.COMPLETED,
        completionDate: '2022-12-10'
      },
      {
        id: 'm2',
        title: 'Q1 Publikáció (IEEE Access)',
        type: MilestoneType.PUBLICATION,
        credits: 10,
        deadline: '2023-06-30',
        status: MilestoneStatus.COMPLETED,
        completionDate: '2023-05-20'
      },
      {
        id: 'm3',
        title: 'Komplex vizsga',
        type: MilestoneType.EXAM,
        credits: 20,
        deadline: '2024-08-31',
        status: MilestoneStatus.COMPLETED,
        completionDate: '2024-06-15'
      },
      {
        id: 'm4',
        title: 'Műhelyvita',
        type: MilestoneType.DISSERTATION,
        credits: 0,
        deadline: '2025-12-01',
        status: MilestoneStatus.PENDING
      }
    ]
  },
  {
    id: '2',
    name: 'Szabó Anna',
    email: 'szabo.anna@uni.hu',
    enrollmentYear: 2023,
    supervisor: 'Prof. Dr. Kiss Elemér',
    topic: 'Fenntartható városfejlesztés szociológiai aspektusai',
    status: StudentStatus.ACTIVE,
    totalCredits: 45,
    requiredCredits: 240,
    avatarUrl: 'https://picsum.photos/201/201',
    onboardingTasks: DEFAULT_ONBOARDING_TASKS.map(t => ({...t, isCompleted: false})),
    skills: DEFAULT_SKILLS.map(s => ({...s, currentLevel: Math.floor(Math.random() * 5) + 2})),
    idpGoals: [],
    courseRecommendations: [],
    degreeRequirements: [
      { ...DEFAULT_REQUIREMENTS[0], currentValue: 45 },
      { ...DEFAULT_REQUIREMENTS[1], currentValue: 0 },
      { ...DEFAULT_REQUIREMENTS[2], currentValue: 1 },
      { ...DEFAULT_REQUIREMENTS[3], currentValue: 10 },
      { ...DEFAULT_REQUIREMENTS[4], currentValue: 0 },
    ],
    tasks: [
      { id: 't1', title: 'Kérdőív összeállítása', status: 'IN_PROGRESS', priority: 'HIGH' },
      { id: 't2', title: 'Interjúalanyok toborzása', status: 'TODO', priority: 'MEDIUM' }
    ],
    publications: [],
    milestones: [
      {
        id: 'm1',
        title: 'Tudományfilozófia',
        type: MilestoneType.COURSE,
        credits: 5,
        deadline: '2023-12-15',
        status: MilestoneStatus.COMPLETED
      },
      {
        id: 'm2',
        title: 'Konferencia előadás (OTDK)',
        type: MilestoneType.PUBLICATION,
        credits: 5,
        deadline: '2024-04-15',
        status: MilestoneStatus.IN_PROGRESS
      }
    ]
  },
  {
    id: '3',
    name: 'Varga Gábor',
    email: 'varga.gabor@uni.hu',
    enrollmentYear: 2021,
    supervisor: 'Dr. Horváth Júlia',
    topic: 'Kvantumkriptográfia alkalmazásai',
    status: StudentStatus.ABS,
    totalCredits: 235,
    requiredCredits: 240,
    avatarUrl: 'https://picsum.photos/202/202',
    onboardingTasks: DEFAULT_ONBOARDING_TASKS.map(t => ({...t, isCompleted: true})),
    skills: DEFAULT_SKILLS.map(s => ({...s, currentLevel: Math.floor(Math.random() * 3) + 7})),
    idpGoals: [],
    courseRecommendations: [],
    degreeRequirements: [
      { ...DEFAULT_REQUIREMENTS[0], currentValue: 235 },
      { ...DEFAULT_REQUIREMENTS[1], currentValue: 3 },
      { ...DEFAULT_REQUIREMENTS[2], currentValue: 6 },
      { ...DEFAULT_REQUIREMENTS[3], currentValue: 45 },
      { ...DEFAULT_REQUIREMENTS[4], currentValue: 12 },
    ],
    tasks: [],
    publications: [],
    milestones: [
      {
        id: 'm1',
        title: 'Abszolutórium megszerzése',
        type: MilestoneType.EXAM,
        credits: 0,
        deadline: '2024-01-31',
        status: MilestoneStatus.COMPLETED
      },
      {
        id: 'm2',
        title: 'Nyilvános védés',
        type: MilestoneType.DISSERTATION,
        credits: 0,
        deadline: '2025-06-15',
        status: MilestoneStatus.PENDING
      }
    ]
  }
];

export const MOCK_SUPERVISORS: Supervisor[] = [
  {
    id: 's1',
    name: 'Dr. Nagy István',
    department: 'Mérnöki Informatikai Kar',
    capacityCurrent: 4,
    capacityMax: 5,
    researchInterests: ['Machine Learning', 'Medical Imaging', 'Deep Learning'],
    publications: [
      'Deep learning approaches for early stage lung cancer detection',
      'Neural network architectures in medical image segmentation',
      'AI in modern healthcare systems: A review',
      'Transformer models for genomic sequence analysis'
    ],
    avatarUrl: 'https://ui-avatars.com/api/?name=Nagy+Istvan&background=random'
  },
  {
    id: 's2',
    name: 'Prof. Dr. Kiss Elemér',
    department: 'Társadalomtudományi Kar',
    capacityCurrent: 2,
    capacityMax: 6,
    researchInterests: ['Urban Sociology', 'Sustainability', 'Social Structure'],
    publications: [
      'Social dynamics of sustainable smart cities',
      'Urbanization trends in Central Europe 2020-2024',
      'The sociological impact of green commuting',
      'Community resilience in modern urban environments'
    ],
    avatarUrl: 'https://ui-avatars.com/api/?name=Kiss+Elemer&background=random'
  },
  {
    id: 's3',
    name: 'Dr. Horváth Júlia',
    department: 'Természettudományi Kar',
    capacityCurrent: 5,
    capacityMax: 5,
    researchInterests: ['Quantum Physics', 'Cryptography', 'Network Security'],
    publications: [
      'Quantum key distribution protocols: Security analysis',
      'Post-quantum cryptography challenges',
      'Entanglement-based secure communication networks',
      'Physics of high-speed data transmission'
    ],
    avatarUrl: 'https://ui-avatars.com/api/?name=Horvath+Julia&background=random'
  },
  {
    id: 's4',
    name: 'Dr. Kovács-Tóth Bence',
    department: 'Gazdaságtudományi Kar',
    capacityCurrent: 1,
    capacityMax: 4,
    researchInterests: ['Behavioral Economics', 'Fintech', 'Market Analysis'],
    publications: [
      'Consumer behavior in the age of AI banking',
      'Cryptocurrency market volatility analysis',
      'Decision making patterns in stock trading',
      'The future of decentralized finance'
    ],
    avatarUrl: 'https://ui-avatars.com/api/?name=Kovacs+Bence&background=random'
  }
];
