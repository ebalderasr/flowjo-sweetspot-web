const DEFAULT_CHANNELS = {
  "GFP (proteina recombinante)": "GFP-A",
  TMRM: "PE-A",
  Bodipy: "SNARF-A",
  "CellRox Deep Red": "APC-A",
};

const DEFAULT_SELECTION_RULES = {
  "Bodipy": { mode: "min_ws_after_si", min_acceptable_si: 30, min_si_fraction_of_max: 0.15, ws_equivalence_fraction: 0.05 },
  "CellRox Deep Red": { mode: "min_ws_after_si", min_acceptable_si: 40, min_si_fraction_of_max: 0.15, ws_equivalence_fraction: 0.05 },
  "TMRM": { mode: "min_ws_after_si", min_acceptable_si: 7, min_si_fraction_of_max: 0.15, ws_equivalence_fraction: 0.05 },
  "GFP (proteina recombinante)": { mode: "max_si", min_acceptable_si: 0, min_si_fraction_of_max: 0, ws_equivalence_fraction: 0.05 },
};

const SUMMARY_TOKENS = ["mean", "sd", "std", "stdev", "average", "avg", "cv", "median", "geomean", "summary", "resumen"];
const BASE_COLUMN_ALIASES = {
  Sample: ["Sample", "Sample:"],
  Colorante: ["Colorante", "Dye", "Stain", "Marker"],
  Concentracion: ["Concentracion", "Concentración", "Concentration", "Dose"],
};

const DYE_COLORS = ["#9c2f12", "#244c5a", "#2f7d4d", "#8a3b89", "#c17e19", "#5a4a9e", "#7c5b2a"];
const CLONE_SYMBOLS = ["circle", "square", "diamond", "triangle-up", "x", "cross", "hexagon"];

const state = {
  latestResult: null,
};

document.addEventListener("DOMContentLoaded", () => {
  renderConfigTable();
  initInfoButtons();
  document.getElementById("analyze-button").addEventListener("click", runAnalysis);
  document.getElementById("download-best-button").addEventListener("click", () => downloadCsv("best_conditions.csv", state.latestResult?.best || []));
  document.getElementById("download-results-button").addEventListener("click", () => downloadCsv("results.csv", state.latestResult?.results || []));
});

function initInfoButtons() {
  document.querySelectorAll(".info-button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.helpTarget);
      if (!target) return;
      target.classList.toggle("hidden");
    });
  });
}

