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
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(filename) },
      body: await blob.arrayBuffer(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Analysis failed.");
    currentReport = result;
    renderReport(result);
    setStatus(`Report generated from ${result.rowCount.toLocaleString()} rows and ${result.surveyCount.toLocaleString()} unique surveys.`);
  } catch (error) {
    setStatus(error.message, true);
  }
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
