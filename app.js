// MAXSPAN app.js — SPAN + Bhav + Positions + Spread grouping (client-side)

const el = (id) => document.getElementById(id);

const logEl = el("log");
function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}
function resetLog() {
  logEl.textContent = "";
}

// Inputs
const spanFileEl = el("spanFile");
const bhavFileEl = el("bhavFile");
const spanHint = el("spanHint");
const bhavHint = el("bhavHint");

// View selector
const viewModeEl = el("viewMode");
const loadBtn = el("loadBtn");
const exportContractsBtn = el("exportContractsBtn");

// Contracts controls
const contractsView = el("contractsView");
const portfolioView = el("portfolioView");
const searchEl = el("search");
const monthFilterEl = el("monthFilter");
const typeFilterEl = el("typeFilter");
const contractsTableBody = el("contractsTable").querySelector("tbody");

// Positions controls
const addRowBtn = el("addRowBtn");
const calcBtn = el("calcBtn");
const exportPosBtn = el("exportPosBtn");
const posTableBody = el("posTable").querySelector("tbody");
const portfolioWorstEl = el("portfolioWorst");
const scenarioLogEl = el("scenarioLog");
const contributorsLogEl = el("contributorsLog");

// Spread grouping UI
const groupToggleEl = el("groupToggle");
const spreadsLogEl = el("spreadsLog");

// ---------- File helpers ----------
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsText(file);
  });
}

function parseXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("XML parse error. Ensure SPAN file is XML text.");
  return doc;
}

// ---------- Date/month helpers ----------
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function monthKeyFromBhavExpiry(expiryStr) {
  const s = String(expiryStr || "").toUpperCase().replace(/\s+/g,"");
  const mmm = MONTHS.find(m => s.includes(m));
  const yyyy = (s.match(/20\d{2}/) || [null])[0];
  if (!mmm || !yyyy) return null;
  return `${mmm}-${yyyy}`;
}

function monthKeyFromSpanPe(peStr) {
  const s = String(peStr || "").trim();
  if (!/^\d{8}$/.test(s)) return null;
  const yyyy = s.slice(0,4);
  const mm = Number(s.slice(4,6));
  if (!(mm >= 1 && mm <= 12)) return null;
  return `${MONTHS[mm-1]}-${yyyy}`;
}

function num(v) {
  const x = Number(String(v ?? "").replace(/,/g,"").trim());
  return Number.isFinite(x) ? x : null;
}

function normalizeSym(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, "");
}

// ---------- Parse Bhav (HTML-table .xls) ----------
function parseBhavHtmlTable(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const table = doc.querySelector("table");
  if (!table) throw new Error("Bhav: no <table> found (expected HTML-table .xls).");

  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length < 2) throw new Error("Bhav: table too small.");

  const headerCells = Array.from(rows[0].querySelectorAll("th,td")).map(td => td.textContent.trim());
  const idx = (name) => headerCells.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const iSymbol = idx("Symbol");
  const iExpiry = idx("Expiry Date");
  const iOptType = idx("Option Type");
  const iStrike = idx("Strike Price");
  const iClose  = idx("Close");
  const iOI     = idx("Open Interest(Lots)");
  const iInstr  = idx("Instrument Name");

  if (iSymbol < 0 || iExpiry < 0) throw new Error("Bhav: missing Symbol/Expiry Date columns.");

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = Array.from(rows[r].querySelectorAll("td")).map(td => td.textContent.trim());
    if (!cells.length) continue;

    const symbolRaw = cells[iSymbol] || "";
    const symbol = normalizeSym(symbolRaw);
    const expiryRaw = cells[iExpiry] || "";
    const monthKey = monthKeyFromBhavExpiry(expiryRaw);

    const optType = (iOptType >= 0 ? (cells[iOptType] || "-") : "-");
    const strike = (iStrike >= 0 ? num(cells[iStrike]) : 0) ?? 0;

    const close = (iClose >= 0 ? num(cells[iClose]) : null);
    const oi = (iOI >= 0 ? num(cells[iOI]) : null);

    const instr = (iInstr >= 0 ? (cells[iInstr] || "") : "");

    if (!symbol || !monthKey) continue;

    const type = (optType && optType !== "-" ? "OPT" : "FUT");

    out.push({ symbol, monthKey, type, strike, close, oi, instr, expiryRaw, optType });
  }

  return out;
}