function renderConfigTable() {
  const tbody = document.querySelector("#config-table tbody");
  tbody.innerHTML = "";
  Object.entries(DEFAULT_CHANNELS).forEach(([dye, channel]) => {
    const rule = DEFAULT_SELECTION_RULES[dye];
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(dye)}</td>
      <td><input data-dye="${escapeHtmlAttr(dye)}" data-key="channel" value="${escapeHtmlAttr(channel)}" /></td>
      <td>
        <select data-dye="${escapeHtmlAttr(dye)}" data-key="mode">
          <option value="min_ws_after_si" ${rule.mode === "min_ws_after_si" ? "selected" : ""}>min_ws_after_si</option>
          <option value="max_si" ${rule.mode === "max_si" ? "selected" : ""}>max_si</option>
        </select>
      </td>
      <td><input data-dye="${escapeHtmlAttr(dye)}" data-key="min_acceptable_si" type="number" step="0.1" value="${rule.min_acceptable_si}" /></td>
      <td><input data-dye="${escapeHtmlAttr(dye)}" data-key="min_si_fraction_of_max" type="number" step="0.01" value="${rule.min_si_fraction_of_max}" /></td>
      <td><input data-dye="${escapeHtmlAttr(dye)}" data-key="ws_equivalence_fraction" type="number" step="0.01" value="${rule.ws_equivalence_fraction}" /></td>
    `;
    tbody.appendChild(row);
  });
}

async function runAnalysis() {
  clearError();
  setStatus("Reading file...");
  try {
    const file = document.getElementById("file-input").files[0];
    if (!file) {
      throw new Error("Select a FlowJo CSV or XLSX file first.");
    }

    const rows = await fileToRows(file);
    const options = collectOptions();
    const result = analyzeFlowjoSweetspot(rows, options);
    state.latestResult = result;
    renderResults(result, file.name);
    setStatus(`Analysis complete. Processed ${result.results.length} useful sample rows.`);
  } catch (error) {
    console.error(error);
    showError(error.message || String(error));
    setStatus("Analysis failed.");
  }
}

function collectOptions() {
  const analysisMode = document.getElementById("analysis-mode").value;
  const channelsMap = {};
  const selectionRules = {};
  document.querySelectorAll("#config-table tbody tr").forEach((row) => {
    const inputs = [...row.querySelectorAll("input, select")];
    const dye = inputs[0].dataset.dye;
    const buffer = {};
    inputs.forEach((input) => {
      buffer[input.dataset.key] = input.value;
    });
    channelsMap[dye] = buffer.channel;
    selectionRules[dye] = {
      mode: buffer.mode,
      min_acceptable_si: toFiniteNumber(buffer.min_acceptable_si, 0),
      min_si_fraction_of_max: toFiniteNumber(buffer.min_si_fraction_of_max, 0),
      ws_equivalence_fraction: toFiniteNumber(buffer.ws_equivalence_fraction, 0),
    };
  });

  return {
    popBase: document.getElementById("pop-base").value.trim() || "CHO/Singlets",
    detectorMax: toFiniteNumber(document.getElementById("detector-max").value, 1_000_000),
    clippingK: toFiniteNumber(document.getElementById("clipping-k").value, 2),
    safeFraction: toFiniteNumber(document.getElementById("safe-fraction").value, 0.9),
    emptyGateThresholdPercent: toFiniteNumber(document.getElementById("empty-gate-threshold").value, 0.05),
    minAcceptableSi: toFiniteNumber(document.getElementById("min-acceptable-si").value, 7),
    minSiFractionOfMax: toFiniteNumber(document.getElementById("min-si-fraction-of-max").value, 0.15),
    wsEquivalenceFraction: toFiniteNumber(document.getElementById("ws-equivalence-fraction").value, 0.05),
    analysisMode,
    channelsMap,
    selectionRules,
  };
}

async function fileToRows(file) {
  const buffer = await file.arrayBuffer();
  const lower = file.name.toLowerCase();
  let workbook;
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buffer);
    workbook = XLSX.read(text, { type: "string" });
  } else {
    workbook = XLSX.read(buffer, { type: "array" });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
}

function analyzeFlowjoSweetspot(rows, options) {
  const prepared = prepareTable(rows);
  const standardized = standardizeBaseColumns(prepared);
  const usefulRows = standardized.rows.filter((row) => !isEmptyObject(row)).filter((row) => !isSummaryRow(row));
  usefulRows.forEach((row) => {
    row.Colorante = canonicalizeDyeName(row.Colorante);
    if ("Sample" in row) {
      row.Sample = cleanText(row.Sample);
    }
  });

  validateRequiredColumns(standardized.headers, options.popBase, options.channelsMap);

  const numericColumns = standardized.headers.filter((header) => !["Sample", "Colorante", "Concentracion"].includes(header));
  usefulRows.forEach((row) => {
    numericColumns.forEach((header) => {
      row[header] = parseMaybeNumber(row[header]);
    });
  });

  const stRows = usefulRows.filter((row) => row.Colorante === "ST");
  if (!stRows.length) {
    throw new Error("No row with Colorante == ST was found.");
  }

  const stSummary = {};
  numericColumns.forEach((column) => {
    const values = stRows.map((row) => row[column]).filter(Number.isFinite);
    stSummary[column] = values.length ? median(values) : NaN;
  });

  const freqColumns = standardized.headers.filter((header) => header.endsWith("| Freq. of Parent"));
  const freqDivisor = inferFreqDivisor(usefulRows, freqColumns);
  const emptyGateThresholdFraction = options.emptyGateThresholdPercent / 100;
  const results = [];
  const wsBreakdown = [];

  usefulRows.forEach((row) => {
    const dye = row.Colorante;
    if (!dye || dye === "ST" || !(dye in options.channelsMap)) {
      return;
    }

    const channel = options.channelsMap[dye];
    const cloneLabel = inferCloneLabel(row.Sample);
    const targetCols = buildColnames(options.popBase, channel);
    const mfiPos = row[targetCols.med_pos];
    const rsdPos = row[targetCols.rsd_pos];
    const mfiSt = stSummary[targetCols.med_neg];
    const rsdSt = stSummary[targetCols.rsd_neg];

    const stainIndex = Number.isFinite(mfiPos) && Number.isFinite(mfiSt) && Number.isFinite(rsdSt) && rsdSt > 0
      ? (mfiPos - mfiSt) / (2 * rsdSt)
      : NaN;
    const siSpread = Number.isFinite(rsdPos) && Number.isFinite(rsdSt) && rsdSt > 0
      ? rsdPos / (2 * rsdSt)
      : NaN;

    let upperEnvelope = NaN;
    let clipRisk = false;
    let nearClip = false;
    let headroom = NaN;
    if (Number.isFinite(mfiPos) && Number.isFinite(rsdPos)) {
      upperEnvelope = mfiPos + options.clippingK * rsdPos;
      clipRisk = upperEnvelope >= options.detectorMax;
      nearClip = upperEnvelope >= options.safeFraction * options.detectorMax;
      headroom = options.detectorMax - upperEnvelope;
    }

    let wsTotal = 0;
    let wsMissingNontrivial = 0;
    Object.entries(options.channelsMap).forEach(([otherDye, otherChannel]) => {
      if (otherChannel === channel) {
        return;
      }
      const neighborCols = buildColnames(options.popBase, otherChannel);
      const contribResult = calcIntrusionContribution({
        freqRaw: row[neighborCols.freq_pos],
        medIntruder: row[neighborCols.med_pos],
        rsdIntruder: row[neighborCols.rsd_pos],
        medStNeighbor: stSummary[neighborCols.med_neg],
        rsdStNeighbor: stSummary[neighborCols.rsd_neg],
        freqDivisor,
        emptyGateThresholdFraction,
      });
      if (Number.isFinite(contribResult.contribution)) {
        wsTotal += contribResult.contribution;
      } else {
        wsMissingNontrivial += 1;
      }
      wsBreakdown.push({
        Sample: row.Sample ?? "",
        Dye: dye,
        Clone: cloneLabel,
        Concentracion: row.Concentracion ?? "",
        Target_Channel: channel,
        Neighbor_Channel: otherChannel,
        Freq_raw: row[neighborCols.freq_pos],
        Freq_fraction: Number.isFinite(row[neighborCols.freq_pos]) ? row[neighborCols.freq_pos] / freqDivisor : NaN,
        Median_intruder: row[neighborCols.med_pos],
        RobustSD_intruder: row[neighborCols.rsd_pos],
        Median_ST_neighbor: stSummary[neighborCols.med_neg],
        RobustSD_ST_neighbor: stSummary[neighborCols.rsd_neg],
        Contribution_Ws: contribResult.contribution,
        Status: contribResult.status,
      });
    });

    const qualityScore = Number.isFinite(stainIndex) ? stainIndex / Math.log10(wsTotal + 10) : NaN;
    results.push({
      Sample: row.Sample ?? "",
      Dye: dye,
      Clone: cloneLabel,
      Concentracion: row.Concentracion ?? "",
      Target_Channel: channel,
      Stain_Index: stainIndex,
      SI_Spread: siSpread,
      Weighted_Severity: wsTotal,
      Quality_Score: qualityScore,
      Median_Target: mfiPos,
      RobustSD_Target: rsdPos,
      UpperEnvelope_Target: upperEnvelope,
      Headroom_to_Max: headroom,
      Near_Clip: nearClip,
      Clip_Risk: clipRisk,
      Missing_Nontrivial_Ws_Channels: wsMissingNontrivial,
    });
  });

  if (!results.length) {
    throw new Error("No analysis rows were generated. Check dye names or FlowJo columns.");
  }

  const concOrder = chooseConcentrationOrder(results.map((row) => row.Concentracion));
  const best = selectBestConditions(results, options, concOrder);
  return {
    results: sortRows(results, ["Dye", "Concentracion", "Sample"], concOrder),
    wsBreakdown: sortRows(wsBreakdown, ["Dye", "Concentracion", "Neighbor_Channel", "Sample"], concOrder),
    best,
    concOrder,
    freqDivisor,
  };
}

function prepareTable(rows) {
  if (!rows.length) {
    throw new Error("The uploaded file is empty.");
  }
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const clone = row.slice();
    while (clone.length < width) clone.push("");
    return clone.map((cell) => cleanText(cell) ?? "");
  });

  const header = normalized[0].map((value) => normalizeHeaderText(value || ""));
  const keepIndexes = header.map((_, index) => normalized.some((row) => cleanText(row[index]) !== null));
  const keptHeader = header.filter((_, index) => keepIndexes[index]);
  const body = normalized.slice(1).map((row) => row.filter((_, index) => keepIndexes[index]));
  const dataRows = body
    .map((row) => Object.fromEntries(keptHeader.map((headerName, index) => [headerName, cleanText(row[index])])))
    .filter((row) => Object.values(row).some((value) => value !== null));

  return { headers: keptHeader, rows: dataRows };
}

function standardizeBaseColumns(table) {
  const normalizedLookup = {};
  table.headers.forEach((header) => {
    normalizedLookup[normalizeHeaderText(header).toLowerCase()] = header;
  });
  const renameMap = {};
  Object.entries(BASE_COLUMN_ALIASES).forEach(([canonical, aliases]) => {
    aliases.forEach((alias) => {
      const found = normalizedLookup[normalizeHeaderText(alias).toLowerCase()];
      if (found && !(canonical in renameMap)) {
        renameMap[canonical] = found;
      }
    });
  });

  if (!renameMap.Colorante || !renameMap.Concentracion) {
    throw new Error("Required base columns were not found. Expected Colorante and Concentracion.");
  }

  const headers = table.headers.map((header) => {
    const canonical = Object.entries(renameMap).find(([, original]) => original === header)?.[0];
    return canonical || header;
  });

  const rows = table.rows.map((row) => {
    const out = {};
    Object.entries(row).forEach(([key, value]) => {
      const canonical = Object.entries(renameMap).find(([, original]) => original === key)?.[0];
      out[canonical || key] = value;
    });
    return out;
  });

  return { headers, rows };
}

function validateRequiredColumns(headers, popBase, channelsMap) {
  ["Colorante", "Concentracion"].forEach((column) => {
    if (!headers.includes(column)) {
      throw new Error(`Missing required column: ${column}`);
    }
  });
  const missing = [];
  Object.values(channelsMap).forEach((channel) => {
    const cols = buildColnames(popBase, channel);
    ["freq_pos", "med_pos", "rsd_pos", "med_neg", "rsd_neg"].forEach((key) => {
      if (!headers.includes(cols[key])) {
        missing.push(cols[key]);
      }
    });
  });
  if (missing.length) {
    throw new Error(`Missing expected FlowJo columns:\n- ${missing.join("\n- ")}`);
  }
}

function selectBestConditions(results, options) {
  const grouped = groupBy(results, "Dye");
  const out = [];
  Object.entries(grouped).forEach(([dye, subset]) => {
    let candidatePool = subset.slice();
    let selectionStatus = "SAFE_SELECTION";

    const safe = candidatePool.filter((row) => !row.Clip_Risk);
    if (safe.length) {
      const safer = safe.filter((row) => !row.Near_Clip);
      candidatePool = safer.length ? safer : safe;
    } else {
      selectionStatus = "ONLY_RISKY_OPTIONS";
    }

    const minMissing = Math.min(...candidatePool.map((row) => row.Missing_Nontrivial_Ws_Channels));
    candidatePool = candidatePool.filter((row) => row.Missing_Nontrivial_Ws_Channels === minMissing);

    const rule = resolveRule(dye, options);
    let siThreshold = NaN;
    let wsLimit = NaN;

    if (options.analysisMode === "quality_score") {
      selectionStatus += "|QUALITY_SCORE_MODE";
      candidatePool.sort((a, b) =>
        compareNumbers(a.Missing_Nontrivial_Ws_Channels, b.Missing_Nontrivial_Ws_Channels) ||
        compareNumbers(b.Quality_Score, a.Quality_Score) ||
        compareNumbers(b.Stain_Index, a.Stain_Index)
      );
    } else {
      const useRule = options.analysisMode === "rule_based_per_dye";
      const mode = useRule ? rule.mode : "min_ws_after_si";
      if (mode === "max_si") {
        selectionStatus += "|MAX_SI_MODE";
        candidatePool.sort((a, b) =>
          compareNumbers(b.Stain_Index, a.Stain_Index) ||
          compareNumbers(b.Quality_Score, a.Quality_Score) ||
          compareNumbers(a.Weighted_Severity, b.Weighted_Severity)
        );
      } else {
        const finiteSi = candidatePool.map((row) => row.Stain_Index).filter(Number.isFinite);
        if (finiteSi.length) {
          siThreshold = Math.max(rule.min_acceptable_si, Math.max(...finiteSi) * rule.min_si_fraction_of_max);
          const sufficient = candidatePool.filter((row) => Number.isFinite(row.Stain_Index) && row.Stain_Index >= siThreshold);
          if (sufficient.length) {
            candidatePool = sufficient;
            selectionStatus += "|SUFFICIENT_SI";
          } else {
            selectionStatus += "|NO_SI_THRESHOLD_PASS";
          }
        }
        const minWs = Math.min(...candidatePool.map((row) => row.Weighted_Severity));
        wsLimit = minWs * (1 + rule.ws_equivalence_fraction);
        candidatePool = candidatePool.filter((row) => row.Weighted_Severity <= wsLimit);
        candidatePool.sort((a, b) =>
          compareNumbers(b.Stain_Index, a.Stain_Index) ||
          compareNumbers(b.Quality_Score, a.Quality_Score) ||
          compareNumbers(a.Weighted_Severity, b.Weighted_Severity)
        );
      }
    }

    const best = { ...candidatePool[0] };
    best.Selection_Mode = options.analysisMode === "quality_score" ? "quality_score" : resolveRule(dye, options).mode;
    best.Selection_SI_Threshold = siThreshold;
    best.Selection_Ws_Limit = wsLimit;
    best.Selection_Ws_Tolerance = resolveRule(dye, options).ws_equivalence_fraction;
    best.Selection_Status = selectionStatus;
    out.push(best);
  });

  return out.sort((a, b) => compareText(a.Dye, b.Dye));
}

function resolveRule(dye, options) {
  const baseRule = options.selectionRules[dye] || {};
  return {
    mode: baseRule.mode || "min_ws_after_si",
    min_acceptable_si: Number.isFinite(baseRule.min_acceptable_si) ? baseRule.min_acceptable_si : options.minAcceptableSi,
    min_si_fraction_of_max: Number.isFinite(baseRule.min_si_fraction_of_max) ? baseRule.min_si_fraction_of_max : options.minSiFractionOfMax,
    ws_equivalence_fraction: Number.isFinite(baseRule.ws_equivalence_fraction) ? baseRule.ws_equivalence_fraction : options.wsEquivalenceFraction,
  };
}

function calcIntrusionContribution({ freqRaw, medIntruder, rsdIntruder, medStNeighbor, rsdStNeighbor, freqDivisor, emptyGateThresholdFraction }) {
  if (!Number.isFinite(freqRaw)) return { contribution: NaN, status: "missing_freq" };
  const freqFraction = freqRaw / freqDivisor;
  if (freqFraction <= 0) return { contribution: 0, status: "empty_gate" };
  if (freqFraction <= emptyGateThresholdFraction && (!Number.isFinite(medIntruder) || !Number.isFinite(rsdIntruder))) {
    return { contribution: 0, status: "near_empty_gate" };
  }
  if (![medIntruder, rsdIntruder, medStNeighbor, rsdStNeighbor].every(Number.isFinite)) {
    return { contribution: NaN, status: "missing_metrics_nontrivial_freq" };
  }
  if (medStNeighbor <= 0 || rsdStNeighbor <= 0) {
    return { contribution: NaN, status: "invalid_st_baseline" };
  }
  const contribution = freqFraction * (medIntruder / medStNeighbor) * (rsdIntruder / rsdStNeighbor);
  return { contribution, status: "ok" };
}

function inferFreqDivisor(rows, columns) {
  let maxValue = 0;
  rows.forEach((row) => {
    columns.forEach((column) => {
      if (Number.isFinite(row[column])) {
        maxValue = Math.max(maxValue, row[column]);
      }
    });
  });
  return maxValue > 1.5 ? 100 : 1;
}

function buildColnames(popBase, channel) {
  return {
    freq_pos: `${popBase}/${channel}+ | Freq. of Parent`,
    med_pos: `${popBase}/${channel}+ | Median (${channel})`,
    rsd_pos: `${popBase}/${channel}+ | Robust SD (${channel})`,
    freq_neg: `${popBase}/${channel}- | Freq. of Parent`,
    med_neg: `${popBase}/${channel}- | Median (${channel})`,
    rsd_neg: `${popBase}/${channel}- | Robust SD (${channel})`,
  };
}

function renderResults(result, fileName) {
  document.getElementById("run-summary").textContent = `${fileName} | ${result.results.length} rows analyzed | frequency scale ${result.freqDivisor === 100 ? "0-100" : "0-1"}`;
  renderBestCards(result.best);
  renderTable("best-table", result.best, [
    "Dye", "Clone", "Concentracion", "Target_Channel", "Stain_Index", "Weighted_Severity", "Quality_Score",
    "UpperEnvelope_Target", "Near_Clip", "Clip_Risk", "Selection_Mode", "Selection_Status",
  ]);
  renderTable("ws-table", result.wsBreakdown.slice(0, 24), [
    "Dye", "Clone", "Concentracion", "Neighbor_Channel", "Freq_fraction", "Contribution_Ws", "Status",
  ]);
  renderSummaryPlot(result.results);
  renderSelectionPlot(result.results, result.best);
  document.getElementById("download-best-button").disabled = false;
  document.getElementById("download-results-button").disabled = false;
}

function renderBestCards(rows) {
  const container = document.getElementById("best-cards");
  container.innerHTML = "";
  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "best-card";
    const riskClass = row.Clip_Risk ? "danger" : row.Near_Clip ? "warn" : "safe";
    const riskText = row.Clip_Risk ? "Clip risk" : row.Near_Clip ? "Near clip" : "Safe";
    card.innerHTML = `
      <div class="pill ${riskClass}">${riskText}</div>
      <h3>${escapeHtml(row.Dye)}</h3>
      <p>Recommended concentration: <strong>${escapeHtml(String(row.Concentracion))}</strong></p>
      <dl>
        <dt>Clone</dt><dd>${escapeHtml(row.Clone || "Main")}</dd>
        <dt>Mode</dt><dd>${escapeHtml(row.Selection_Mode)}</dd>
        <dt>SI</dt><dd>${formatNumber(row.Stain_Index)}</dd>
        <dt>Ws</dt><dd>${formatNumber(row.Weighted_Severity)}</dd>
        <dt>QS</dt><dd>${formatNumber(row.Quality_Score)}</dd>
        <dt>Upper env.</dt><dd>${formatNumber(row.UpperEnvelope_Target)}</dd>
        <dt>Interpretation</dt><dd>${interpretRow(row)}</dd>
      </dl>
    `;
    container.appendChild(card);
  });
}

function renderSummaryPlot(results) {
  const seriesStyles = buildSeriesStyles(results);
  const grouped = groupByComposite(results, ["Dye", "Clone"]);
  const traces = [];
  Object.entries(grouped).forEach(([key, rows]) => {
    const [dye, clone] = key.split("|||");
    const style = seriesStyles[key] || { color: DYE_COLORS[0], symbol: CLONE_SYMBOLS[0] };
    const ordered = rows.slice().sort((a, b) => naturalSortKey(String(a.Concentracion)) - naturalSortKey(String(b.Concentracion)));
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${dye} | ${clone}`,
      legendgroup: clone,
      x: ordered.map((row) => String(row.Concentracion)),
      y: ordered.map((row) => row.Stain_Index),
      xaxis: "x1",
      yaxis: "y1",
      marker: { color: style.color, symbol: style.symbol, size: 10 },
      line: { color: style.color, width: 2.2 },
    });
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${dye} | ${clone}`,
      x: ordered.map((row) => String(row.Concentracion)),
      y: ordered.map((row) => Math.max(row.Weighted_Severity, 1e-6)),
      xaxis: "x2",
      yaxis: "y2",
      showlegend: false,
      legendgroup: clone,
      marker: { color: style.color, symbol: style.symbol, size: 10 },
      line: { color: style.color, width: 2.2 },
    });
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${dye} | ${clone}`,
      x: ordered.map((row) => String(row.Concentracion)),
      y: ordered.map((row) => row.Quality_Score),
      xaxis: "x3",
      yaxis: "y3",
      showlegend: false,
      legendgroup: clone,
      marker: { color: style.color, symbol: style.symbol, size: 10 },
      line: { color: style.color, width: 2.2 },
    });
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${dye} | ${clone}`,
      x: ordered.map((row) => String(row.Concentracion)),
      y: ordered.map((row) => row.UpperEnvelope_Target),
      xaxis: "x4",
      yaxis: "y4",
      showlegend: false,
      legendgroup: clone,
      marker: { color: style.color, symbol: style.symbol, size: 10 },
      line: { color: style.color, width: 2.2 },
    });
  });

  Plotly.newPlot("summary-plot", traces, {
    height: 980,
    grid: { rows: 4, columns: 1, pattern: "independent" },
    margin: { t: 30, r: 16, b: 40, l: 60 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.78)",
    legend: { orientation: "h", y: 1.15 },
    yaxis: { title: "SI" },
    yaxis2: { title: "Ws", type: "log" },
    yaxis3: { title: "QS" },
    yaxis4: { title: "Upper envelope" },
    xaxis4: { title: "Concentration" },
  }, { responsive: true, displaylogo: false });
}

function renderSelectionPlot(results, bestRows) {
  const seriesStyles = buildSeriesStyles(results);
  const grouped = groupByComposite(results, ["Dye", "Clone"]);
  const traces = [];
  Object.entries(grouped).forEach(([key, rows]) => {
    const [dye, clone] = key.split("|||");
    const style = seriesStyles[key] || { color: DYE_COLORS[0], symbol: CLONE_SYMBOLS[0] };
    const best = bestRows.find((row) => row.Dye === dye && row.Clone === clone);
    traces.push({
      type: "scatter",
      mode: "markers+text",
      name: `${dye} | ${clone}`,
      legendgroup: clone,
      x: rows.map((row) => Math.max(row.Weighted_Severity, 1e-6)),
      y: rows.map((row) => row.Stain_Index),
      text: rows.map((row) => String(row.Concentracion)),
      textposition: "top center",
      marker: {
        size: rows.map((row) => best && String(row.Concentracion) === String(best.Concentracion) ? 18 : 11),
        color: style.color,
        symbol: rows.map(() => style.symbol),
        line: {
          color: rows.map((row) => best && String(row.Concentracion) === String(best.Concentracion) ? "#111111" : "rgba(0,0,0,0.3)"),
          width: rows.map((row) => best && String(row.Concentracion) === String(best.Concentracion) ? 3 : 1),
        },
        opacity: rows.map((row) => row.Clip_Risk ? 0.65 : row.Near_Clip ? 0.82 : 1),
      },
      hovertemplate: "Series: %{name}<br>Conc: %{text}<br>SI: %{y:.3f}<br>Ws: %{x:.3f}<extra></extra>",
    });
  });

  Plotly.newPlot("selection-plot", traces, {
    margin: { t: 30, r: 16, b: 48, l: 60 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.78)",
    xaxis: { title: "Ws (lower is better)", type: "log" },
    yaxis: { title: "SI (higher is better)" },
    legend: { orientation: "h", y: 1.1 },
  }, { responsive: true, displaylogo: false });
}

function renderTable(targetId, rows, columns) {
  const root = document.getElementById(targetId);
  if (!rows.length) {
    root.innerHTML = "<p class='muted'>No rows.</p>";
    return;
  }
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatCell(row[column]))}</td>`).join("")}</tr>`).join("")}
    </tbody>
  `;
  root.innerHTML = "";
  root.appendChild(table);
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(formatCell(row[header]))).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function chooseConcentrationOrder(values) {
  return [...new Set(values.filter((value) => value != null).map((value) => String(value)))].sort((a, b) => naturalSortCompare(a, b));
}

