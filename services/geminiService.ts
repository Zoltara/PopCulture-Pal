import { GoogleGenAI, Type } from "@google/genai";
import { FavoriteItem, RecommendationResponse } from "../types";

const apiKey = process.env.API_KEY || '';

// Initialize the client strictly with the API key from environment variables
const ai = new GoogleGenAI({ apiKey });

export const getRecommendations = async (favorites: FavoriteItem[], excludeTitles: string[] = []): Promise<RecommendationResponse> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY.");
  }

  if (favorites.length === 0) {
    return { recommendations: [] };
  }

  const favoritesSummary = favorites.map(f => 
    `- [${f.category}]: ${f.title} ${f.details ? `(${f.details})` : ''}`
  ).join('\n');

  const distinctCategories = Array.from(new Set(favorites.map(f => f.category)));

  const categoryInstructions = distinctCategories.map(cat => 
    `For the category "${cat}", provide exactly 3 distinct recommendations that fit the vibe.`
  ).join('\n');

  const excludeInstruction = excludeTitles.length > 0 
    ? `IMPORTANT: Do NOT recommend any of the following titles as I have already seen them: ${excludeTitles.join(', ')}.`
    : '';

  const prompt = `
    Here is a list of my favorite entertainment media:
    ${favoritesSummary}

    Based on the style, genre, tone, and vibe of these favorites, please recommend content matching the categories I have listed.

    ${categoryInstructions}

    ${excludeInstruction}

    STRICT RULES FOR REASONING:
    1. Provide a short, punchy reason why you chose it.
    2. IMPORTANT: If a recommended Book has a movie/TV adaptation, you MUST mention it in the reason (e.g., "Also a movie").
    3. IMPORTANT: If a recommended Movie/TV Series is based on a book, you MUST mention it in the reason (e.g., "Based on the book by...").
    
    STRICT RULES FOR DATA FIELDS:
    - title: The name of the work.
    - creator: 
       - If Category is "Book", this MUST be the Author's name.
       - If Category is "Music", this MUST be the Artist/Band name.
       - If Category is "Movie" or "TV Series", provide the primary Director or Showrunner name.
    
    The recommendations should fit the same "universe" or "feeling" as the collected list.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  title: { type: Type.STRING },
                  creator: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ["category", "title", "reason"],
              },
            },
          },
          required: ["recommendations"],
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("No response from Gemini.");
    }

    return JSON.parse(jsonText) as RecommendationResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to fetch recommendations. Try again!");
  }
};

export const getWorksByCreator = async (creator: string, category: string, currentTitle: string): Promise<RecommendationResponse> => {
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const prompt = `
    I liked the ${category} "${currentTitle}" by ${creator}.
    
    Please recommend 3 OTHER popular or highly-rated works specifically by ${creator}.
    
    STRICT RULES:
    1. Do NOT include "${currentTitle}".
    2. Category must be "${category}".
    3. Creator must be "${creator}".
    4. Reason should be a brief description of the plot or style.

    STRICT OUTPUT FORMAT (JSON):
    Return an object with a "recommendations" array containing the items.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  title: { type: Type.STRING },
                  creator: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ["category", "title", "reason"],
              },
            },
          },
          required: ["recommendations"],
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) return { recommendations: [] };
    return JSON.parse(jsonText) as RecommendationResponse;
  } catch (error) {
    console.error("Gemini Creator Lookup Error:", error);
    throw new Error(`Failed to find more works by ${creator}`);
  }
};

export interface LookupResult {
  text: string;
  sources: { uri: string; title: string }[];
}

