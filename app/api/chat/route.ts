import { readFile } from "node:fs/promises";
import { openai } from "@ai-sdk/openai";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import {
  convertToModelMessages,
  generateObject,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod/v4";
import { cleanCsvData, getAuth } from "@/helpers";

export const maxDuration = 30; // seconds

interface TabAnalysis {
  [tabName: string]: string;
}

interface TabMindmap {
  generated_at: string;
  total_tabs_analyzed: number;
  tab_analysis: TabAnalysis;
}

const tabsMindmap: TabMindmap = await readFile(
  "./tabs_mindmap.json",
  "utf-8",
).then(JSON.parse);
const tabsSummary = Object.entries(tabsMindmap.tab_analysis)
  .map(([t, d]) => `- ${t}: ${d.replace(/\n/g, " ")}`)
  .join("\n");

// In-memory cache for sheet fetches (lifecycle-limited)
const sheetCache = new Map<
  string,
  { data: string; rowCount: number; approxChars: number }
>();

type ProposedTab = { name: string; reason?: string };

async function getChosenTabs(userQuestion: string) {
  console.log("Selecting tabs for question...");
  if (!userQuestion) {
    throw new Error("User question too short or empty");
  }
  const tabClassificationPrompt = `You are a financial model navigator. Given a user question and tab summaries, choose the minimal essential set (1-8) of tab names to inspect. Return STRICT JSON only.
Rules:
- Exact tab names only (case-sensitive as provided)
- Prefer specificity; include a control/assumption tab only if needed
Format:
{"tabs":[{"name":"tab-name","reason":"why"}]}
TAB SUMMARIES:\n${tabsSummary}`;

  const { object } = await generateObject({
    model: openai("gpt-5-nano"),
    system: tabClassificationPrompt,
    messages: [{ role: "user", content: userQuestion }],
    schema: z.object({
      tabs: z
        .array(z.object({ name: z.string(), reason: z.string().optional() }))
        .max(8),
    }),
  });

  console.log("Tab selection result", object);

  let chosenTabs: ProposedTab[] = object.tabs;

  if (!chosenTabs.length) {
    chosenTabs = Object.entries(tabsMindmap.tab_analysis)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([name]) => ({ name, reason: "Fallback heuristic: rich summary" }));
  }

  const chosenTabsSummary = chosenTabs
    .map((t) => `- ${t.name}${t.reason ? ` (${t.reason})` : ""}`)
    .join("\n");

  return { chosenTabs, chosenTabsSummary };
}

function getUserQuestion(messages: UIMessage[]): string {
  const userMessages = messages.filter((m) => m.role === "user");
  if (!userMessages.length) return ""; // or throw if required
  const last = userMessages[userMessages.length - 1];
  // Concatenate all text parts (ignore non-text safely)
  return last.parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function getRows(tabName: string) {
  const auth = await getAuth();
  const client: sheets_v4.Sheets = sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return (res.data.values as string[][]) || [];
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log("QUESTION RECEIVED");

  // ---- Phase 1: Ask model which tabs to read ----
  const userQuestion = getUserQuestion(messages);

  if (!userQuestion) {
    throw new Error("No user question");
  }

  console.log("USER QUESTION", userQuestion);

  const { chosenTabs, chosenTabsSummary } = await getChosenTabs(userQuestion);

  console.log("TABS");
  console.log(JSON.stringify(chosenTabs, null, 2));

  //   throw new Error("stop");

  // ---- Phase 2: Streaming answer with tab fetch tool ----
  const readSpreadsheetTabSchema = z.object({
    tabName: z.string().describe("Exact tab name to read"),
    purpose: z
      .string()
      .describe("Why this tab is being read for the user question"),
  });

  const result = streamText({
    model: openai("gpt-5-mini"),
    messages: convertToModelMessages(messages),
    system: `You are an expert startup CFO assistant.
You MUST first call readSpreadsheetTab for EACH of these selected tabs (one call per tab) before drafting the final answer:
${chosenTabsSummary}

When ALL required tab reads are complete, produce a single comprehensive markdown answer.

Formatting Rules:
- Use valid GitHub-flavored markdown.
- Never invent metrics; if unknown, write "N/A".
- If no metric table applies, still render the section with a short sentence explaining why.
- Prefer concise numbers: 1.23M, 4.5K, 38%. Show denominators when useful.
- Keep total answer under ~600 tokens unless explicitly asked for more depth.

After ALL required tab reads are complete, immediately produce the final markdown answer (do not request additional tool calls). Each tool result may be truncated. If truncated, rely on provided metadata (rowCount, approxChars, headers) and clearly note any limitations in Risks & Caveats.
`,
    tools: {
      readSpreadsheetTab: tool({
        description:
          "Fetch and return cleaned CSV data for a specific tab (optimized for token usage)",
        inputSchema: readSpreadsheetTabSchema,
        execute: async ({
          tabName,
          purpose,
        }: z.infer<typeof readSpreadsheetTabSchema>) => {
          // Validate against chosenTabs to reduce accidental arbitrary fetches
          if (!chosenTabs.find((t) => t.name === tabName)) {
            console.warn(`Tab "${tabName}" not in approved selection list`);
            return {
              tabName,
              purpose,
              success: false,
              error: "Tab not in approved selection list",
              data: "",
            };
          }

          try {
            const cached = sheetCache.get(tabName);
            if (cached) {
              return {
                tabName,
                purpose,
                success: true,
                ...cached,
                cached: true,
              };
            }

            const rows: string[][] = await getRows(tabName);

            if (!rows.length) {
              return {
                tabName,
                purpose,
                success: false,
                message: "Tab empty",
                data: "",
              };
            }

            const data = cleanCsvData(rows);
            const record = {
              data,
              rowCount: rows.length,
              approxChars: data.length,
            };

            sheetCache.set(tabName, record);
            return { tabName, purpose, success: true, ...record };
          } catch (e) {
            return {
              tabName,
              purpose,
              success: false,
              error: e instanceof Error ? e.message : "Unknown error",
              data: "",
            };
          }
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
