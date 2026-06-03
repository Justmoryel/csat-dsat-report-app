const fileInput = document.querySelector("#fileInput");
const pickFile = document.querySelector("#pickFile");
const dropZone = document.querySelector("#dropZone");
const statusBox = document.querySelector("#status");
const report = document.querySelector("#report");
let currentReport = null;

const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
const fmtNum = (v, d = 0) => Number(v || 0).toFixed(d);

pickFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && analyzeFile(fileInput.files[0]));
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) analyzeFile(file);
});

async function analyzeFile(file) {
  await analyzeBlob(file, file.name);
}

async function analyzeBlob(blob, filename) {
  setStatus(`Analyzing ${filename}...`);
  report.hidden = true;
  try {
    const rows = await parseUpload(blob, filename);
    const result = analyzeRows(rows, filename);
    currentReport = result;
    renderReport(result);
    setStatus(`Report generated from ${result.rowCount.toLocaleString()} rows and ${result.surveyCount.toLocaleString()} unique surveys.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function parseUpload(file, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    if (!window.XLSX) throw new Error("Excel parser did not load. Check your internet connection and refresh the page.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    return matrixToObjects(matrix);
  }
  return parseCsv(await file.text());
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

function analyzeRows(rows, filename) {
  const ratingCol = "How would you rate the quality of the work we completed?";
  const npsGroup = "NPSExistingBrandNPSSection";
  if (!rows.length) throw new Error("No data rows found.");
  const headers = Object.keys(rows[0]);
  const missing = ["SURVEY_CASE", "QUESTION_GROUP", ratingCol].filter((h) => !headers.includes(h));
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
      product: first.PRODUCT_NAME || "",
      completeUser: first.CASE_COMPLETE_USER || "",
      rating,
      csat: rating != null && rating >= 4 ? 1 : 0,
      dsat: rating != null && rating <= 3 ? 1 : 0,
      nps,
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
    daily,
    productSummary,
    userSummary,
    positiveDrivers: countBy(rows.filter((r) => r.QUESTION_GROUP === "RatingBetween4To5" && r["Response Text/Comment"]?.trim()), (r) => r["Response Text/Comment"].trim()),
    negativeDrivers: countBy(rows.filter((r) => r.QUESTION_GROUP === "RatingBetween1To3" && r["Response Text/Comment"]?.trim()), (r) => r["Response Text/Comment"].trim()),
    dsatCases,
  };
}

function setStatus(message, isError = false) {
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.style.borderColor = isError ? "#d75050" : "";
  statusBox.style.color = isError ? "#9a1d1d" : "";
}

function renderReport(data) {
  report.hidden = false;
  document.querySelector("#reportTitle").textContent = "Generated Report";
  document.querySelector("#reportMeta").textContent = `${data.filename} | ${data.dateRange} | generated ${new Date(data.generatedAt).toLocaleString()}`;
  document.querySelector("#kpiTotal").textContent = data.kpis.ratedSurveys.toLocaleString();
  document.querySelector("#kpiCsat").textContent = fmtPct(data.kpis.csatRate);
  document.querySelector("#kpiDsat").textContent = fmtPct(data.kpis.dsatRate);
  document.querySelector("#kpiNps").textContent = fmtNum(data.kpis.npsScore, 1);
  document.querySelector("#kpiRating").textContent = fmtNum(data.kpis.averageRating, 2);
  document.querySelector("#kpiTurnaround").textContent = `${fmtNum(data.kpis.averageTurnaroundDays, 2)} days`;

  drawPie(document.querySelector("#pieChart"), [
    { label: "CSAT", value: data.kpis.csatCount, color: "#1f6f8b" },
    { label: "DSAT", value: data.kpis.dsatCount, color: "#e8793e" },
  ]);
  drawBar(document.querySelector("#ratingChart"), data.ratingDistribution.map((r) => ({ label: r.name, value: r.count })), "#1f6f8b");
  drawLine(document.querySelector("#trendChart"), data.daily.map((d) => ({ label: d.date.slice(5), value: d.csatRate })));
  drawBar(document.querySelector("#driverChart"), data.positiveDrivers.slice(0, 8).map((d) => ({ label: d.name, value: d.count })), "#2c6e49");

  renderTable("#productTable", ["Product", "Total", "CSAT %", "DSAT %"], data.productSummary, [
    "product",
    "total",
    (r) => fmtPct(r.csatRate),
    (r) => fmtPct(r.dsatRate),
  ]);
  renderTable("#userTable", ["User", "Total", "Avg Rating", "CSAT %", "DSAT %"], data.userSummary.slice(0, 12), [
    "user",
    "total",
    (r) => fmtNum(r.avgRating, 2),
    (r) => fmtPct(r.csatRate),
    (r) => fmtPct(r.dsatRate),
  ]);
  renderTable("#dsatTable", ["Survey Case", "Case ID", "Date", "Rating", "NPS", "User", "Product", "Reasons"], data.dsatCases, [
    "surveyCase",
    "caseId",
    "date",
    "rating",
    (r) => r.nps ?? "",
    "user",
    "product",
    "reasons",
  ]);
  renderTable("#negativeTable", ["Negative Driver", "Count"], data.negativeDrivers, ["name", "count"]);
}

function renderTable(selector, headers, rows, fields) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const td = document.createElement("td");
      td.textContent = typeof field === "function" ? field(row) : row[field];
      if (/^[-\d.,% ]+$/.test(td.textContent)) td.className = "num";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = headers.length;
    td.textContent = "No records found.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  document.querySelector(selector).replaceChildren(table);
}

function canvasSetup(canvas) {
  const ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(220, Math.floor(260 * scale));
  ctx.scale(scale, scale);
  return { ctx, width: rect.width, height: 260 };
}

function drawPie(canvas, data) {
  const { ctx, width, height } = canvasSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let angle = -Math.PI / 2;
  const r = Math.min(width, height) * 0.32;
  const cx = width * 0.42;
  const cy = height * 0.48;
  data.forEach((d) => {
    const next = angle + (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, next);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    angle = next;
  });
  data.forEach((d, i) => {
    ctx.fillStyle = d.color;
    ctx.fillRect(width * 0.72, 76 + i * 28, 12, 12);
    ctx.fillStyle = "#17212b";
    ctx.fillText(`${d.label}: ${d.value}`, width * 0.72 + 18, 87 + i * 28);
  });
}

function drawBar(canvas, data, color) {
  const { ctx, width, height } = canvasSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 46, right: 18, top: 18, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  ctx.strokeStyle = "#d7dee6";
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();
  const barW = plotW / Math.max(data.length, 1) * 0.65;
  data.forEach((d, i) => {
    const x = pad.left + (plotW / data.length) * i + (plotW / data.length - barW) / 2;
    const h = (d.value / max) * plotH;
    ctx.fillStyle = color;
    ctx.fillRect(x, pad.top + plotH - h, barW, h);
    ctx.fillStyle = "#5b6773";
    ctx.save();
    ctx.translate(x + barW / 2, height - 10);
    ctx.rotate(-Math.PI / 5);
    ctx.textAlign = "right";
    ctx.fillText(String(d.label).slice(0, 30), 0, 0);
    ctx.restore();
  });
}

function drawLine(canvas, data) {
  const { ctx, width, height } = canvasSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 48, right: 20, top: 18, bottom: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.strokeStyle = "#d7dee6";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#5b6773";
    ctx.fillText(`${100 - i * 25}%`, 8, y + 4);
  }
  ctx.strokeStyle = "#1f6f8b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = pad.left + (plotW / Math.max(data.length - 1, 1)) * i;
    const y = pad.top + plotH - d.value * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function toCsv(rows) {
  return rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function download(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelector("#downloadSummary").addEventListener("click", () => {
  if (!currentReport) return;
  download("csat_dsat_summary.csv", [
    ["Metric", "Value"],
    ["Rated Surveys", currentReport.kpis.ratedSurveys],
    ["CSAT %", fmtPct(currentReport.kpis.csatRate)],
    ["DSAT %", fmtPct(currentReport.kpis.dsatRate)],
    ["NPS", fmtNum(currentReport.kpis.npsScore, 1)],
    ["Average Rating", fmtNum(currentReport.kpis.averageRating, 2)],
    ["Average Turnaround Days", fmtNum(currentReport.kpis.averageTurnaroundDays, 2)],
  ]);
});

document.querySelector("#downloadDsat").addEventListener("click", () => {
  if (!currentReport) return;
  download("dsat_cases.csv", [
    ["Survey Case", "Case ID", "Date", "Rating", "NPS", "User", "Product", "Reasons"],
    ...currentReport.dsatCases.map((r) => [r.surveyCase, r.caseId, r.date, r.rating, r.nps ?? "", r.user, r.product, r.reasons]),
  ]);
});
