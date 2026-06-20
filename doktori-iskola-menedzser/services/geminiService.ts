import { GoogleGenAI } from "@google/genai";
import { Student, Supervisor, SupervisorMatchResult, Skill, IDPGoal, CourseRecommendation, Publication } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface GrantRecommendation {
  name: string;
  type: string;
  amount: string;
  deadline: string;
  matchScore: string; // High/Medium/Low
  reason: string;
}

export interface FinancialYearData {
  semester: number;
  yearLabel: string; // e.g., "1. év / 1."
  scholarshipIncome: number;
  livingExpenses: number;
  gap: number;
}

export interface FinancialPlanResult {
  projections: FinancialYearData[];
  grants: GrantRecommendation[];
  summary: string;
}

export interface IDPResult {
    skills: Skill[];
    goals: IDPGoal[];
    courses: CourseRecommendation[];
}

export const analyzeStudentProgress = async (student: Student): Promise<string> => {
  try {
    const studentData = JSON.stringify({
      name: student.name,
      year: student.enrollmentYear,
      topic: student.topic,
      completedCredits: student.totalCredits,
      requiredCredits: student.requiredCredits,
      milestones: student.milestones.map(m => ({
        title: m.title,
        type: m.type,
        status: m.status,
        deadline: m.deadline
      }))
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        You are a strict but helpful PhD Program Director and Academic Advisor.
        Analyze the progress of the following student based on the provided JSON data.
        Language: Hungarian.
        
        Tasks:
        1. Evaluate their credit progress relative to their enrollment year (Current year is 2025).
        2. Identify any missing critical milestones (e.g., lack of publications, delayed complex exam).
        3. Calculate a rough "Risk Assessment" (Low/Medium/High) and explain why.
        4. Suggest 3 concrete actions for the student or supervisor to take in the next 6 months.
        
        Student Data:
        ${studentData}

        Format the output as a Markdown structured response.
      `,
      config: {
        thinkingConfig: { thinkingBudget: 1024 }
      }
    });

    return response.text || "Nem sikerült az elemzést legenerálni.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Hiba történt az AI elemzés során. Kérjük, ellenőrizze az API kulcsot.";
  }
};

export const suggestNewMilestones = async (topic: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `
              Adott egy PhD hallgató a következő témával: "${topic}".
              Javasolj 5 konkrét, tudományosan releváns mérföldkövet (milestone) a következő 4 évre.
              A mérföldkövek között legyen publikáció, konferencia, és tantárgy is.
              
              Válaszformátum (JSON lista):
              [
                { "title": "...", "type": "PUBLICATION" | "COURSE" | "EXAM", "credits": number, "deadlineOffsetMonths": number }
              ]
              Csak a JSON tömböt add vissza, semmi mást.
            `,
             config: {
                responseMimeType: "application/json"
             }
        });
        return response.text || "[]";
    } catch (e) {
        console.error(e);
        return "[]";
    }
}

export const findSupervisorMatches = async (studentTopic: string, supervisors: Supervisor[]): Promise<SupervisorMatchResult[]> => {
  try {
    const supervisorData = supervisors.map(s => ({
      id: s.id,
      name: s.name,
      researchInterests: s.researchInterests,
      recentPublications: s.publications
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        Task: Match a PhD student's research topic to potential supervisors based on scientific relevance.
        Student Topic: "${studentTopic}"
        
        Potential Supervisors (JSON):
        ${JSON.stringify(supervisorData)}

        Instructions:
        1. Analyze the semantic similarity between the student's topic and each supervisor's publications/interests.
        2. Assign a "matchScore" (0-100) for each supervisor.
        3. Provide a brief "reasoning" (in Hungarian) explaining why they are a good or bad fit, citing specific keywords or publication themes.
        
        Output Format: JSON array containing objects with keys: "supervisorId", "matchScore", "reasoning".
        Return ONLY the JSON.
      `,
      config: {
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text || "[]");
    return result;
  } catch (e) {
    console.error("Matching error:", e);
    return [];
  }
};

export const generateFinancialPlan = async (topic: string): Promise<FinancialPlanResult | null> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        Task: Generate a 4-year financial simulation for a PhD student in Hungary (2025-2029).
        Topic: "${topic}"

        1. Projections:
           - Calculate monthly state scholarship (Standard Hungarian defaults: ~140,000 HUF for first 2 years, ~180,000 HUF for next 2 years).
           - Estimate monthly living expenses in a major Hungarian university city (inflation adjusted over 4 years).
           - "gap" = scholarshipIncome - livingExpenses.
           - Create data for 8 semesters.

        2. Grant Recommendations:
           - Recommend 3-4 specific grants available in Hungary (e.g., ÚNKP, Kooperatív Doktori Program (KDP), Erasmus+, Campus Mundi, Predoc).
           - Determine if "Kooperatív" is suitable based on the topic (industrial relevance).
           - Provide estimated amount, next deadline (approximate), and "reason" for recommendation.

        Output Format (JSON):
        {
          "projections": [
            { "semester": 1, "yearLabel": "1. év / 1. félév", "scholarshipIncome": 140000, "livingExpenses": 250000, "gap": -110000 },
            ... up to 8
          ],
          "grants": [
             { "name": "ÚNKP-25", "type": "National", "amount": "100.000 Ft/hó", "deadline": "2025. június", "matchScore": "High", "reason": "..." }
          ],
          "summary": "Short summary text in Hungarian about the financial outlook."
        }
      `,
      config: {
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(response.text || "null");
  } catch (e) {
    console.error("Financial plan error:", e);
    return null;
  }
};

export const generateIDP = async (student: Student): Promise<IDPResult | null> => {
    try {
        const inputData = {
            topic: student.topic,
            year: student.enrollmentYear,
            currentSkills: student.skills,
            publicationCount: student.publications.filter(p => p.category === 'OWN').length
        };

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `
              Task: Create an Individual Development Plan (IDP) and Competence Assessment for a PhD student.
              Input Data: ${JSON.stringify(inputData)}
              
              Requirements:
              1. Skills: Review the "currentSkills". Adjust "currentLevel" (1-10) and "targetLevel" based on the student's progress and topic complexity. Add missing critical skills if needed.
              2. Goals: Generate 3-4 SMART goals (IDPGoal) for the next semester.
              3. Courses: Recommend 3 specific courses or workshops (CourseRecommendation) to close the skill gaps (e.g., if Academic Writing is low, recommend a writing workshop).
              
              Output Format (JSON):
              {
                "skills": [{ "name": "...", "currentLevel": 5, "targetLevel": 8, "category": "..." }],
                "goals": [{ "id": "g1", "title": "...", "deadline": "2025-...", "status": "PLANNED", "relatedSkill": "..." }],
                "courses": [{ "title": "...", "provider": "...", "focusSkill": "...", "duration": "..." }]
              }
            `,
            config: {
                responseMimeType: "application/json"
            }
        });
        
        return JSON.parse(response.text || "null");
    } catch (e) {
        console.error("IDP generation error:", e);
        return null;
    }
};

export const fetchMTMTPublications = async (authorName: string): Promise<Publication[]> => {
    // Mocking an MTMT API call
    return new Promise((resolve) => {
        setTimeout(() => {
            const mockNewPubs: Publication[] = [
                {
                    id: `mtmt-${Math.random()}`,
                    title: 'Advanced Neural Architectures for Medical Imaging',
                    authors: `${authorName}, Smith J.`,
                    venue: 'International Journal of Computer Vision',
                    year: 2024,
                    category: 'OWN',
                    status: 'PUBLISHED',
                    url: 'https://mtmt.hu/example1',
                    source: 'MTMT',
                    odtSynced: false
                },
                {
                    id: `mtmt-${Math.random()}`,
                    title: 'Ethical Considerations in AI Healthcare',
                    authors: `${authorName}, Doe A.`,
                    venue: 'IEEE Ethics Symposium',
                    year: 2024,
                    category: 'OWN',
                    status: 'ACCEPTED',
                    url: 'https://mtmt.hu/example2',
                    source: 'MTMT',
                    odtSynced: false
                }
            ];
            resolve(mockNewPubs);
        }, 1500);
    });
};
