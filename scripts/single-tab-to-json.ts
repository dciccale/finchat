import process from "node:process";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { cleanCsvData, getAuth } from "@/helpers";

/**
 * Script goal:
 *  - Read every tab (sheet) in a Google Spreadsheet.
 *  - Convert its cell data to CSV (text only, ignore charts automatically).
 *  - Collapse runs of multiple empty rows into a single empty row (to save tokens).
 *  - Produce a JSON file containing an array of { "<Tab Name>": "<cleaned csv>" } objects.
 *
 * Env vars required:
 *  - GOOGLE_CLIENT_EMAIL
 *  - GOOGLE_PRIVATE_KEY (with literal \n escaped; we'll replace)
 *  - SPREADSHEET_ID
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
    fields: "sheets.properties",
  });

  await Bun.write("metadata.json", JSON.stringify(meta, null, 2));
  console.log("=== META DATA === saved to metadata.json");

  const tabs = (meta.data.sheets || [])
    .filter((s) => !s.properties?.hidden)
    .map((s) => s.properties?.title);

  console.log();
  console.log("=== TITLES ===");
  console.log(tabs);
  console.log();

  // const tab = "Con-BM-M";
  const tab = "Summary Forecast";

  console.log(`Processing tab: ${tab}`);

  const range = `'${tab}'`;
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE", // raw-ish values
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  console.log(res);
  const rows: string[][] = (res.data.values as string[][]) || [];
  const csvContent = cleanCsvData(rows);

  await Bun.write(`${tab}.csv`, csvContent);

  console.log(`Exported ${tab} tab to ${tab}.csv`);
}

main()
  .then(() => console.log("done"))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