function sortRows(rows, keys, concOrder) {
  return rows.slice().sort((a, b) => {
    for (const key of keys) {
      if (key === "Concentracion") {
        const ai = concOrder.indexOf(String(a[key]));
        const bi = concOrder.indexOf(String(b[key]));
        if (ai !== bi) return ai - bi;
      } else {
        const cmp = compareText(String(a[key] ?? ""), String(b[key] ?? ""));
        if (cmp) return cmp;
      }
    }
    return 0;
  });
}

function isSummaryRow(row) {
  const values = ["Sample", "Colorante", "Concentracion"]
    .map((key) => cleanText(row[key]))
    .filter((value) => value !== null)
    .map((value) => String(value).toLowerCase());
  if (!values.length) return false;
  const compact = values.join(" ");
  return SUMMARY_TOKENS.some((token) => compact.includes(token));
}

function canonicalizeDyeName(value) {
  const text = cleanText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  const mapping = {
    st: "ST",
    unstained: "ST",
    "control st unstained": "ST",
    "gfp": "GFP (proteina recombinante)",
    "gfp (proteina recombinante)": "GFP (proteina recombinante)",
    tmrm: "TMRM",
    bodipy: "Bodipy",
    cellrox: "CellRox Deep Red",
    "cellrox deep red": "CellRox Deep Red",
  };
  return mapping[lower] || text;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\ufeff/g, "").trim();
  return text === "" ? null : text;
}

