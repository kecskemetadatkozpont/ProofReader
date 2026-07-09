import { Grant, GrantStatus } from "./types";

export const MOCK_GRANTS: Grant[] = [
  {
    id: '1',
    title: 'Horizon Europe: AI for Healthcare',
    funder: 'European Commission',
    deadline: '2024-10-15',
    description: 'Funding for innovative AI solutions in clinical settings. Requires consortium of 3 EU countries.',
    amount: '€4,000,000',
    status: GrantStatus.PLANNING,
    matchScore: 95,
    processingStatus: 'complete',
    knowledgeBase: [
      { id: 'kb1', name: 'Draft Consortium Agreement.docx', type: 'file', url: '#', addedAt: '2024-02-10', size: '2.4 MB' },
      { id: 'kb2', name: 'Dr. Kovacs CV.pdf', type: 'cv', url: '#', addedAt: '2024-02-12', size: '1.1 MB' },
      { id: 'kb3', name: 'Competitor Analysis Link', type: 'link', url: 'https://cordis.europa.eu', addedAt: '2024-02-14' },
      { id: 'kb4', name: 'Internal_Review_Round1.pdf', type: 'review', url: '#', addedAt: '2024-03-01', size: '0.5 MB' }
    ],
    teamMembers: [
        { id: 'tm1', name: 'Dr. Kovács János', role: 'Project Manager', verificationStatus: 'verified', cvName: 'Kovacs_CV.pdf', cvUrl: '#' }
    ],
    liveKpis: [
        { id: 'kpi1', category: 'team', name: 'PhD Project Manager', status: 'met', currentValue: 'Verified', targetValue: 'Required', aiAnalysis: 'Dr. Kovács holds a PhD.' },
        { id: 'kpi2', category: 'output', name: '3 Q1 Papers', status: 'risk', currentValue: '0 Uploaded', targetValue: '3', aiAnalysis: 'No draft papers found in docs.' }
    ],
    tasks: [
      { id: 't1', title: 'Find Consortium Partners', description: 'Contact partners in Germany and France', completed: true, stage: 'PRE-AWARD' },
      { id: 't2', title: 'Draft Impact Section', description: 'Focus on patient outcomes', completed: false, stage: 'SUBMISSION' }
    ],
    analysis: {
      requiredTopics: ['Machine Learning', 'Clinical Trials', 'Data Privacy'],
      pmProfile: ['Senior Researcher', 'PhD required', 'Previous EU Coordination'],
      teamProfile: ['3 EU Countries', '1 SME Partner', 'Hospital Partner'],
      strictDeadlines: ['Ethics Review by Aug 2024'],
      successKPIs: ['2 Q1 Publications', 'Open Source Tool'],
      historicalData: [
        {
          projectTitle: 'MedAI-Net 2023',
          institution: 'TU Munich',
          year: '2023',
          summary: 'Developed a federated learning network for rare disease diagnosis across 5 hospitals. Focused heavily on privacy-preserving ML.',
          documents: [{ name: 'Project Factsheet', url: '#', type: 'web' }, { name: 'Final Report PDF', url: '#', type: 'pdf' }],
          teamMembers: ['Prof. Dr. Hans Müller', 'Dr. Sarah Schmidt', 'Dr. Jean Dupont'],
          scientometrics: {
            publications: '15 Q1 Papers',
            citations: '450+',
            teamSize: '12 Partners',
            hIndexAvg: '35'
          }
        },
        {
          projectTitle: 'HealthBot Vision',
          institution: 'Karolinska Institute',
          year: '2022',
          summary: 'Computer vision system for early dermatology screening. Successful clinical validation in Sweden and Norway.',
          documents: [{ name: 'Cordis Result', url: '#', type: 'web' }],
          teamMembers: ['Prof. Lars Svensson', 'Dr. Elena Rossi'],
          scientometrics: {
            publications: '8 Q1 Papers',
            citations: '200+',
            teamSize: '8 Partners',
            hIndexAvg: '28'
          }
        }
      ]
    }
  },
  {
    id: '2',
    title: 'NKFIH OTKA Thematic Research',
    funder: 'National Research, Development and Innovation Office (Hungary)',
    deadline: '2024-05-20',
    description: 'Basic research funding for Hungarian universities in natural sciences.',
    amount: '48,000,000 HUF',
    status: GrantStatus.SUBMITTED,
    matchScore: 88,
    processingStatus: 'complete',
    knowledgeBase: [],
    tasks: [],
    teamMembers: [],
    analysis: {
      requiredTopics: ['Material Science', 'Nanotechnology'],
      pmProfile: ['Hungarian Citizen', 'PhD Degree'],
      teamProfile: ['Research Group (min 3)'],
      strictDeadlines: ['University Chancellor Approval'],
      successKPIs: ['3 International Pubs'],
      historicalData: [
        {
          projectTitle: 'Nano-Composite Structures',
          institution: 'BME (Budapest University of Tech)',
          year: '2022',
          summary: 'Investigation of graphene-oxide composites for aerospace applications.',
          documents: [],
          teamMembers: ['Dr. Nagy Péter', 'Kovács Éva (PhD Student)'],
          scientometrics: {
            publications: '5 Q1 Papers',
            citations: '120',
            teamSize: '4 Researchers',
            hIndexAvg: '18'
          }
        }
      ]
    }
  },
  {
    id: '3',
    title: 'ERC Advanced Grant',
    funder: 'European Research Council',
    deadline: '2024-08-29',
    description: 'High-risk, high-gain research for established research leaders.',
    amount: '€2,500,000',
    status: GrantStatus.DISCOVERED,
    matchScore: 60,
    processingStatus: 'complete',
    knowledgeBase: [],
    tasks: [],
    teamMembers: [],
    analysis: {
        requiredTopics: ['Any Field'],
        pmProfile: ['Track record of significant research achievements'],
        teamProfile: ['Host Institution Support'],
        strictDeadlines: [],
        successKPIs: [],
        historicalData: []
    }
  }
];

export const OFFICE_CURATED_GRANTS: Grant[] = [
  {
    id: 'curated-1',
    title: 'Erasmus+ KA131 Mobility 2025',
    funder: 'Tempus Public Foundation',
    deadline: '2025-02-20',
    description: 'Internal call for academic staff mobility support. Priority given to partnerships with German and Austrian universities.',
    amount: 'Allocated per diem',
    status: GrantStatus.DISCOVERED,
    matchScore: 100,
    processingStatus: 'complete',
    url: '#',
    tasks: []
  },
  {
    id: 'curated-2',
    title: 'University Innovation Fund (EKK) - Proof of Concept',
    funder: 'University Research Office',
    deadline: '2024-11-30',
    description: 'Seed funding for validating research results with market potential. Open to all faculties.',
    amount: '5,000,000 HUF',
    status: GrantStatus.DISCOVERED,
    matchScore: 100,
    processingStatus: 'complete',
    url: '#',
    tasks: []
  },
  {
    id: 'curated-3',
    title: 'Horizon Europe "Culture & Creativity" - Pre-selection',
    funder: 'EU Commission / University Support',
    deadline: '2025-01-15',
    description: 'The Grant Office is forming a consortium led by our Humanities Faculty. Looking for PI contributions.',
    amount: 'Consortium Share',
    status: GrantStatus.DISCOVERED,
    matchScore: 90,
    processingStatus: 'complete',
    url: '#',
    tasks: []
  }
];
