import { GoogleAuth } from "google-auth-library";

export async function getAuth(): Promise<GoogleAuth> {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, "\n") : undefined;
  if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
    throw new Error(
      "Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY environment variables.",
    );
  }
  return new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function cleanCsvData(rows: string[][]): string {
  let maxCols = 0; // retained if future optimization needed
  for (const r of rows) {
    let end = r.length - 1;
    while (
      end >= 0 &&
      (r[end] === null || r[end] === undefined || r[end] === "")
    )
      end--;
    const trimmed = r.slice(0, end + 1);
    if (trimmed.length > maxCols) maxCols = trimmed.length;
  }
  const csvLines: string[] = [];
  for (const r of rows) {
    let end = r.length - 1;
    while (
      end >= 0 &&
      (r[end] === null || r[end] === undefined || r[end] === "")
    )
      end--;
    const trimmed = r.slice(0, end + 1);
    csvLines.push(trimmed.map((v) => csvEscape(String(v ?? ""))).join(","));
  }
  const compressed: string[] = [];
  let lastEmpty = false;
  for (const line of csvLines) {
    const isEmpty = line.trim() === "";
    if (isEmpty) {
      if (!lastEmpty) compressed.push("");
      lastEmpty = true;
    } else {
      compressed.push(line);
      lastEmpty = false;
    }
  }
  while (compressed[0] === "") compressed.shift();
  while (compressed[compressed.length - 1] === "") compressed.pop();
  return compressed.join("\n");
}

function csvEscape(value: string): string {
  if (value === undefined || value === null) return "";
  const normalized = value.replace(/\r\n?/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}
