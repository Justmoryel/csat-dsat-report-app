import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const ratingCol = "How would you rate the quality of the work we completed?";
const npsGroup = "NPSExistingBrandNPSSection";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return matrixToObjects(rows);
}

function matrixToObjects(matrix) {
  const clean = matrix.filter((r) => Array.isArray(r) && r.some((v) => v !== null && v !== undefined && String(v).trim() !== ""));
  if (!clean.length) return [];
  const headers = clean.shift().map((h, idx) => String(h ?? "").replace(/^\uFEFF/, "").trim() || `Column ${idx + 1}`);
  return clean.map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] == null ? "" : String(r[idx]).trim();
    });
    return obj;
  });
}

async function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
  });
  return matrixToObjects(matrix);
}

function toNum(value) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function parseDate(value) {
  if (!value) return new Date(NaN);
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400 * 1000));
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!match) return new Date(text);
  let [, month, day, year, hour = "0", minute = "0", second = "0", ampm = ""] = match;
  let h = Number(hour);
  if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  return new Date(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second));
}

function dateOnly(value) {
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item) || "(blank)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}

function countBy(items, fn) {
  return groupBy(items, fn)
    .map(([name, rows]) => ({ name, count: rows.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function pct(n, d) {
  return d ? n / d : 0;
}

function analyze(rows, filename) {
  if (!rows.length) throw new Error("No data rows found.");
  const required = ["SURVEY_CASE", ratingCol, "QUESTION_GROUP"];
  const headers = Object.keys(rows[0]);
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(", ")}`);

  const surveys = groupBy(rows, (r) => r.SURVEY_CASE).map(([surveyCase, group]) => {
    const first = group[0];
    const rating = group.map((r) => toNum(r[ratingCol])).find((v) => v != null) ?? null;
    const nps = group
      .filter((r) => r.QUESTION_GROUP === npsGroup)
      .flatMap((r) => [r.RESPONSE, r.RESPONSE_TEXT, r["Response Text/Comment"]])
      .map(toNum)
      .find((v) => v != null) ?? null;
    const statusDate = parseDate(first.SURVEY_CASE_STATUS_DATE);
    const createDate = parseDate(first.CASE_CREATE_DATE);
    const turnaroundDays =
      !Number.isNaN(statusDate.getTime()) && !Number.isNaN(createDate.getTime())
        ? (statusDate.getTime() - createDate.getTime()) / 86400000
        : null;
    return {
      surveyCase,
      caseId: first.CASE_ID || "",
      surveyDate: dateOnly(first["Day Date"] || first.SURVEY_CASE_STATUS_DATE),
      brand: first.BRAND || "",
      source: first["Survey Source"] || "",
      surveyType: first["Consolidated Survey"] || "",
      product: first.PRODUCT_NAME || "",
      caseType: first.CASE_TYPE || "",
      completeUser: first.CASE_COMPLETE_USER || "",
      resolvedUser: first.CASE_RESOLVED_USER || "",
      status: first.SURVEY_CASE_STATUS || "",
      rating,
      csat: rating != null && rating >= 4 ? 1 : 0,
      dsat: rating != null && rating <= 3 ? 1 : 0,
      nps,
      npsClass: nps == null ? "" : nps >= 9 ? "Promoter" : nps >= 7 ? "Passive" : "Detractor",
      turnaroundDays,
      rows: group,
    };
  });

  const rated = surveys.filter((s) => s.rating != null);
  const npsRated = surveys.filter((s) => s.nps != null);
  const total = rated.length;
  const csat = rated.filter((s) => s.csat).length;
  const dsat = rated.filter((s) => s.dsat).length;
  const promoters = npsRated.filter((s) => s.nps >= 9).length;
  const passives = npsRated.filter((s) => s.nps >= 7 && s.nps <= 8).length;
  const detractors = npsRated.filter((s) => s.nps <= 6).length;
  const daily = groupBy(rated, (s) => s.surveyDate)
    .map(([date, items]) => ({
      date,
      total: items.length,
      csat: items.filter((s) => s.csat).length,
      dsat: items.filter((s) => s.dsat).length,
      csatRate: pct(items.filter((s) => s.csat).length, items.length),
      dsatRate: pct(items.filter((s) => s.dsat).length, items.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const productSummary = groupBy(rated, (s) => s.product)
    .map(([product, items]) => ({
      product,
      total: items.length,
      csat: items.filter((s) => s.csat).length,
      dsat: items.filter((s) => s.dsat).length,
      csatRate: pct(items.filter((s) => s.csat).length, items.length),
      dsatRate: pct(items.filter((s) => s.dsat).length, items.length),
    }))
    .sort((a, b) => b.total - a.total);

  const userSummary = groupBy(rated, (s) => s.completeUser)
    .map(([user, items]) => ({
      user,
      total: items.length,
      csatRate: pct(items.filter((s) => s.csat).length, items.length),
      dsatRate: pct(items.filter((s) => s.dsat).length, items.length),
      avgRating: average(items.map((s) => s.rating)),
    }))
    .sort((a, b) => b.total - a.total);

  const dsatCases = rated
    .filter((s) => s.dsat)
    .map((s) => ({
      surveyCase: s.surveyCase,
      caseId: s.caseId,
      date: s.surveyDate,
      rating: s.rating,
      nps: s.nps,
      user: s.completeUser,
      product: s.product,
      reasons: s.rows
        .filter((r) => r.QUESTION_GROUP === "RatingBetween1To3" && r["Response Text/Comment"]?.trim())
        .map((r) => r["Response Text/Comment"].trim())
        .join("; "),
    }));

  return {
    filename,
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    surveyCount: surveys.length,
    dateRange: `${daily[0]?.date || ""} to ${daily.at(-1)?.date || ""}`,
    kpis: {
      ratedSurveys: total,
      csatCount: csat,
      dsatCount: dsat,
      csatRate: pct(csat, total),
      dsatRate: pct(dsat, total),
      averageRating: average(rated.map((s) => s.rating)),
      npsResponses: npsRated.length,
      npsScore: npsRated.length ? ((promoters - detractors) / npsRated.length) * 100 : 0,
      averageTurnaroundDays: average(surveys.map((s) => s.turnaroundDays)),
    },
    ratingDistribution: countBy(rated, (s) => String(s.rating)).sort((a, b) => Number(a.name) - Number(b.name)),
    npsDistribution: [
      { name: "Promoter", count: promoters },
      { name: "Passive", count: passives },
      { name: "Detractor", count: detractors },
    ],
    daily,
    productSummary,
    userSummary,
    positiveDrivers: countBy(rows.filter((r) => r.QUESTION_GROUP === "RatingBetween4To5" && r["Response Text/Comment"]?.trim()), (r) => r["Response Text/Comment"].trim()),
    negativeDrivers: countBy(rows.filter((r) => r.QUESTION_GROUP === "RatingBetween1To3" && r["Response Text/Comment"]?.trim()), (r) => r["Response Text/Comment"].trim()),
    dsatCases,
  };
}

async function handleAnalyze(req, res) {
  const filename = decodeURIComponent(req.headers["x-file-name"] || "upload");
  const body = await collectBody(req);
  const lower = filename.toLowerCase();
  const rows = lower.endsWith(".xlsx") || lower.endsWith(".xlsm")
    ? await parseXlsx(body)
    : parseCsv(body.toString("utf8"));
  send(res, 200, JSON.stringify(analyze(rows, filename)));
}

async function handleStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  const requested = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  try {
    const file = await fs.readFile(filePath);
    send(res, 200, file, mimeTypes[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/analyze") return await handleAnalyze(req, res);
    if (req.method === "GET") return await handleStatic(req, res);
    send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
  } catch (error) {
    send(res, 400, JSON.stringify({ error: error.message || "Unable to analyze file." }));
  }
});

server.listen(port, () => {
  console.log(`CSAT/DSAT Report App running at http://localhost:${port}`);
});