function bhavKey(r) {
  const st = r.type === "OPT" ? Number(r.strike || 0).toFixed(2) : "0.00";
  return `${r.symbol}|${r.monthKey}|${r.type}|${st}`;
}

// ---------- SPAN parsing helpers ----------
function textOf(node, tag) {
  const n = node.getElementsByTagName(tag)[0];
  return n ? (n.textContent ?? "").trim() : "";
}

function raArray(contractNode) {
  const ra = contractNode.getElementsByTagName("ra")[0];
  if (!ra) return null;

  const arr = [];
  for (const ch of Array.from(ra.children)) {
    const name = ch.tagName.toLowerCase();
    if (name === "r" || name === "d") continue;
    const v = num(ch.textContent);
    arr.push(v ?? 0);
  }
  return arr.length ? arr : null;
}

function worstAbs(arr) {
  let m = 0;
  for (const v of arr) {
    const a = Math.abs(v);
    if (a > m) m = a;
  }
  return m;
}

function buildPfIdToCode(spanDoc) {
  const map = new Map();

  const allPf = [
    ...Array.from(spanDoc.getElementsByTagName("phyPf")),
    ...Array.from(spanDoc.getElementsByTagName("futPf")),
    ...Array.from(spanDoc.getElementsByTagName("optPf")),
  ];

  for (const pf of allPf) {
    const pfId = textOf(pf, "pfId");
    const pfCode = textOf(pf, "pfCode");
    if (pfId && pfCode) map.set(String(pfId).trim(), normalizeSym(pfCode));
  }
  return map;
}

