// SPAN compare tool for browser (MCX)
//
// Mirrors the shared Python logic:
// - contract key = cId + pe + k + o
// - compare <ra> child values scenario-by-scenario
// - mode: bod | current | max
//
// Note: This is a "best effort" XML parse of SPAN files treated as XML text.

const el = (id) => document.getElementById(id);

const bodFileEl = el("bodFile");
const curFileEl = el("curFile");
const bodHint = el("bodHint");
const curHint = el("curHint");
const modeEl = el("mode");
const runBtn = el("runBtn");
const downloadBtn = el("downloadBtn");

const statBod = el("statBod");
const statCur = el("statCur");
const statMaxed = el("statMaxed");
const statNew = el("statNew");
const statMode = el("statMode");
const statOut = el("statOut");
const logEl = el("log");

let lastOutputXml = null;
let lastOutputName = null;

// Tabs (NSE/BSE placeholders)
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    el(btn.dataset.tab).classList.add("is-active");
  });
});

bodFileEl.addEventListener("change", () => {
  bodHint.textContent = bodFileEl.files?.[0]?.name || "No file selected";
});
curFileEl.addEventListener("change", () => {
  curHint.textContent = curFileEl.files?.[0]?.name || "No file selected";
});

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function resetUI() {
  logEl.textContent = "";
  statBod.textContent = "—";
  statCur.textContent = "—";
  statMaxed.textContent = "—";
  statNew.textContent = "—";
  statMode.textContent = "—";
  statOut.textContent = "—";
  downloadBtn.disabled = true;
  lastOutputXml = null;
  lastOutputName = null;
}

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
  // Detect parse errors
  const err = doc.querySelector("parsererror");
  if (err) {
    throw new Error("XML parse error. Ensure the .spn file is XML text.");
  }
  return doc;
}

function getText(node, tagName, fallback = "0") {
  const n = node.getElementsByTagName(tagName)[0];
  return (n && n.textContent != null) ? n.textContent : fallback;
}

function getContractKey(contractElem) {
  const cid = getText(contractElem, "cId", "0");
  const pe  = getText(contractElem, "pe", "0");
  const k   = getText(contractElem, "k", "0");
  const o   = getText(contractElem, "o", "X");
  return `${cid}_${pe}_${k}_${o}`;
}

function extractRaValues(contractElem) {
  const ra = contractElem.getElementsByTagName("ra")[0];
  if (!ra) return null;
  const values = [];
  // Children are typically <r> nodes, but we treat any element children similarly.
  Array.from(ra.children).forEach(child => {
    const t = (child.textContent || "").trim();
    const v = t === "" ? 0.0 : Number(t);
    values.push(Number.isFinite(v) ? v : 0.0);
  });
  return { raNode: ra, values };
}

