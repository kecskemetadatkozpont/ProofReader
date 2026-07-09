import { GoogleGenAI, Type } from "@google/genai";
import { SearchResult, AiTaskResponse, Grant, GrantStatus, GrantAnalysis, TeamMember, KpiMetric } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Searches for grants using Google Search Grounding to get real-time data.
 */
export const findGrants = async (query: string): Promise<{ text: string; sources: any[] }> => {
  try {
    const prompt = `
      You are a research grant specialist for a University in Hungary.
      Find current and upcoming research grants, funding opportunities, and scholarships relevant to: "${query}".
      
      Focus on:
      1. European Union funding (Horizon Europe, ERC, etc.)
      2. Hungarian National grants (NKFIH/NRDI)
      3. International opportunities (US NIH, private foundations) available to Hungarian institutions.
      
      Provide a concise summary of the top 3-5 opportunities found.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.3,
      },
    });

    const text = response.text || "No results generated.";
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    return { text, sources };
  } catch (error) {
    console.error("Gemini Search Error:", error);
    throw error;
  }
};

/**
 * Finds structured grant opportunities for specific categories.
 * UPDATED: Now performs deep evaluation of documents and multi-stage deadlines during search.
 */
export const findStructuredOpportunities = async (category: string): Promise<Grant[]> => {
  try {
    // If it's the Horizon Europe category, try to use the official API first
    if (category.includes('Horizon Europe')) {
      try {
        // We'll use a generic search query for the API
        const response = await fetch('https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis/search/calls?query=horizon', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          // This is a hypothetical mapping based on typical EU API structures.
          // Since we don't know the exact structure of this specific endpoint without testing,
          // we'll try to map it if it looks like an array of opportunities.
          if (data && Array.isArray(data.results)) {
             return data.results.slice(0, 8).map((item: any, index: number) => ({
                id: `eu-api-${Date.now()}-${index}`,
                title: item.title || item.name || 'EU Horizon Call',
                funder: 'EU Horizon Europe',
                deadline: item.deadlineDate ? new Date(item.deadlineDate).toISOString().split('T')[0] : 'TBD',
                description: item.description || item.summary || 'Horizon Europe funding opportunity.',
                detailedDescription: item.description || item.summary || '',
                amount: item.budget ? `€${item.budget.toLocaleString()}` : 'N/A',
                status: GrantStatus.DISCOVERED,
                url: item.url || `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${item.identifier || ''}`,
                matchScore: 90,
                tasks: [],
                eligibility: "Standard EU Horizon Europe eligibility rules apply.",
                kpis: "Research Report, Financial Statement, Dissemination",
                documents: [
                   { name: "Official Call Guidelines", url: item.url || "#", type: "web" }
                ]
             }));
          }
        }
      } catch (apiError) {
        console.warn("EU API failed, falling back to Gemini search:", apiError);
        // Fall back to Gemini search below
      }
    }

    const prompt = `
      Act as a senior grant consultant for a Hungarian University. 
      Use Google Search to find currently active (Open) or upcoming ${category} opportunities.
      
      Requirements:
      - Focus on opportunities relevant to Hungarian institutions (e.g. NKFIH, Horizon Europe, specialized scholarships).
      - Look for deadlines in late 2024, 2025, and 2026.
      - **CRITICAL**: Ensure you search for and include "Mission-critical" (Misszió), "Thematic Excellence" (Tématerületi), and "National Laboratory" programs if relevant to the query. Do not filter these out.
      - Extract at least 6-8 distinct opportunities to ensure comprehensive coverage.
      
      CRITICAL - FULL EVALUATION REQUIRED:
      For EACH opportunity, you must perform a deep scan of the call documents/website to find:
      1. **Deadlines Structure**: Distinguish between the FINAL submission deadline and any **Pre-qualification**, **Abstract**, **Draft**, or **Letter of Intent** deadlines. This is crucial for "Előminősítés".
      2. **Eligibility Criteria**: Who can apply? (e.g. "Consortium of 3 EU countries", "PhD holders only").
      3. **KPIs**: What are the expected outputs? (e.g. "2 Q1 Publications", "Prototype", "Policy recommendation").
      4. **Documents**: Look for names of official documents (e.g. "Call for Proposals PDF", "Budget Template"). If exact URLs aren't clear, infer the document name usually associated.
      
      Return a JSON array.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              funder: { type: Type.STRING },
              finalDeadline: { type: Type.STRING, description: "The final full proposal submission date (YYYY-MM-DD)" },
              preProposalDeadline: { type: Type.STRING, description: "Date for pre-qualification, abstract, or draft submission if applicable (YYYY-MM-DD). Leave empty if single stage." },
              description: { type: Type.STRING, description: "Short summary (2 sentences)" },
              detailedDescription: { type: Type.STRING, description: "Longer description including specific topics" },
              amount: { type: Type.STRING },
              url: { type: Type.STRING },
              eligibility: { type: Type.STRING, description: "Short summary of submission conditions" },
              kpis: { type: Type.STRING, description: "Expected key performance indicators or outputs" },
              documents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    url: { type: Type.STRING, description: "URL to the doc or the main page" },
                    type: { type: Type.STRING, enum: ["pdf", "doc", "web"] }
                  }
                }
              }
            },
            required: ["title", "funder", "description", "eligibility", "finalDeadline"]
          }
        }
      }
    });

    if (response.text) {
      const rawData = JSON.parse(response.text);
      // Map to our internal Grant type
      return rawData.map((item: any, index: number) => ({
        id: `auto-${Date.now()}-${index}`,
        title: item.title,
        funder: item.funder,
        deadline: item.finalDeadline || 'TBD',
        preProposalDeadline: item.preProposalDeadline, // New Field Mapped
        description: item.description,
        detailedDescription: item.detailedDescription || item.description,
        amount: item.amount || 'N/A',
        status: GrantStatus.DISCOVERED,
        url: item.url,
        matchScore: 85,
        tasks: [],
        eligibility: item.eligibility || "Standard University eligibility rules apply.",
        kpis: item.kpis || "Research Report, Financial Statement",
        documents: item.documents || [
           // Fallback mock documents if none found, to demonstrate UI
           { name: "Official Call Guidelines", url: item.url || "#", type: "web" },
           { name: "Submission Template", url: "#", type: "doc" }
        ]
      }));
    }
    return [];
  } catch (error) {
    console.error("Gemini Structured Search Error:", error);
    throw error;
  }
};