export const lookupMediaInfo = async (
  query: string, 
  mode: 'streaming' | 'israeli', 
  searchCurrentAiring: boolean = false, 
  channelContext?: { name: string; url: string }
): Promise<LookupResult> => {
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let prompt = "";
  if (mode === 'streaming') {
    prompt = `You are a helpful media assistant. User is asking: Where can I stream "${query}"?
    Context: Today is ${today}.

    Instructions:
    1. List major streaming platforms (Netflix, Amazon Prime, HBO, Disney+, Hulu, Apple TV+, etc.).
    2. If it is a TV Series, provide a breakdown for EACH season.
    3. If it is a Movie, just provide the runtime.
    4. Mention any confirmed "Coming Soon" dates.

    STRICT OUTPUT FORMAT for TV Series:
    Available on: **[Platform 1]**, **[Platform 2]**
    Total: [X] Seasons, [Y] Episodes
    Season 1: [Count] Episodes (Start Date)
    ...
    **Coming Soon:** [Info]

    STRICT OUTPUT FORMAT for Movies:
    Available on: **[Platform 1]**, **[Platform 2]**
    Runtime: [Hours]h [Minutes]m
    **Coming Soon:** [Info]`;
  } else {
    // Israeli Mode
    if (channelContext) {
      prompt = `Using the Google Search tool, specifically look at the Israeli channel/platform ${channelContext.name} (${channelContext.url}) and identify 5-7 popular or NEW series currently available or broadcasting there.
      
      Context: Today is ${today}.
      
      For EACH series, follow this format:
      **Series Name** - [Hebrew Name]
      [Total Seasons] Seasons
      Status: [e.g., Actively Broadcasting / New Episodes Weekly / Completed]
      Last Aired: [Most recent date]
      Description: [One sentence about the vibe]
      
      Provide a comprehensive list based on the latest data from ${channelContext.url}.`;
    } else if (searchCurrentAiring) {
      prompt = `Using Google Search, find the 5 most popular Israeli TV series currently airing or having just premiered in the last 3 months across channels like Kan 11, Keshet 12, Reshet 13, YES, and HOT.
      
      Context: Today is ${today}.
      
      For EACH series:
      **Series Name** - [Hebrew Name] (**Channel**)
      Last Aired: [Date]
      **Next Episode / Coming Soon:** [Date/Info]
      
      Focus on active season shows from 2024/2025.`;
    } else {
      prompt = `Provide specific details for the Israeli TV series "${query}". 
      Context: Today is ${today}.
      Use Google Search to find the most up-to-date broadcast schedule and season information.

      STRICT OUTPUT FORMAT:
      **[Channel Name]** - [Hebrew Name]
      Total: [X] Seasons, [Y] Episodes
      Last Aired Episode: [Date]
      **Coming Soon:** [Date/Info] (Only if applicable)
      
      Season 1: [Count] Episodes (Start Date)
      ... (continue for all seasons)`;
    }
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "Could not find info.";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title,
      }));

    return { text, sources };
  } catch (error) {
    console.error("Gemini Lookup Error:", error);
    throw new Error("Failed to lookup info. Please check your connection.");
  }
};

export interface EpisodeStatusResult {
  text: string;
  sources: { uri: string; title: string }[];
}

export const checkNewEpisodes = async (seriesList: string[]): Promise<EpisodeStatusResult> => {
  if (!apiKey) throw new Error("API Key is missing.");
  if (seriesList.length === 0) throw new Error("No series to check.");

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const listStr = seriesList.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const prompt = `Using Google Search, check the latest episode status for each of these TV series:

${listStr}

Today is ${today}.

For EACH series, output a section in this format:
**[Series Name]**
Status: [One of: ✅ New Episodes Available | 🔜 New Season Confirmed | 🎬 In Production | ⏳ Renewal Pending | ❌ Cancelled / Ended]
Latest Info: [One or two sentences about the most recent episode, upcoming season, or finale. Include dates where known.]

Separate each series with a blank line. Use Google Search to get the most up-to-date information available.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "Could not retrieve episode status.";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title,
      }));

    return { text, sources };
  } catch (error) {
    console.error("Gemini Episode Check Error:", error);
    throw new Error("Failed to check episode status. Please try again.");
  }
};