// Extract ALL futures/options from the whole SPAN file
function extractSpanContracts(spanDoc) {
  const pfIdToCode = buildPfIdToCode(spanDoc);
  const rows = [];

  // --- FUT ---
  const futNodes = Array.from(spanDoc.getElementsByTagName("fut"));
  for (const fut of futNodes) {
    const pe = textOf(fut, "pe");
    const monthKey = monthKeyFromSpanPe(pe) || "UNK";

    const ra = raArray(fut);
    if (!ra) continue;

    // underlying pfId in <undC>
    const undC = fut.getElementsByTagName("undC")[0];
    const undPfId = undC ? textOf(undC, "pfId") : "";
    const symbol = pfIdToCode.get(String(undPfId).trim()) || "";

    const scanRate = fut.getElementsByTagName("scanRate")[0];
    const priceScan = scanRate ? (num(textOf(scanRate, "priceScan")) ?? null) : null;

    if (!symbol) continue;

    rows.push({
      symbol,
      monthKey,
      type: "FUT",
      strike: 0,
      optCp: "",
      pe,
      priceScan,
      ra,
      worst: worstAbs(ra),
    });
  }

  // --- OPT ---
  const optNodes = Array.from(spanDoc.getElementsByTagName("opt"));
  for (const opt of optNodes) {
    const pe = textOf(opt, "pe");
    const monthKey = monthKeyFromSpanPe(pe) || "UNK";

    const ra = raArray(opt);
    if (!ra) continue;

    const strike = num(textOf(opt, "k")) ?? 0;
    const cp = (textOf(opt, "o") || "").toUpperCase(); // C/P

    const undC = opt.getElementsByTagName("undC")[0];
    const undPfId = undC ? textOf(undC, "pfId") : "";
    const symbol = pfIdToCode.get(String(undPfId).trim()) || "";

    const scanRate = opt.getElementsByTagName("scanRate")[0];
    const priceScan = scanRate ? (num(textOf(scanRate, "priceScan")) ?? null) : null;

    if (!symbol) continue;

    rows.push({
      symbol,
      monthKey,
      type: "OPT",
      strike,
      optCp: cp,
      pe,
      priceScan,
      ra,
      worst: worstAbs(ra),
    });
  }

  // Deduplicate (sometimes appears twice)
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const st = r.type === "OPT" ? Number(r.strike || 0).toFixed(2) : "0.00";
    const key = `${r.symbol}|${r.monthKey}|${r.type}|${st}|${r.optCp || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }

  return out;
}

function spanKey(r) {
  const st = r.type === "OPT" ? Number(r.strike || 0).toFixed(2) : "0.00";
  return `${r.symbol}|${r.monthKey}|${r.type}|${st}`;
}

// ---------- Global state ----------
let bhavIndex = new Map();  // key -> bhav row
let spanRows = [];          // span rows enriched with close/oi
let months = [];            // month filter
let symbols = [];           // symbol list for positions dropdown

// ---------- UI toggles ----------
function setView(view) {
  if (view === "contracts") {
    contractsView.classList.add("is-active");
    portfolioView.classList.remove("is-active");
  } else {
    portfolioView.classList.add("is-active");
    contractsView.classList.remove("is-active");
  }
}

viewModeEl.addEventListener("change", () => setView(viewModeEl.value));

spanFileEl.addEventListener("change", () => {
  spanHint.textContent = spanFileEl.files?.[0]?.name || "No file selected";
});
bhavFileEl.addEventListener("change", () => {
  bhavHint.textContent = bhavFileEl.files?.[0]?.name || "No file selected";
});

// Tabs (MCX only active)
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    el(btn.dataset.tab).classList.add("is-active");
  });
});

// ---------- Contracts rendering ----------
function clearTable(tbody) { tbody.innerHTML = ""; }

function buildMonthFilter(rows) {
  const set = new Set(rows.map(r => r.monthKey).filter(Boolean));
  months = Array.from(set).sort((a,b) => a.localeCompare(b));
  monthFilterEl.innerHTML =
    `<option value="">All</option>` + months.map(m => `<option value="${m}">${m}</option>`).join("");
}

function buildSymbolList(rows) {
  const set = new Set(rows.map(r => r.symbol).filter(Boolean));
  symbols = Array.from(set).sort((a,b) => a.localeCompare(b));
}

function renderContracts() {
  clearTable(contractsTableBody);

  const q = (searchEl.value || "").toLowerCase().trim();
  const mf = monthFilterEl.value;
  const tf = typeFilterEl.value;

  const filtered = spanRows.filter(r => {
    if (mf && r.monthKey !== mf) return false;
    if (tf && r.type !== tf) return false;
    if (!q) return true;
    const hay = [
      r.symbol, r.monthKey, r.type,
      r.type === "OPT" ? String(r.strike) : "",
      r.close != null ? String(r.close) : "",
      r.oi != null ? String(r.oi) : "",
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  for (const r of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${r.symbol}</td>
      <td>${r.monthKey}</td>
      <td>${r.type}</td>
      <td class="mono">${r.type === "OPT" ? r.strike.toFixed(2) : "-"}</td>
      <td class="mono">${r.close == null ? "—" : r.close.toFixed(2)}</td>
      <td class="mono">${r.oi == null ? "—" : String(r.oi)}</td>
      <td class="mono">${r.priceScan == null ? "—" : r.priceScan.toFixed(6)}</td>
      <td class="mono">${r.worst.toFixed(2)}</td>
    `;
    contractsTableBody.appendChild(tr);
  }

  exportContractsBtn.disabled = filtered.length === 0;
}

searchEl.addEventListener("input", renderContracts);
monthFilterEl.addEventListener("change", renderContracts);
typeFilterEl.addEventListener("change", renderContracts);

