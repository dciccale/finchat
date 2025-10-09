import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  tool,
  type UIMessage,
  generateObject,
  stepCountIs,
} from "ai";
import { z } from "zod/v4";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
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

const tabsMindmap: TabMindmap = await Bun.file("./tabs_mindmap.json").json();
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
  const tabClassificationPrompt = `You are a financial model navigator. Given a user question and tab summaries, choose the minimal essential set (1-8) of tab names to inspect. Return STRICT JSON only.
Rules:
- Exact tab names only (case-sensitive as provided)
- Prefer specificity; include a control/assumption tab only if needed
Format:
{"tabs":[{"name":"tab-name","reason":"why"}],"reasoning":"short"}
TAB SUMMARIES:\n${tabsSummary}`;

  const { object } = await generateObject({
    model: openai("gpt-4.1-nano"),
    system: tabClassificationPrompt,
    messages: [{ role: "user", content: userQuestion }],
    schema: z.object({
      tabs: z
        .array(z.object({ name: z.string(), reason: z.string().optional() }))
        .max(8),
      reasoning: z.string(),
    }),
  });

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
  return messages
    .filter((m) => m.role === "user")
    .map((m) => {
      const c: any = (m as any).content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        console.log("is array", c);
        return c
          .map((seg) => (typeof seg === "string" ? seg : seg?.text || ""))
          .join("\n");
      }
      return "";
    })
    .join("\n");
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log("QUESTION RECEIVED");

  // ---- Phase 1: Ask model which tabs to read ----
  const userQuestion = getUserQuestion(messages);

  console.log("USER QUESTION", userQuestion);

  const { chosenTabs, chosenTabsSummary } = await getChosenTabs(userQuestion);

  console.log("TABS");
  console.log(JSON.stringify(chosenTabs, null, 2));

  // ---- Phase 2: Streaming answer with tab fetch tool ----
  const readSpreadsheetTabSchema = z.object({
    tabName: z.string().describe("Exact tab name to read"),
    purpose: z
      .string()
      .describe("Why this tab is being read for the user question"),
  });

  const result = streamText({
    model: openai("gpt-5-nano"),
    messages: convertToModelMessages(messages),
    system: `You are an expert startup CFO assistant.
You MUST first call readSpreadsheetTab for EACH of these selected tabs (one call per tab) before answering:
${chosenTabsSummary}

After fetching data, synthesize:
1. Direct answer
2. Supporting metrics (tab | metric | period)
3. Interpretation / insight
4. Risks / caveats
5. Next actions

Rules:
- Cite tab names for metrics.
- If data missing/inconclusive, state limitation & suggest remediation.
- Do NOT fabricate metrics.
`,
    tools: {
      readSpreadsheetTab: tool({
        description:
          "Fetch and return cleaned CSV data for a specific tab (optimized for token usage)",
        inputSchema: readSpreadsheetTabSchema,
        // @ts-ignore execute supported at runtime
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
            const auth = await getAuth();
            const client: sheets_v4.Sheets = sheets({ version: "v4", auth });
            const spreadsheetId = process.env.SPREADSHEET_ID;
            if (!spreadsheetId)
              throw new Error("Missing SPREADSHEET_ID environment variable");
            const res = await client.spreadsheets.values.get({
              spreadsheetId,
              range: `'${tabName}'`,
              valueRenderOption: "UNFORMATTED_VALUE",
              dateTimeRenderOption: "FORMATTED_STRING",
            });
            const rows: string[][] = (res.data.values as string[][]) || [];
            if (!rows.length)
              return {
                tabName,
                purpose,
                success: false,
                message: "Tab empty",
                data: "",
              };
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