function normalizeHeaderText(value) {
  return String(value).replace(/\ufeff/g, "").trim().replace(/\s+/g, " ");
}

function parseMaybeNumber(value) {
  const text = cleanText(value);
  if (text === null) return NaN;
  const lower = text.toLowerCase();
  if (["n/a", "na", "nan", "null"].includes(lower)) return NaN;
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key];
    acc[value] = acc[value] || [];
    acc[value].push(row);
    return acc;
  }, {});
}

function groupByComposite(rows, keys) {
  return rows.reduce((acc, row) => {
    const compositeKey = keys.map((key) => String(row[key] ?? "Main")).join("|||");
    acc[compositeKey] = acc[compositeKey] || [];
    acc[compositeKey].push(row);
    return acc;
  }, {});
}

function buildSeriesStyles(rows) {
  const dyes = [...new Set(rows.map((row) => row.Dye || "Unknown"))];
  const clones = [...new Set(rows.map((row) => row.Clone || "Main"))];
  const dyeColors = {};
  const cloneSymbols = {};

  dyes.forEach((dye, index) => {
    dyeColors[dye] = DYE_COLORS[index % DYE_COLORS.length];
  });
  clones.forEach((clone, index) => {
    cloneSymbols[clone] = CLONE_SYMBOLS[index % CLONE_SYMBOLS.length];
  });

  const styles = {};
  rows.forEach((row) => {
    const dye = row.Dye || "Unknown";
    const clone = row.Clone || "Main";
    const key = `${dye}|||${clone}`;
    styles[key] = {
      color: dyeColors[dye],
      symbol: cloneSymbols[clone],
    };
  });
  return styles;
}