// ---------- CSV export ----------
function downloadText(filename, text, mime="text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows, headers) {
  const esc = (s) => {
    const t = String(s ?? "");
    if (t.includes(",") || t.includes('"') || t.includes("\n")) return `"${t.replace(/"/g,'""')}"`;
    return t;
  };
  const lines = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(","));
  return lines.join("\n");
}

exportContractsBtn.addEventListener("click", () => {
  const rows = spanRows.map(r => ({
    symbol: r.symbol,
    month: r.monthKey,
    type: r.type,
    strike: r.type === "OPT" ? r.strike.toFixed(2) : "",
    close: r.close ?? "",
    oi: r.oi ?? "",
    scan: r.priceScan ?? "",
    worst_abs_ra: r.worst.toFixed(2),
  }));
  const csv = toCsv(rows, ["symbol","month","type","strike","close","oi","scan","worst_abs_ra"]);
  downloadText("contracts_readable.csv", csv, "text/csv");
});

// ---------- Positions UI ----------
function makeSelect(options, value="") {
  const s = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

function tdWrap(node) {
  const td = document.createElement("td");
  td.appendChild(node);
  return td;
}

function addPosRow(prefill = {}) {
  const tr = document.createElement("tr");

  const monthOpts = [{value:"",label:"Select"}].concat(months.map(m => ({value:m,label:m})));
  const symOpts = [{value:"",label:"Select"}].concat(symbols.map(s => ({value:s,label:s})));

  const symSel = makeSelect(symOpts, prefill.symbol || "");
  const monthSel = makeSelect(monthOpts, prefill.monthKey || "");
  const typeSel = makeSelect([{value:"FUT",label:"FUT"},{value:"OPT",label:"OPT"}], prefill.type || "FUT");

  const strikeInput = document.createElement("input");
  strikeInput.type = "number";
  strikeInput.step = "0.01";
  strikeInput.value = prefill.strike ?? 0;
  strikeInput.placeholder = "0";

  const lotsInput = document.createElement("input");
  lotsInput.type = "number";
  lotsInput.step = "1";
  lotsInput.value = prefill.lots ?? 0;
  lotsInput.placeholder = "+ long / - short";

  const closeTd = document.createElement("td"); closeTd.className = "mono"; closeTd.textContent="—";
  const oiTd = document.createElement("td"); oiTd.className = "mono"; oiTd.textContent="—";
  const impactTd = document.createElement("td"); impactTd.className="mono"; impactTd.textContent="—";

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.textContent = "Remove";
  delBtn.addEventListener("click", () => {
    tr.remove();
    refreshSpreadGroups();
  });

  function recomputeRow() {
    const sym = symSel.value;
    const month = monthSel.value;
    const type = typeSel.value;
    const strike = num(strikeInput.value) ?? 0;
    const lots = num(lotsInput.value) ?? 0;

    // Match to span row
    const key = `${sym}|${month}|${type}|${type==="OPT" ? strike.toFixed(2) : "0.00"}`;
    const span = spanRows.find(r => spanKey(r) === key) || null;

    const close = span?.close ?? null;
    const oi = span?.oi ?? null;

    closeTd.textContent = close == null ? "—" : close.toFixed(2);
    oiTd.textContent = oi == null ? "—" : String(oi);

    if (span && span.ra && span.ra.length && lots !== 0) {
      impactTd.textContent = (span.worst * Math.abs(lots)).toFixed(2);
    } else {
      impactTd.textContent = "—";
    }

    calcBtn.disabled = posTableBody.querySelectorAll("tr").length === 0;
    exportPosBtn.disabled = posTableBody.querySelectorAll("tr").length === 0;

    refreshSpreadGroups();
  }

  [symSel, monthSel, typeSel].forEach(x => x.addEventListener("change", recomputeRow));
  [strikeInput, lotsInput].forEach(x => x.addEventListener("input", recomputeRow));

  tr.appendChild(tdWrap(symSel));
  tr.appendChild(tdWrap(monthSel));
  tr.appendChild(tdWrap(typeSel));
  tr.appendChild(tdWrap(strikeInput));
  tr.appendChild(tdWrap(lotsInput));
  tr.appendChild(closeTd);
  tr.appendChild(oiTd);
  tr.appendChild(impactTd);

  const tdDel = document.createElement("td");
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  posTableBody.appendChild(tr);
  recomputeRow();
}

addRowBtn.addEventListener("click", () => addPosRow());

exportPosBtn.addEventListener("click", () => {
  const rows = [];
  for (const tr of Array.from(posTableBody.querySelectorAll("tr"))) {
    const tds = tr.querySelectorAll("td");
    const symbol = tds[0].querySelector("select")?.value || "";
    const month = tds[1].querySelector("select")?.value || "";
    const type = tds[2].querySelector("select")?.value || "";
    const strike = tds[3].querySelector("input")?.value || "0";
    const lots = tds[4].querySelector("input")?.value || "0";
    rows.push({symbol, month, type, strike, lots});
  }
  const csv = toCsv(rows, ["symbol","month","type","strike","lots"]);
  downloadText("positions.csv", csv, "text/csv");
});

// ---------- Spread grouping ----------
function groupKeyForPos(p) {
  if (p.type === "FUT") return `${p.symbol}|FUT`;
  const st = Number(p.strike || 0).toFixed(2);
  return `${p.symbol}|OPT|${st}`; // (CP can be added later if needed)
}

function groupLabel(key) {
  const parts = key.split("|");
  if (parts[1] === "FUT") return `${parts[0]} FUT`;
  return `${parts[0]} OPT ${parts[2]}`;
}

function readPositionsFromTable() {
  const out = [];
  for (const tr of Array.from(posTableBody.querySelectorAll("tr"))) {
    const tds = tr.querySelectorAll("td");
    const symbol = tds[0].querySelector("select")?.value || "";
    const month = tds[1].querySelector("select")?.value || "";
    const type = tds[2].querySelector("select")?.value || "";
    const strike = num(tds[3].querySelector("input")?.value) ?? 0;
    const lots = num(tds[4].querySelector("input")?.value) ?? 0;
    if (!symbol || !month || !type || lots === 0) continue;
    out.push({symbol, month, type, strike, lots});
  }
  return out;
}

function refreshSpreadGroups() {
  if (!spreadsLogEl) return;
  spreadsLogEl.textContent = "";

  if (!groupToggleEl?.checked) return;

  const positions = readPositionsFromTable();
  if (positions.length === 0) return;

  const groups = new Map();

  for (const p of positions) {
    const gk = groupKeyForPos(p);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(p);
  }

  const lines = [];
  for (const [gk, legs] of groups.entries()) {
    const netLots = legs.reduce((s, x) => s + x.lots, 0);
    lines.push(`${groupLabel(gk)}  | legs=${legs.length} | netLots=${netLots}`);

    // Sort legs by month label
    legs.sort((a,b) => String(a.month).localeCompare(String(b.month)));

    for (const leg of legs) {
      const key = `${leg.symbol}|${leg.month}|${leg.type}|${leg.type==="OPT" ? leg.strike.toFixed(2) : "0.00"}`;
      const span = spanRows.find(r => spanKey(r) === key) || null;
      const worst = span ? span.worst : null;
      const close = span?.close ?? null;

      const wtxt = worst == null ? "—" : (worst * Math.abs(leg.lots)).toFixed(2);
      const ctxt = close == null ? "—" : close.toFixed(2);

      lines.push(`  - ${leg.month} | lots=${leg.lots} | close=${ctxt} | absImpact≈${wtxt}`);
    }

    lines.push("");
  }

  spreadsLogEl.textContent = lines.join("\n");
}

groupToggleEl?.addEventListener("change", refreshSpreadGroups);

// ---------- Portfolio calc ----------
calcBtn.addEventListener("click", () => {
  scenarioLogEl.textContent = "";
  contributorsLogEl.textContent = "";
  portfolioWorstEl.textContent = "—";

  const first = spanRows.find(r => r.ra && r.ra.length);
  if (!first) { log("❌ No ra arrays found in SPAN."); return; }
  const L = first.ra.length;

  const portfolio = new Array(L).fill(0);
  const contribs = [];

  const positions = readPositionsFromTable();

  for (const p of positions) {
    const key = `${p.symbol}|${p.month}|${p.type}|${p.type==="OPT" ? p.strike.toFixed(2) : "0.00"}`;
    const span = spanRows.find(r => spanKey(r) === key) || null;

    if (!span) {
      log(`⚠️ Position not found in SPAN: ${key}`);
      continue;
    }

    const local = new Array(L).fill(0);
    for (let i = 0; i < L; i++) {
      const v = (span.ra[i] ?? 0) * p.lots;
      portfolio[i] += v;
      local[i] = v;
    }

    contribs.push({ key, worstAbs: worstAbs(local), lots: p.lots });
  }

  let worst = 0;
  let worstIdx = 0;
  for (let i = 0; i < L; i++) {
    const a = Math.abs(portfolio[i]);
    if (a > worst) { worst = a; worstIdx = i; }
  }

  portfolioWorstEl.textContent = `${worst.toFixed(2)} (scenario #${worstIdx+1})`;
  scenarioLogEl.textContent = portfolio.slice(0, 20).map((v,i) => `S${i+1}: ${v.toFixed(2)}`).join("\n");

  contribs.sort((a,b) => b.worstAbs - a.worstAbs);
  contributorsLogEl.textContent = contribs.slice(0, 15).map(c =>
    `${c.key} | lots=${c.lots} | abs-impact=${c.worstAbs.toFixed(2)}`
  ).join("\n");

  refreshSpreadGroups();
});

// ---------- Load files ----------
loadBtn.addEventListener("click", async () => {
  resetLog();
  bhavIndex.clear();
  spanRows = [];
  clearTable(contractsTableBody);
  posTableBody.innerHTML = "";
  portfolioWorstEl.textContent = "—";
  scenarioLogEl.textContent = "";
  contributorsLogEl.textContent = "";
  spreadsLogEl.textContent = "";

  exportContractsBtn.disabled = true;
  calcBtn.disabled = true;
  exportPosBtn.disabled = true;

  const spanFile = spanFileEl.files?.[0];
  const bhavFile = bhavFileEl.files?.[0];

  if (!spanFile) { log("❌ Upload SPAN file."); return; }
  if (!bhavFile) { log("❌ Upload Bhav file."); return; }

  try {
    log(`Reading SPAN: ${spanFile.name}`);
    const spanText = await readFileAsText(spanFile);
    const spanDoc = parseXml(spanText);

    const baseRows = extractSpanContracts(spanDoc);
    log(`SPAN contracts with ra: ${baseRows.length}`);

    log(`Reading Bhav: ${bhavFile.name}`);
    const bhavText = await readFileAsText(bhavFile);
    const bhavRows = parseBhavHtmlTable(bhavText);
    log(`Bhav rows parsed: ${bhavRows.length}`);

    for (const r of bhavRows) bhavIndex.set(bhavKey(r), r);

    spanRows = baseRows.map(r => {
      const b = bhavIndex.get(spanKey(r)) || null;
      return { ...r, close: b?.close ?? null, oi: b?.oi ?? null };
    });

    buildMonthFilter(spanRows);
    buildSymbolList(spanRows);

    renderContracts();
    exportContractsBtn.disabled = spanRows.length === 0;

    log("✅ Loaded. Switch view to Positions to build portfolio like Kite.");
    setView(viewModeEl.value);

  } catch (e) {
    log(`❌ Error: ${e?.message || String(e)}`);
  }
});
