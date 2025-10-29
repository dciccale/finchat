import { JWT } from "google-auth-library";

// Cache the JWT client so we don't re-create it for every request/script run.
let cachedJwt: JWT | null = null;

export async function getAuth(): Promise<JWT> {
  if (cachedJwt) return cachedJwt;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, "\n") : undefined;
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  if (!email || !privateKey) {
    throw new Error(
      "Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY environment variables.",
    );
  }
  cachedJwt = new JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return cachedJwt;
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
