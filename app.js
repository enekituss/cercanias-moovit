(function () {
  "use strict";

  const STORAGE_KEY = "cercanias-moovit-data-v1";
  const DEMO_DATA = {
    meta: {
      title: "Cercanías Moovit · Bilbao",
      version: 1,
      source: "Ejemplo facilitado por el usuario",
      demo: true,
      note: "Solo incluye un ejemplo de dos servicios enlazados. No representa el horario completo ni datos en tiempo real."
    },
    stations: ["Bilbao-Abando", "Santurtzi", "Muskiz", "Orduña", "Llodio"],
    services: [
      {
        id: "26137",
        line: "C1",
        origin: "Bilbao-Abando",
        destination: "Santurtzi",
        departure: "13:25",
        arrival: "13:49",
        trainset: "C1-UNIDAD-DEMO-01",
        nextServiceId: "26140",
        turnaroundMin: 3,
        source: "Ejemplo facilitado por el usuario"
      },
      {
        id: "26140",
        line: "C1",
        origin: "Santurtzi",
        destination: "Bilbao-Abando",
        departure: "14:03",
        arrival: "14:27",
        trainset: "C1-UNIDAD-DEMO-01",
        nextServiceId: "",
        turnaroundMin: 3,
        source: "Ejemplo facilitado por el usuario"
      }
    ]
  };

  let data = null;
  let activeServiceId = null;
  let toastTimer = null;

  const $ = function (id) { return document.getElementById(id); };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function showToast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { node.classList.remove("show"); }, 3200);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function validTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function validateData(candidate) {
    if (!candidate || !Array.isArray(candidate.services) || candidate.services.length === 0) {
      throw new Error("El archivo debe contener una lista services con al menos una circulación.");
    }
    const ids = new Set();
    candidate.services.forEach(function (service, index) {
      if (!service.id || !service.line || !service.origin || !service.destination || !validTime(service.departure) || !validTime(service.arrival)) {
        throw new Error("La circulación de la fila " + (index + 1) + " tiene campos obligatorios incompletos.");
      }
      const id = String(service.id);
      if (ids.has(id)) throw new Error("El número de circulación " + id + " está duplicado.");
      ids.add(id);
    });
    candidate.services.forEach(function (service) {
      if (service.nextServiceId && !candidate.services.some(function (item) { return String(item.id) === String(service.nextServiceId); })) {
        throw new Error("No se encuentra la siguiente circulación " + service.nextServiceId + " enlazada desde " + service.id + ".");
      }
    });
    return {
      meta: candidate.meta || { title: "Datos importados", demo: false },
      stations: Array.isArray(candidate.stations) ? candidate.stations : collectStations(candidate.services),
      services: candidate.services.map(function (item) {
        return {
          id: String(item.id),
          line: String(item.line).toUpperCase(),
          origin: String(item.origin),
          destination: String(item.destination),
          departure: item.departure,
          arrival: item.arrival,
          trainset: String(item.trainset || ""),
          nextServiceId: item.nextServiceId ? String(item.nextServiceId) : "",
          turnaroundMin: Number.isFinite(Number(item.turnaroundMin)) ? Number(item.turnaroundMin) : 3,
          source: String(item.source || "Datos importados")
        };
      })
    };
  }

  function collectStations(services) {
    const result = new Set();
    services.forEach(function (service) {
      result.add(service.origin);
      result.add(service.destination);
    });
    return Array.from(result).sort();
  }

  function setData(candidate, persist) {
    data = validateData(candidate);
    if (persist) {
      data.meta.demo = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    populateStations();
    updateDataStatus();
    $("service-count").textContent = String(data.services.length);
  }

  function populateStations() {
    const select = $("station-input");
    const previous = select.value;
    const stations = Array.from(new Set((data.stations || []).concat(collectStations(data.services)))).sort();
    select.innerHTML = stations.map(function (station) {
      return '<option value="' + escapeHtml(station) + '">' + escapeHtml(station) + "</option>";
    }).join("");
    if (stations.indexOf(previous) >= 0) select.value = previous;
  }

  function updateDataStatus() {
    const count = data.services.length;
    const isDemo = Boolean(data.meta && data.meta.demo);
    $("data-badge").textContent = isDemo ? "DATOS DE DEMOSTRACIÓN" : "DATOS PERSONALIZADOS";
    $("data-badge").classList.toggle("custom", !isDemo);
    $("service-count").textContent = String(count);
  }

  function setSearchMode(mode) {
    const byNumber = mode === "number";
    $("tab-number").classList.toggle("active", byNumber);
    $("tab-station").classList.toggle("active", !byNumber);
    $("tab-number").setAttribute("aria-selected", String(byNumber));
    $("tab-station").setAttribute("aria-selected", String(!byNumber));
    $("number-form").classList.toggle("hidden", !byNumber);
    $("station-form").classList.toggle("hidden", byNumber);
  }

  function getService(id) {
    return data.services.find(function (service) { return String(service.id) === String(id); }) || null;
  }

  function getChain(startId) {
    const chain = [];
    const visited = new Set();
    let current = getService(startId);
    while (current && !visited.has(String(current.id)) && chain.length < 50) {
      chain.push(current);
      visited.add(String(current.id));
      current = current.nextServiceId ? getService(current.nextServiceId) : null;
    }
    return chain;
  }

  function minutesOfDay(value) {
    const parts = value.split(":").map(Number);
    return parts[0] * 60 + parts[1];
  }

  function clock(value) {
    const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
  }

  function daySuffix(value) {
    const day = Math.floor(value / 1440);
    return day > 0 ? " (+" + day + " día" + (day > 1 ? "s" : "") + ")" : "";
  }

  function formatEstimate(value) {
    return clock(value) + daySuffix(value);
  }

  function delayLabel(value) {
    const rounded = Math.round(value);
    if (rounded <= 0) return "En hora";
    return "+" + rounded + " min";
  }

  function renderChain(chain) {
    return chain.map(function (service, index) {
      const current = index === 0;
      const lineClass = service.line.toLowerCase();
      return '<div class="chain-item ' + (current ? "current" : "") + '">' +
        '<span class="chain-index">' + String(index + 1).padStart(2, "0") + "</span>" +
        '<div class="chain-copy"><strong>' + escapeHtml(service.id) + ' <span class="line-chip ' + escapeHtml(lineClass) + '">' + escapeHtml(service.line) + "</span></strong>" +
        "<small>" + escapeHtml(service.origin) + " → " + escapeHtml(service.destination) + (service.trainset ? " · " + escapeHtml(service.trainset) : "") + "</small></div>" +
        '<span class="chain-time">' + escapeHtml(service.departure) + " – " + escapeHtml(service.arrival) + "</span></div>";
    }).join("");
  }

  function renderResult(service) {
    if (!service) return;
    activeServiceId = String(service.id);
    const chain = getChain(service.id);
    const isDemo = Boolean(data.meta && data.meta.demo);
    $("empty-panel").classList.add("hidden");
    const panel = $("result-panel");
    panel.classList.remove("hidden");
    panel.innerHTML =
      '<div class="result-top"><div><div class="result-kicker">CIRCULACIÓN LOCALIZADA</div><div class="result-title"><h2>' + escapeHtml(service.id) + '</h2><span class="line-chip ' + escapeHtml(service.line.toLowerCase()) + '">' + escapeHtml(service.line) + "</span></div>" +
      '<div class="result-subtitle">' + escapeHtml(service.origin) + " → " + escapeHtml(service.destination) + "</div></div>" +
      '<span class="status-pill ' + (isDemo ? "demo" : "") + '">' + (isDemo ? "EJEMPLO" : "HORARIO CARGADO") + "</span></div>" +
      '<div class="route-summary"><div class="station-block"><small>SALIDA PROGRAMADA</small><strong>' + escapeHtml(service.origin) + '</strong><time>' + escapeHtml(service.departure) + '</time></div>' +
      '<div class="route-arrow">→</div><div class="station-block"><small>LLEGADA PROGRAMADA</small><strong>' + escapeHtml(service.destination) + '</strong><time>' + escapeHtml(service.arrival) + "</time></div></div>" +
      '<hr class="section-divider"><div class="subsection-heading"><h3>Rotación del mismo material</h3><span>' + chain.length + " servicio" + (chain.length === 1 ? "" : "s") + " enlazado" + (chain.length === 1 ? "" : "s") + "</span></div>" +
      '<div class="chain-list">' + renderChain(chain) + "</div>" +
      '<section class="simulator"><div class="simulator-head"><div><div class="simulator-label">02 · SIMULADOR</div><h3>Propagación del retraso</h3><p>Introduce la demora a la llegada de la circulación ' + escapeHtml(service.id) + ".</p></div></div>" +
      '<div class="sim-controls"><div class="sim-field"><label for="delay-input">RETRASO DE LLEGADA (MIN)</label><input class="sim-input" id="delay-input" type="number" min="0" max="600" step="1" value="14"></div>' +
      '<div class="sim-field"><label for="turnaround-input">INVERSIÓN MÍNIMA (MIN)</label><input class="sim-input" id="turnaround-input" type="number" min="0" max="180" step="1" value="' + escapeHtml(service.turnaroundMin || 3) + '"></div>' +
      '<div class="sim-field"><label for="recovery-input">RECUPERACIÓN EN MARCHA (MIN)</label><input class="sim-input" id="recovery-input" type="number" min="0" max="180" step="1" value="0"></div></div>' +
      '<div class="sim-output" id="simulation-output"></div><p class="sim-explanation" id="simulation-explanation"></p>' +
      '<div class="sim-warning">Estimación teórica basada en los horarios cargados y los márgenes configurados. No incorpora incidencias, cruces, regulación del tráfico ni decisiones operativas de Renfe.</div></section>' +
      '<p class="muted-note source-note">Fuente de estos datos: ' + escapeHtml(service.source || "Datos cargados") + ". La relación entre servicios depende del enlace de material indicado en el horario.</p>";

    ["delay-input", "turnaround-input", "recovery-input"].forEach(function (id) {
      $(id).addEventListener("input", renderSimulation);
    });
    renderSimulation();
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderSimulation() {
    if (!activeServiceId || !$("simulation-output")) return;
    const chain = getChain(activeServiceId);
    const delay = Math.max(0, Math.min(600, Number($("delay-input").value) || 0));
    const turnaround = Math.max(0, Math.min(180, Number($("turnaround-input").value) || 0));
    const recovery = Math.max(0, Math.min(180, Number($("recovery-input").value) || 0));
    let previousScheduledArrival = minutesOfDay(chain[0].arrival);
    let previousPredictedArrival = previousScheduledArrival + delay;
    const rows = [];

    rows.push({
      service: chain[0],
      depPlanned: minutesOfDay(chain[0].departure),
      depEstimated: null,
      arrPlanned: previousScheduledArrival,
      arrEstimated: previousPredictedArrival
    });

    for (let index = 1; index < chain.length; index += 1) {
      const service = chain[index];
      let depPlanned = minutesOfDay(service.departure);
      while (depPlanned < previousScheduledArrival) depPlanned += 1440;
      let arrPlanned = minutesOfDay(service.arrival);
      while (arrPlanned < depPlanned) arrPlanned += 1440;
      const minTurn = turnaround;
      const depEstimated = Math.max(depPlanned, previousPredictedArrival + minTurn);
      const departureDelay = depEstimated - depPlanned;
      const recovered = Math.min(departureDelay, recovery);
      const arrEstimated = arrPlanned + departureDelay - recovered;
      rows.push({
        service: service,
        depPlanned: depPlanned,
        depEstimated: depEstimated,
        arrPlanned: arrPlanned,
        arrEstimated: arrEstimated
      });
      previousScheduledArrival = arrPlanned;
      previousPredictedArrival = arrEstimated;
    }

    const tableRows = rows.map(function (row, index) {
      const departureHtml = row.depEstimated === null
        ? '<span class="time-pair"><span>' + clock(row.depPlanned) + '</span><span class="planned">—</span></span>'
        : '<span class="time-pair"><span class="planned">' + clock(row.depPlanned) + '</span><span class="estimated">' + formatEstimate(row.depEstimated) + "</span></span>";
      const arrivalDelay = row.arrEstimated - row.arrPlanned;
      const arrivalHtml = '<span class="time-pair"><span class="planned">' + clock(row.arrPlanned) + '</span><span class="estimated">' + formatEstimate(row.arrEstimated) + "</span></span>";
      return "<tr><td>" + escapeHtml(row.service.id) + (index === 0 ? '<br><span style="font-size:7px;color:#91a4b2;font-weight:500">ACTUAL</span>' : "") + "</td><td>" + departureHtml + "</td><td>" + arrivalHtml + '</td><td class="delay-cell ' + (arrivalDelay > 0 ? "delayed" : "") + '">' + escapeHtml(delayLabel(arrivalDelay)) + "</td></tr>";
    }).join("");

    $("simulation-output").innerHTML =
      '<table class="sim-table"><thead><tr><th>CIRCULACIÓN</th><th>SALIDA<br>PROG. → EST.</th><th>LLEGADA<br>PROG. → EST.</th><th>RETRASO</th></tr></thead><tbody>' + tableRows + "</tbody></table>";

    if (chain.length === 1) {
      $("simulation-explanation").textContent = "No hay un siguiente servicio enlazado en los datos cargados. Añade el siguiente número de circulación al campo nextServiceId del horario.";
    } else {
      const next = rows[1];
      const nextDelay = next.depEstimated - next.depPlanned;
      const finalRow = rows[rows.length - 1];
      const finalDelay = finalRow.arrEstimated - finalRow.arrPlanned;
      if (nextDelay === 0) {
        $("simulation-explanation").textContent = "El margen entre la llegada prevista y la siguiente salida permite absorber el retraso antes del próximo servicio.";
      } else {
        $("simulation-explanation").textContent = "El primer servicio posterior saldría con " + Math.round(nextDelay) + " min de demora. Al final de la cadena mostrada, el retraso estimado sería de " + Math.round(finalDelay) + " min.";
      }
    }
  }

  function searchByNumber(value) {
    const query = String(value || "").trim();
    if (!query) return showToast("Escribe un número de circulación.");
    const exact = getService(query);
    if (exact) {
      renderResult(exact);
      return;
    }
    const matches = data.services.filter(function (service) { return String(service.id).indexOf(query) !== -1; });
    if (matches.length === 1) {
      renderResult(matches[0]);
    } else if (matches.length > 1) {
      showToast("Hay varias coincidencias. Introduce el número completo.");
    } else {
      showNoMatch("No se ha encontrado la circulación " + query + ".", "Comprueba el número o importa una tabla de horarios que incluya ese servicio.");
    }
  }

  function searchByStation() {
    const station = $("station-input").value;
    const time = $("time-input").value || "00:00";
    const line = $("line-input").value;
    const target = minutesOfDay(time);
    const matches = data.services.filter(function (service) {
      return service.origin === station && minutesOfDay(service.departure) >= target && (line === "all" || service.line === line);
    }).sort(function (a, b) { return minutesOfDay(a.departure) - minutesOfDay(b.departure); });
    if (!matches.length) {
      showNoMatch("No hay salidas cargadas desde " + station + " a partir de las " + time + ".", "Prueba otra hora o línea, o importa el horario completo.");
      return;
    }
    renderResult(matches[0]);
    if (matches.length > 1) showToast("Se ha seleccionado la primera de " + matches.length + " salidas coincidentes.");
  }

  function showNoMatch(title, description) {
    activeServiceId = null;
    $("result-panel").classList.remove("hidden");
    $("empty-panel").classList.add("hidden");
    $("result-panel").innerHTML = '<div class="no-match"><strong>' + escapeHtml(title) + "</strong><p>" + escapeHtml(description) + "</p></div>";
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cercanias-moovit-horarios.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Se ha preparado la descarga de los horarios.");
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result));
        setData(parsed, true);
        $("result-panel").classList.add("hidden");
        $("empty-panel").classList.remove("hidden");
        activeServiceId = null;
        showToast("Horarios importados correctamente: " + data.services.length + " circulaciones.");
      } catch (error) {
        showToast("No se pudieron importar los datos: " + error.message);
      }
      $("import-file").value = "";
    };
    reader.onerror = function () { showToast("No se ha podido leer el archivo seleccionado."); };
    reader.readAsText(file);
  }

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY);
    setData(clone(DEMO_DATA), false);
    $("circulation-input").value = "26137";
    searchByNumber("26137");
    showToast("Se han restaurado los datos de demostración.");
  }

  function init() {
    $("tab-number").addEventListener("click", function () { setSearchMode("number"); });
    $("tab-station").addEventListener("click", function () { setSearchMode("station"); });
    $("number-form").addEventListener("submit", function (event) {
      event.preventDefault();
      searchByNumber($("circulation-input").value);
    });
    $("station-form").addEventListener("submit", function (event) {
      event.preventDefault();
      searchByStation();
    });
    $("import-button").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function (event) { importData(event.target.files[0]); });
    $("export-button").addEventListener("click", exportData);
    $("reset-demo").addEventListener("click", resetDemo);

    let saved = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) saved = JSON.parse(stored);
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }

    if (saved) {
      try {
        setData(saved, false);
        searchByNumber("26137");
      } catch (error) {
        setData(clone(DEMO_DATA), false);
        searchByNumber("26137");
        showToast("Se han recuperado los datos de demostración.");
      }
      return;
    }

    fetch("./data/schedules.json")
      .then(function (response) {
        if (!response.ok) throw new Error("No se pudo cargar el archivo inicial.");
        return response.json();
      })
      .then(function (initialData) {
        setData(initialData, false);
        searchByNumber("26137");
      })
      .catch(function () {
        setData(clone(DEMO_DATA), false);
        searchByNumber("26137");
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();