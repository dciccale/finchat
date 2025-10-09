import process from "node:process";
import { writeFile } from "node:fs/promises";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { cleanCsvData, getAuth } from "@/helpers";

/**
 * Script goal:
 *  - Read every tab (sheet) in a Google Spreadsheet.
 *  - Convert its cell data to CSV (text only, ignore charts automatically).
 *  - Collapse runs of multiple empty rows into a single empty row (to save tokens).
 *  - Produce a JSON file containing an array of { "<Tab Name>": "<cleaned csv>" } objects.
 *  - Output path configurable via OUTPUT_JSON (default: sheets_export.json).
 *
 * Env vars required:
 *  - GOOGLE_CLIENT_EMAIL
 *  - GOOGLE_PRIVATE_KEY (with literal \n escaped; we'll replace)
 *  - SPREADSHEET_ID
 * Optional:
 *  - OUTPUT_JSON (filepath)
 */

async function main(): Promise<void> {
  const auth = await getAuth();
  const client: sheets_v4.Sheets = sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing SPREADSHEET_ID env var");
  }

  // 1. Get all sheet (tab) titles.
  const meta = await client.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title,sheets.properties.hidden",
  });

  const titles = (meta.data.sheets || [])
    .filter((s) => !s.properties?.hidden)
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);

  if (titles.length === 0) {
    console.warn("No sheets found in spreadsheet.");
    return;
  }

  // 2. For each sheet, fetch values and convert to cleaned CSV.
  const sheetCsvMap: Record<string, string> = {};

  for (const title of titles) {
    console.log(`Processing sheet: ${title}`);
    const range = `'${title}'`;
    const res = await client.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE", // raw-ish values
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const rows: string[][] = (res.data.values as string[][]) || [];
    const csvContent = cleanCsvData(rows);
    sheetCsvMap[title] = csvContent;
  }

  // 3. Convert to requested JSON structure: array of key:value objects.
  const arrayOutput = Object.entries(sheetCsvMap).map(([k, v]) => ({ [k]: v }));

  const outPath = process.env.OUTPUT_JSON || "sheets_export.json";
  await writeFile(outPath, JSON.stringify(arrayOutput, null, 2), "utf8");
  console.log(`Exported ${titles.length} sheets to ${outPath}`);
}

main()
  .then(() => console.log("done"))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });

// --- helpers ---
function csvEscape(value: string): string {
  if (value === undefined || value === null) return "";
  // Normalize any CRLF to LF for consistency.
  const normalized = value.replace(/\r\n?/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}