function inferCloneLabel(sampleName) {
  const text = cleanText(sampleName);
  if (!text) return "Main";
  const stem = text.replace(/\.[^.]+$/, "");
  const patterns = [
    /(?:^|[_\s-])(clone[_\s-]?[A-Za-z0-9]+)$/i,
    /(?:^|[_\s-])(clona[_\s-]?[A-Za-z0-9]+)$/i,
    /(?:^|[_\s-])(high|low)$/i,
    /(?:^|[_\s-])(wt|ko)$/i,
    /(?:^|[_\s-])(c\d+|c)$/i,
    /(?:^|[_\s-])([A-Z])$/i,
  ];
  for (const pattern of patterns) {
    const match = stem.match(pattern);
    if (match) {
      return match[1].replace(/[_\s-]+/g, " ").trim();
    }
  }
  return "Main";
}

function interpretRow(row) {
  if (row.Clip_Risk) return "Rejected if safer alternatives exist because the target envelope reaches the detector ceiling.";
  if (row.Near_Clip) return "Usable, but close to the detector limit.";
  if (row.Selection_Mode === "max_si") return "Selected by strongest separation after safety filtering.";
  return "Selected after requiring sufficient separation and then minimizing spill cost.";
}

function setStatus(message) {
  document.getElementById("status-line").textContent = message;
}

function showError(message) {
  const box = document.getElementById("error-box");
  box.textContent = message;
  box.classList.remove("hidden");
}

function clearError() {
  const box = document.getElementById("error-box");
  box.textContent = "";
  box.classList.add("hidden");
}

function compareNumbers(a, b) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return 1;
  if (!Number.isFinite(b)) return -1;
  return a - b;
}

function compareText(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function naturalSortCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function naturalSortKey(value) {
  return Number(String(value).replace(/[^\d.]+/g, "")) || 0;
}

function formatCell(value) {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Number.isFinite(value)) return formatNumber(value);
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) return "";
  return String(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "";
  return Math.abs(value) >= 1000 ? value.toFixed(1) : value.toFixed(3).replace(/\.?0+$/, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isEmptyObject(row) {
  return !Object.values(row).some((value) => value !== null);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(text) {
  return escapeHtml(text);
}
