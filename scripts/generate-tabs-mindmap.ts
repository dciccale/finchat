import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";

interface SheetData {
  [tabName: string]: string;
}

interface TabAnalysis {
  [tabName: string]: string;
}

// ---------- Simple context window protection (fixed word cap heuristic) ----------
// Assumption: 4 tokens ≈ 1 word (user preference). Model context ≈ 131k tokens.
// Choose 30k words ≈ 120k tokens, leaving ~11k tokens buffer for prompt scaffolding.
const MAX_WORDS = 30_000;

function truncateByWords(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= MAX_WORDS) return text;
  return (
    words.slice(0, MAX_WORDS).join(" ") +
    `\n# TRUNCATED: original words ${words.length}, kept ${MAX_WORDS} (≈120k tokens of 131k context)`
  );
}

async function analyzeFinancialSpreadsheet() {
  console.log("Starting financial spreadsheet analysis...");

  // Read the JSON file
  const file = Bun.file("tabs_summary.json");
  const sheetsData: SheetData[] = await file.json();

  // Convert array to object for easier access
  const sheets: SheetData = {};
  for (const sheet of sheetsData) {
    Object.assign(sheets, sheet);
  }

  console.log(`Found ${Object.keys(sheets).length} tabs to analyze`);

  // Get Instructions content to include in all prompts
  const instructions = sheets["Instructions"] || "";
  console.log(
    "Instructions tab found, will include in context for all other tabs",
  );

  const analysis: TabAnalysis = {};
  const analysisResults: string[] = [];

  // Process each tab except Instructions
  for (const [tabName, csvContent] of Object.entries(sheets)) {
    if (tabName === "Instructions") {
      console.log(`Skipping Instructions tab as requested`);
      continue;
    }

    console.log(`\nAnalyzing tab: ${tabName}`);

    Bun.write("current_tab.csv", csvContent);

    try {
      // Check if tab has meaningful data
      const hasData =
        csvContent.trim().length > 0 && csvContent.split("\n").length > 1;

      let prompt: string;

      if (!hasData || csvContent.trim().length < 50) {
        console.log(`  → Tab has no useful data, skipping detailed analysis.`);
        // Tab has no useful data
        analysis[tabName] =
          "• No useful data - tab appears to be empty or contains only error values";
        console.log(`  → No useful data found in ${tabName}`);
        continue;
      }

      const truncatedCsv = truncateByWords(csvContent);

      // Create the prompt with instructions context
      prompt = `You are analyzing a financial spreadsheet tab from a startup's financial model.

CONTEXT FROM INSTRUCTIONS:
${instructions}

TAB NAME: ${tabName}
CSV CONTENT:
${truncatedCsv}

TASK: Generate a concise bullet-point summary (3-5 bullets max) of what this tab contains and what financial information it represents. Focus on:
- What type of financial data is shown (P&L, cash flow, KPIs, etc.)
- Key metrics or categories present
- Time periods covered
- Purpose of this data in the financial model

If the tab name matches any tab mentioned in the instructions, use that context to enhance your analysis.

Respond with ONLY bullet points starting with "•", be specific and concise. If there's insufficient meaningful data, respond with "• Inconclusive data - insufficient information to determine content"`;

      const result = await generateText({
        model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const analysisText = result.text.trim();
      analysis[tabName] = analysisText;

      // Add to markdown results
      analysisResults.push(`## ${tabName}\n${analysisText}\n`);

      console.log(`  ✓ Analysis complete for ${tabName}`);
      console.log(`    Preview: ${analysisText.split("\n")[0]}`);

      // Add a small delay to be respectful to the API
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`  ✗ Error analyzing ${tabName}:`, error);
      analysis[tabName] =
        "• Error occurred during analysis - unable to process this tab";
    }
  }

  console.log("\n=== CREATING OUTPUT FILES ===");

  // Create markdown output
  const markdownContent = `# Financial Spreadsheet Analysis

This document contains an AI-generated analysis of each tab in the financial spreadsheet, describing the type of data and content present in each section.

Generated on: ${new Date().toISOString()}

${analysisResults.join("\n")}

---
*This analysis was generated automatically to create a lookup reference for understanding the content and purpose of each spreadsheet tab.*
`;

  // Write markdown file
  await Bun.write("spreadsheet_analysis.md", markdownContent);
  console.log("✓ Created spreadsheet_analysis.md");

  // Create JSON output for programmatic use
  const jsonOutput = {
    generated_at: new Date().toISOString(),
    total_tabs_analyzed: Object.keys(analysis).length,
    tab_analysis: analysis,
  };

  await Bun.write("tabs_mindmap.json", JSON.stringify(jsonOutput, null, 2));
  console.log("✓ Created tabs_mindmap.json");

  console.log("\n=== SUMMARY ===");
  console.log(`Total tabs found: ${Object.keys(sheets).length}`);
  console.log(`Tabs analyzed: ${Object.keys(analysis).length}`);
  console.log(`Instructions tab: Included as context`);
  console.log("\nOutput files created:");
  console.log("- spreadsheet_analysis.md (human-readable)");
  console.log("- tabs_mindmap.json (machine-readable lookup)");

  return analysis;
}

// Run the analysis
analyzeFinancialSpreadsheet()
  .then(() => {
    console.log("\n🎉 Analysis complete!");
  })
  .catch((error) => {
    console.error("❌ Analysis failed:", error);
    process.exit(1);
  });