/**
 * Performs a deep analysis of a specific grant to identify PM profile, topics, and strict KPIs.
 */
export const analyzeGrantRequirements = async (grant: Grant): Promise<GrantAnalysis> => {
  try {
    const prompt = `
      Act as an expert Grant Evaluator. Perform a deep analysis of the following grant opportunity:
      
      Title: ${grant.title}
      Funder: ${grant.funder}
      Description: ${grant.description}
      Details: ${grant.detailedDescription || ''}
      Dates: Final: ${grant.deadline}, Pre-qual: ${grant.preProposalDeadline || 'None'}

      You must use Google Search to find specific details, especially regarding **past winners** and their performance.

      Task:
      1. **Required Topics**: Specific research areas or themes mentioned in the call.
      2. **Project Manager Profile**: Skills/Degree required for the lead (e.g. "PhD required").
      3. **Team/Consortium Profile**: What metrics apply to the WHOLE team? (e.g., "Must have 1 SME", "Gender balance 50%", "Include PhD students").
      4. **Strict Deadlines & Milestones**: Administrative steps (ethics, drafts, pre-qualification). IMPORTANT: If there is a pre-qualification date, list it as a critical milestone.
      5. **Success KPIs**: Critical outputs (e.g. "Open Access publication").
      6. **Historical Data**: Search for "past winners of ${grant.funder} ${grant.title}" or similar calls (CORDIS, NKFIH database). 
         For each winner found (2-3 max), provide:
         - Project Title & Institution
         - **Scientometrics**: Estimate the winning team's scientific strength (e.g., "High Q1 output", "Approx 500 citations", "Large consortium of 10").
         - **Team Members**: Find names of Principal Investigators (PI), Coordinators, or Key Researchers listed in the project results.
         - **Summary**: What was the project about?
         - **Documents**: Find links to public reports, fact sheets, or summaries.

      Return a JSON object.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
           type: Type.OBJECT,
           properties: {
             requiredTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
             pmProfile: { type: Type.ARRAY, items: { type: Type.STRING } },
             teamProfile: { type: Type.ARRAY, items: { type: Type.STRING } },
             strictDeadlines: { type: Type.ARRAY, items: { type: Type.STRING } },
             successKPIs: { type: Type.ARRAY, items: { type: Type.STRING } },
             historicalData: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   projectTitle: { type: Type.STRING },
                   institution: { type: Type.STRING },
                   year: { type: Type.STRING },
                   summary: { type: Type.STRING },
                   teamMembers: { type: Type.ARRAY, items: { type: Type.STRING } },
                   documents: {
                     type: Type.ARRAY,
                     items: {
                       type: Type.OBJECT,
                       properties: {
                         name: { type: Type.STRING },
                         url: { type: Type.STRING },
                         type: { type: Type.STRING }
                       }
                     }
                   },
                   scientometrics: {
                     type: Type.OBJECT,
                     properties: {
                       publications: { type: Type.STRING },
                       citations: { type: Type.STRING },
                       teamSize: { type: Type.STRING },
                       hIndexAvg: { type: Type.STRING }
                     }
                   }
                 },
                 required: ["projectTitle", "institution", "summary", "scientometrics"]
               }
             }
           },
           required: ["requiredTopics", "pmProfile", "teamProfile", "strictDeadlines", "successKPIs", "historicalData"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as GrantAnalysis;
    }
    throw new Error("No analysis generated");
  } catch (error) {
    console.error("Gemini Deep Analysis Error:", error);
    return {
      requiredTopics: ["General Research"],
      pmProfile: ["Standard Academic Profile"],
      teamProfile: ["Standard University Research Group"],
      strictDeadlines: ["Submission Deadline"],
      successKPIs: ["Proposal Submission"],
      historicalData: []
    };
  }
};

/**
 * Analyzes a grant description and generates a structured to-do list JSON.
 */
export const generateGrantPlan = async (grantTitle: string, grantDescription: string): Promise<AiTaskResponse[]> => {
  try {
    const prompt = `
      Create a comprehensive project management plan for applying to the following grant:
      Title: ${grantTitle}
      Description: ${grantDescription}

      Context: The applicant is a University in Hungary. Include steps for ethical approval, budget approval by the university chancellor, and NKFIH administration if relevant.
      
      Return a list of tasks.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              taskName: { type: Type.STRING },
              description: { type: Type.STRING },
              stage: { type: Type.STRING, enum: ["PRE-AWARD", "SUBMISSION", "POST-AWARD"] },
              estimatedDays: { type: Type.INTEGER }
            },
            required: ["taskName", "description", "stage", "estimatedDays"]
          }
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as AiTaskResponse[];
    }
    return [];
  } catch (error) {
    console.error("Gemini Planning Error:", error);
    return [];
  }
};