// Format like Python: fixed(10) then strip trailing zeros/dot.
function formatLikeExchange(val) {
  if (!Number.isFinite(val)) return "0";
  let s = val.toFixed(10);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

function updateRaValues(raNode, newValues) {
  const children = Array.from(raNode.children);
  const n = Math.min(children.length, newValues.length);
  for (let i = 0; i < n; i++) {
    children[i].textContent = formatLikeExchange(newValues[i]);
  }
}

function pad2(n) { return String(n).padStart(2, "0"); }
function outputName(prefix = "max_risk") {
  const d = new Date();
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const da = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${prefix}_${y}${mo}${da}_${hh}${mm}.spn`;
}

function collectContracts(doc) {
  const map = new Map();
  let count = 0;
  // SPAN uses <fut> and <opt> nodes (per your script)
  const nodes = [
    ...Array.from(doc.getElementsByTagName("fut")),
    ...Array.from(doc.getElementsByTagName("opt")),
  ];

  for (const contract of nodes) {
    const extracted = extractRaValues(contract);
    if (!extracted) continue;
    const key = getContractKey(contract);
    map.set(key, extracted.values);
    count++;
  }
  return { map, count };
}

function process(mode, bodDoc, curDoc) {
  const bod = collectContracts(bodDoc);
  const curNodes = [
    ...Array.from(curDoc.getElementsByTagName("fut")),
    ...Array.from(curDoc.getElementsByTagName("opt")),
  ];

  let processedCur = 0;
  let maximized = 0;
  let newContracts = 0;

  if (mode === "bod") {
    // output is BOD doc as-is
    return {
      outDoc: bodDoc,
      bodCount: bod.count,
      curCount: 0,
      maximized: 0,
      newContracts: 0
    };
  }

  // For 'current' and 'max', base output on current file doc
  for (const contract of curNodes) {
    const extracted = extractRaValues(contract);
    if (!extracted) continue;

    processedCur++;
    const key = getContractKey(contract);

    if (mode === "current") {
      // keep current values as-is
      continue;
    }

    // mode === "max"
    const curValues = extracted.values;
    if (bod.map.has(key)) {
      const bodValues = bod.map.get(key);
      const maxValues = [];
      const n = Math.min(bodValues.length, curValues.length);
      for (let i = 0; i < n; i++) maxValues.push(Math.max(bodValues[i], curValues[i]));
      // preserve extra intraday scenarios if any
      if (curValues.length > n) {
        for (let i = n; i < curValues.length; i++) maxValues.push(curValues[i]);
      }
      updateRaValues(extracted.raNode, maxValues);
      maximized++;
    } else {
      newContracts++;
    }
  }

  return {
    outDoc: curDoc,
    bodCount: bod.count,
    curCount: processedCur,
    maximized,
    newContracts
  };
}

runBtn.addEventListener("click", async () => {
  resetUI();

  const bodFile = bodFileEl.files?.[0];
  const curFile = curFileEl.files?.[0];
  const mode = modeEl.value;

  if (!bodFile && mode !== "current") {
    log("❌ Please upload BOD file (required for MAX or BOD mode).");
    return;
  }
  if (!curFile && (mode === "max" || mode === "current")) {
    log("❌ Please upload Current file (required for MAX or Current mode).");
    return;
  }

  try {
    log(`Mode selected: ${mode.toUpperCase()}`);
    statMode.textContent = mode.toUpperCase();

    let bodDoc = null;
    let curDoc = null;

    if (bodFile) {
      log(`[1/3] Reading BOD file: ${bodFile.name}`);
      const bodText = await readFileAsText(bodFile);
      bodDoc = parseXml(bodText);
    }

    if (curFile) {
      log(`[2/3] Reading Current file: ${curFile.name}`);
      const curText = await readFileAsText(curFile);
      curDoc = parseXml(curText);
    }

    log("[3/3] Processing…");
    const result = process(mode, bodDoc || curDoc, curDoc || bodDoc);

    statBod.textContent = String(result.bodCount ?? 0);
    statCur.textContent = String(result.curCount ?? 0);
    statMaxed.textContent = String(result.maximized ?? 0);
    statNew.textContent = String(result.newContracts ?? 0);

    const namePrefix = (mode === "bod") ? "bod_span" : (mode === "current" ? "current_span" : "max_risk");
    lastOutputName = outputName(namePrefix);
    statOut.textContent = lastOutputName;

    // Serialize XML
    const serializer = new XMLSerializer();
    lastOutputXml = serializer.serializeToString(result.outDoc);

    log("✅ Done.");
    log(`BOD indexed: ${result.bodCount}`);
    log(`Current processed: ${result.curCount}`);
    log(`Maximized (matched): ${result.maximized}`);
    log(`New contracts kept: ${result.newContracts}`);
    log(`Output ready: ${lastOutputName}`);

    downloadBtn.disabled = false;

  } catch (e) {
    log(`❌ Error: ${e?.message || String(e)}`);
  }
});

downloadBtn.addEventListener("click", () => {
  if (!lastOutputXml || !lastOutputName) return;

  const blob = new Blob([lastOutputXml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = lastOutputName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
});