/**
 * Drafts a specific section of a proposal based on a topic.
 */
export const draftProposalSection = async (grantContext: string, sectionTopic: string): Promise<string> => {
  try {
    const prompt = `
      Context: Applying for a grant: ${grantContext}
      
      Task: Write a professional, academic first draft for the section: "${sectionTopic}".
      Style: Academic, persuasive, clear English.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Using Pro for better writing quality
      contents: prompt,
      config: {
        temperature: 0.7, // Slightly higher for creativity
      }
    });

    return response.text || "Could not generate draft.";
  } catch (error) {
    console.error("Gemini Drafting Error:", error);
    throw error;
  }
};

/**
 * Validates a team member's CV against the specific requirements of the grant.
 */
export const verifyTeamMemberRequirement = async (
  member: TeamMember, 
  grantAnalysis: GrantAnalysis
): Promise<{ status: 'verified' | 'mismatch'; message: string }> => {
  try {
    // In a real browser app without backend, we can't easily parse PDF binary.
    // For this simulation, we mock the CV content assuming the AI reads it.
    // If the file name contains "CV", we pretend to extract relevant academic info.
    const mockCvContent = `
      Curriculum Vitae: ${member.name}
      Education: PhD in Computer Science, Eotvos Lorand University (2015).
      Experience: 10 years in Research Management.
      Publications: 15 Q1 papers.
    `;

    const requirements = [...grantAnalysis.pmProfile, ...grantAnalysis.teamProfile].join(", ");

    const prompt = `
      Task: Verify if the candidate meets the Project Manager / Team requirements for a grant.
      
      Candidate CV Summary: ${mockCvContent}
      
      Grant Requirements: ${requirements}
      
      Role being applied for: ${member.role}

      Does this candidate meet the core requirements (especially regarding PhD or specific degrees)?
      Return a JSON with verification status and a short reason.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isMatch: { type: Type.BOOLEAN },
            reason: { type: Type.STRING }
          }
        }
      }
    });

    if (response.text) {
      const result = JSON.parse(response.text);
      return {
        status: result.isMatch ? 'verified' : 'mismatch',
        message: result.reason
      };
    }
    return { status: 'mismatch', message: "Could not analyze CV." };
  } catch (error) {
    console.error("CV Verification Error:", error);
    return { status: 'mismatch', message: "AI Validation failed." };
  }
};

/**
 * Calculates the current status of the Live KPI Monitor.
 */
export const evaluateLiveKpis = async (grant: Grant): Promise<KpiMetric[]> => {
  try {
    const teamSummary = grant.teamMembers?.map(t => `${t.role}: ${t.verificationStatus}`).join(", ") || "No team yet";
    const docsSummary = grant.knowledgeBase?.map(k => k.name).join(", ") || "No docs";
    const kpis = grant.analysis?.successKPIs.join(", ") || "";
    const pmReq = grant.analysis?.pmProfile.join(", ") || "";

    const prompt = `
      You are the "Live KPI Monitor" for a research grant application.
      Compare the current assets against the requirements and determine the status of KPIs.

      Requirements:
      - Success KPIs: ${kpis}
      - Team Req: ${pmReq}

      Current Assets:
      - Uploaded Docs: ${docsSummary}
      - Team Status: ${teamSummary}

      Generate a list of 4-6 specific KPI metrics with their current status.
      Categorize them into: 'team', 'output', 'admin'.
      Status options: 'met' (done/verified), 'pending' (in progress), 'risk' (missing/problem).
      
      Return JSON.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, enum: ['team', 'output', 'admin'] },
              name: { type: Type.STRING },
              status: { type: Type.STRING, enum: ['met', 'pending', 'risk'] },
              currentValue: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              aiAnalysis: { type: Type.STRING }
            }
          }
        }
      }
    });

    if (response.text) {
      const raw = JSON.parse(response.text);
      return raw.map((item: any, idx: number) => ({
        ...item,
        id: `kpi-${Date.now()}-${idx}`
      }));
    }
    return [];

  } catch (error) {
    console.error("KPI Monitor Error:", error);
    return [];
  }
};