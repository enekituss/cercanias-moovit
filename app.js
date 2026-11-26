(function () {
  "use strict";

  const CALENDAR_URL = "./data/calendar.json";
  const STATIONS_URL = "./data/stations.json";
  const LIVE_URLS = {
    vehicles: "https://gtfsrt.renfe.com/vehicle_positions.json",
    updates: "https://gtfsrt.renfe.com/trip_updates.json"
  };
  const ROTATION_KEY = "cercanias-moovit-rotations-v2";
  const MIN_TURNAROUND_DEFAULT = 3;

  const $ = function (id) { return document.getElementById(id); };
  let calendarData = null;
  let stations = [];
  let stationById = new Map();
  let dayData = null;
  let selectedDate = "";
  let activeService = null;
  let liveVehicles = new Map();
  let liveUpdates = new Map();
  let liveConnected = false;
  let refreshBusy = false;
  let toastTimer = null;
  let dayCache = new Map();
  let rotations = readRotations();

  function readRotations() {
    try { return JSON.parse(localStorage.getItem(ROTATION_KEY) || "{}"); }
    catch (error) { return {}; }
  }
  function saveRotations() {
    try { localStorage.setItem(ROTATION_KEY, JSON.stringify(rotations)); }
    catch (error) { showToast("No se pudo guardar el enlace en este navegador."); }
  }
  function showToast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { node.classList.remove("show"); }, 3400);
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function madridToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }
  function parseMinutes(value) {
    const bits = String(value || "00:00").split(":");
    return (Number(bits[0]) || 0) * 60 + (Number(bits[1]) || 0);
  }
  function clock(value) {
    const total = Math.round(value);
    const day = Math.floor(total / 1440);
    const normalized = ((total % 1440) + 1440) % 1440;
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + (day > 0 ? " (+" + day + "d)" : "");
  }
  function shortTime(value) { return String(value || "").slice(0, 5); }
  function formatDate(date) {
    const item = calendarData && calendarData.dates.find(function (x) { return x.date === date; });
    if (item) return item.weekday.charAt(0).toUpperCase() + item.weekday.slice(1) + " · " + item.service_type;
    return date;
  }
  function stationName(id) {
    const station = stationById.get(String(id));
    if (!station) return String(id || "Estación desconocida");
    if (station.name === "Bilbao-Intermod. Abando Indalecio Prieto") return "Bilbao-Abando";
    return station.name;
  }
  function lineClass(line) { return String(line || "").toLowerCase(); }
  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status + " en " + url);
    return response.json();
  }

  async function initialize() {
    try {
      const results = await Promise.all([fetchJson(CALENDAR_URL), fetchJson(STATIONS_URL)]);
      calendarData = results[0];
      stations = results[1];
      stationById = new Map(stations.map(function (station) { return [String(station.id), station]; }));
      setupCalendar();
      populateStations();
      $("data-badge").textContent = "GTFS RENFE";
      $("source-range").textContent = "Vigencia: " + calendarData.meta.valid_from + " a " + calendarData.meta.valid_to;
      const today = madridToday();
      const available = calendarData.dates.some(function (item) { return item.date === today; });
      const initialDate = available ? today : calendarData.dates[0].date;
      await loadDate(initialDate);
      if (!available) showToast("Hoy no está dentro de la vigencia del GTFS cargado. Se ha seleccionado el primer día disponible.");
      refreshRealtime();
      window.setInterval(refreshRealtime, 20000);
    } catch (error) {
      $("data-badge").textContent = "ERROR DE DATOS";
      $("empty-panel").innerHTML = '<div class="empty-icon">!</div><h2>No se han podido cargar los horarios</h2><p>' + escapeHtml(error.message) + '. Comprueba que GitHub Actions haya generado data/calendar.json y data/stations.json.</p>';
      setLiveStatus("SIN DATOS", false);
    }
  }

  function setupCalendar() {
    const input = $("service-date");
    const dates = calendarData.dates.map(function (item) { return item.date; }).sort();
    input.min = dates[0];
    input.max = dates[dates.length - 1];
    $("date-range").textContent = "Horario válido del " + dates[0] + " al " + dates[dates.length - 1];
    input.addEventListener("change", function () { loadDate(input.value); });
    $("today-button").addEventListener("click", function () {
      const today = madridToday();
      if (!calendarData.dates.some(function (item) { return item.date === today; })) {
        showToast("El horario cargado no incluye la fecha de hoy (" + today + ").");
        return;
      }
      input.value = today;
      loadDate(today);
    });
  }

  function populateStations() {
    const select = $("station-input");
    const sorted = stations.slice().sort(function (a, b) { return stationName(a.id).localeCompare(stationName(b.id), "es"); });
    select.innerHTML = sorted.map(function (station) {
      return '<option value="' + escapeHtml(station.id) + '">' + escapeHtml(stationName(station.id)) + "</option>";
    }).join("");
    const abando = stations.find(function (station) { return station.name.indexOf("Abando") >= 0; });
    if (abando) select.value = abando.id;
  }

  async function loadDate(date) {
    if (!calendarData || !calendarData.dates.some(function (item) { return item.date === date; })) {
      showToast("No hay horario GTFS disponible para esa fecha.");
      return;
    }
    selectedDate = date;
    $("service-date").value = date;
    const info = calendarData.dates.find(function (item) { return item.date === date; });
    $("date-description").textContent = formatDate(date) + " · " + info.total + " circulaciones";
    $("service-count").textContent = String(info.total);
    $("count-c1").textContent = String(info.by_line.C1 || 0);
    $("count-c2").textContent = String(info.by_line.C2 || 0);
    $("count-c3").textContent = String(info.by_line.C3 || 0);
    activeService = null;
    $("result-panel").classList.add("hidden");
    $("empty-panel").classList.remove("hidden");
    $("empty-panel").innerHTML = '<div class="empty-icon">⌕</div><h2>Horario del ' + escapeHtml(info.weekday) + '</h2><p>Selecciona una circulación o estación. Hoy se ofrecen ' + info.total + ' circulaciones entre C1, C2 y C3.</p>';
    setLiveStatus(date === madridToday() ? "ACTUALIZANDO RT" : "FECHA HISTÓRICA / FUTURA", date === madridToday());
    try {
      if (dayCache.has(date)) dayData = dayCache.get(date);
      else {
        dayData = await fetchJson("./data/days/" + date + ".json");
        dayCache.set(date, dayData);
      }
      if (selectedDate !== date) return;
      $("service-count").textContent = String(dayData.services.length);
      $("data-badge").textContent = "GTFS · " + dayData.services.length + " SERVICIOS";
    } catch (error) {
      $("data-badge").textContent = "ERROR DE HORARIO";
      showNoMatch("No se pudo cargar el horario de " + date + ".", "Comprueba que exista el archivo data/days/" + date + ".json en la publicación.");
    }
    liveVehicles = new Map();
    liveUpdates = new Map();
    if (date === madridToday()) refreshRealtime();
    else renderLiveHeader();
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
  function findServiceByTripId(tripId) {
    return dayData && dayData.services.find(function (service) { return service.trip_id === tripId; }) || null;
  }
  function findServicesByCirculation(circulation) {
    if (!dayData) return [];
    return dayData.services.filter(function (service) {
      return String(service.circulation) === String(circulation).trim();
    });
  }
  function findCandidates(service, minTurnaround) {
    if (!dayData || !service) return [];
    const earliest = parseMinutes(service.arrival) + (minTurnaround == null ? MIN_TURNAROUND_DEFAULT : minTurnaround);
    return dayData.services.filter(function (candidate) {
      return candidate.trip_id !== service.trip_id &&
        candidate.line === service.line &&
        String(candidate.origin_id) === String(service.destination_id) &&
        parseMinutes(candidate.departure) >= earliest;
    }).sort(function (a, b) {
      return parseMinutes(a.departure) - parseMinutes(b.departure);
    });
  }
  function nextService(service) {
    if (!service) return null;
    const savedId = rotations[service.trip_id];
    if (savedId) {
      const saved = findServiceByTripId(savedId);
      if (saved) return { service: saved, confirmed: true, candidates: findCandidates(service, MIN_TURNAROUND_DEFAULT) };
      delete rotations[service.trip_id];
      saveRotations();
    }
    const candidates = findCandidates(service, MIN_TURNAROUND_DEFAULT);
    return { service: candidates[0] || null, confirmed: false, candidates: candidates };
  }
  function getChain(startService, maxLength) {
    const chain = [startService];
    const visited = new Set([startService.trip_id]);
    while (chain.length < (maxLength || 10)) {
      const next = nextService(chain[chain.length - 1]);
      if (!next || !next.service || visited.has(next.service.trip_id)) break;
      chain.push(next.service);
      visited.add(next.service.trip_id);
    }
    return chain;
  }

  function searchByNumber(value) {
    const query = String(value || "").trim();
    if (!query) return showToast("Escribe un número de circulación.");
    const matches = findServicesByCirculation(query);
    if (!matches.length) {
      const byTrip = dayData && dayData.services.find(function (service) { return service.trip_id.toLowerCase() === query.toLowerCase(); });
      if (byTrip) return renderResult(byTrip);
      return showNoMatch("No aparece la circulación " + query + " el " + selectedDate + ".", "Prueba otra fecha o comprueba el número de circulación.");
    }
    if (matches.length > 1) {
      showNoMatch("Hay varias circulaciones con ese número.", "Añade la línea o usa el identificador completo del viaje.");
      return;
    }
    renderResult(matches[0]);
  }

  function searchByStation() {
    if (!dayData) return;
    const stationId = $("station-input").value;
    const targetTime = $("time-input").value || "00:00";
    const target = parseMinutes(targetTime);
    const line = $("line-input").value;
    const matches = [];
    dayData.services.forEach(function (service) {
      if (line !== "all" && service.line !== line) return;
      const stop = service.stops.find(function (item) { return String(item[0]) === String(stationId); });
      if (!stop) return;
      const departure = stop[2] || stop[1];
      if (parseMinutes(departure) >= target) matches.push({ service: service, stop: stop });
    });
    matches.sort(function (a, b) {
      return parseMinutes(a.stop[2] || a.stop[1]) - parseMinutes(b.stop[2] || b.stop[1]);
    });
    if (!matches.length) {
      showNoMatch("No hay salidas desde " + stationName(stationId) + " a partir de las " + targetTime + ".", "Prueba otra hora o línea.");
      return;
    }
    renderResult(matches[0].service, stationId);
    if (matches.length > 1) showToast("Primera salida encontrada. Hay " + matches.length + " servicios posteriores a esa hora.");
  }

  function renderResult(service, focusStopId) {
    if (!service || !dayData) return;
    activeService = service;
    const panel = $("result-panel");
    $("empty-panel").classList.add("hidden");
    panel.classList.remove("hidden");

    const chain = getChain(service, 10);
    const next = nextService(service);
    const nextOptions = next && next.candidates ? next.candidates.slice(0, 12) : [];
    const nextControl = next && next.service
      ? '<div class="rotation-control"><div><strong>' + escapeHtml(next.service.circulation) + '</strong> <span class="line-chip ' + lineClass(next.service.line) + '">' + escapeHtml(next.service.line) + '</span><small>' + escapeHtml(stationName(next.service.origin_id)) + " " + escapeHtml(shortTime(next.service.departure)) + " → " + escapeHtml(stationName(next.service.destination_id)) + " " + escapeHtml(shortTime(next.service.arrival)) + '</small></div><span class="rotation-label ' + (next.confirmed ? "confirmed" : "estimated") + '">' + (next.confirmed ? "ENLACE CONFIRMADO" : "CONTINUIDAD POSIBLE") + '</span></div>' +
        (nextOptions.length > 1 ? '<label class="field rotation-select-field"><span>SELECCIONAR SIGUIENTE CIRCULACIÓN</span><select id="next-service-select">' + nextOptions.map(function (item) {
          return '<option value="' + escapeHtml(item.trip_id) + '" ' + (item.trip_id === next.service.trip_id ? "selected" : "") + ">" + escapeHtml(item.circulation + " · " + shortTime(item.departure) + " → " + stationName(item.destination_id)) + "</option>";
        }).join("") + "</select></label>" : "") +
        '<div class="rotation-actions"><button class="button button-quiet" id="confirm-rotation" type="button">' + (next.confirmed ? "Actualizar enlace" : "Confirmar que es el mismo tren") + '</button>' + (next.confirmed ? '<button class="text-button" id="remove-rotation" type="button">Quitar confirmación</button>' : "") + '</div>'
      : '<div class="no-next">No se ha encontrado una salida posterior desde ' + escapeHtml(stationName(service.destination_id)) + ' en la misma línea y fecha.</div>';

    panel.innerHTML =
      '<div class="result-top"><div><div class="result-kicker">CIRCULACIÓN OFICIAL · ' + escapeHtml(selectedDate) + '</div><div class="result-title"><h2>' + escapeHtml(service.circulation) + '</h2><span class="line-chip ' + lineClass(service.line) + '">' + escapeHtml(service.line) + '</span></div><div class="result-subtitle">' + escapeHtml(stationName(service.origin_id)) + " → " + escapeHtml(stationName(service.destination_id)) + '</div></div><span class="status-pill">' + escapeHtml(calendarData.dates.find(function (x) { return x.date === selectedDate; }).service_type.toUpperCase()) + '</span></div>' +
      '<div class="route-summary"><div class="station-block"><small>SALIDA PROGRAMADA</small><strong>' + escapeHtml(stationName(service.origin_id)) + '</strong><time>' + escapeHtml(shortTime(service.departure)) + '</time></div><div class="route-arrow">→</div><div class="station-block"><small>LLEGADA PROGRAMADA</small><strong>' + escapeHtml(stationName(service.destination_id)) + '</strong><time>' + escapeHtml(shortTime(service.arrival)) + '</time></div></div>' +
      '<div class="live-box" id="live-info"></div>' +
      (focusStopId ? '<div class="focus-note">Búsqueda por estación: <strong>' + escapeHtml(stationName(focusStopId)) + '</strong></div>' : "") +
      '<details class="stops-details"><summary>Ver las ' + service.stops.length + ' estaciones del recorrido</summary><div class="stop-list">' + service.stops.map(function (stop, index) {
        const name = stationName(stop[0]);
        const times = stop[1] === stop[2] ? shortTime(stop[1]) : shortTime(stop[1]) + " / " + shortTime(stop[2]);
        return '<div class="stop-row ' + (String(stop[0]) === String(focusStopId) ? "focused" : "") + '"><span class="stop-index">' + (index + 1) + '</span><span class="stop-name">' + escapeHtml(name) + '</span><strong>' + escapeHtml(times) + '</strong></div>';
      }).join("") + "</div></details>" +
      '<hr class="section-divider"><div class="subsection-heading"><h3>Siguiente servicio posible</h3><span>' + (chain.length - 1) + " enlace" + (chain.length === 2 ? "" : "s") + " calculado" + (chain.length === 2 ? "" : "s") + "</span></div>" +
      nextControl +
      '<div class="chain-list">' + chain.map(function (item, index) {
        const manual = rotations[chain[index - 1] && chain[index - 1].trip_id] === item.trip_id;
        return '<div class="chain-item ' + (index === 0 ? "current" : "") + '"><span class="chain-index">' + String(index + 1).padStart(2, "0") + '</span><div class="chain-copy"><strong>' + escapeHtml(item.circulation) + ' <span class="line-chip ' + lineClass(item.line) + '">' + escapeHtml(item.line) + "</span>" + (index === 1 ? '<span class="chain-tag ' + (manual ? "confirmed" : "estimated") + '">' + (manual ? "CONFIRMADO" : "POSIBLE") + "</span>" : "") + '</strong><small>' + escapeHtml(stationName(item.origin_id)) + " → " + escapeHtml(stationName(item.destination_id)) + '</small></div><span class="chain-time">' + escapeHtml(shortTime(item.departure)) + " – " + escapeHtml(shortTime(item.arrival)) + "</span></div>";
      }).join("") + "</div>" +
      '<div class="rotation-footnote">La continuidad se propone por coincidencia de terminal, línea y tiempo mínimo de inversión. El GTFS no asigna la composición física a cada viaje. Confirma el enlace manualmente antes de considerarlo una rotación real; la confirmación se guarda en este navegador.</div>' +
      '<section class="simulator"><div class="simulator-head"><div><div class="simulator-label">02 · SIMULADOR</div><h3>Propagación del retraso</h3><p>Introduce la demora de llegada de la circulación ' + escapeHtml(service.circulation) + '.</p></div></div>' +
      '<div class="sim-controls"><div class="sim-field"><label for="delay-input">RETRASO DE LLEGADA (MIN)</label><input class="sim-input" id="delay-input" type="number" min="0" max="600" step="1" value="0"></div><div class="sim-field"><label for="turnaround-input">INVERSIÓN MÍNIMA (MIN)</label><input class="sim-input" id="turnaround-input" type="number" min="0" max="180" step="1" value="3"></div><div class="sim-field"><label for="recovery-input">RECUPERACIÓN EN MARCHA (MIN)</label><input class="sim-input" id="recovery-input" type="number" min="0" max="180" step="1" value="0"></div></div>' +
      '<div class="sim-output" id="simulation-output"></div><p class="sim-explanation" id="simulation-explanation"></p><div class="sim-warning">Cálculo teórico: no incorpora cruces, regulación, incidencias, cambios de unidad ni decisiones operativas de Renfe.</div></section>' +
      '<p class="muted-note source-note">Horario programado: GTFS estático de Renfe Cercanías, publicado en el NAP. Identificador GTFS: ' + escapeHtml(service.trip_id) + ".</p>";

    if ($("confirm-rotation")) $("confirm-rotation").addEventListener("click", function () {
      const select = $("next-service-select");
      const chosenId = select ? select.value : (next && next.service ? next.service.trip_id : "");
      if (!chosenId || !findServiceByTripId(chosenId)) return showToast("Selecciona una circulación válida.");
      rotations[service.trip_id] = chosenId;
      saveRotations();
      renderResult(service, focusStopId);
      showToast("Enlace guardado en este navegador.");
    });
    if ($("remove-rotation")) $("remove-rotation").addEventListener("click", function () {
      delete rotations[service.trip_id];
      saveRotations();
      renderResult(service, focusStopId);
      showToast("Se ha quitado la confirmación.");
    });
    ["delay-input", "turnaround-input", "recovery-input"].forEach(function (id) {
      $(id).addEventListener("input", renderSimulation);
    });
    renderLivePanel(service);
    renderSimulation();
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function getLiveInfo(service) {
    if (selectedDate !== madridToday()) return null;
    const vehicleEntity = liveVehicles.get(service.trip_id) || null;
    const updateEntity = liveUpdates.get(service.trip_id) || null;
    const vehicle = vehicleEntity && vehicleEntity.vehicle ? vehicleEntity.vehicle : null;
    const position = vehicle && vehicle.position ? vehicle.position : null;
    const assigned = vehicle && vehicle.vehicle ? vehicle.vehicle : null;
    const update = updateEntity && updateEntity.tripUpdate ? updateEntity.tripUpdate : null;
    let delaySeconds = null;
    let relationship = null;
    if (update) {
      relationship = update.trip && update.trip.scheduleRelationship ? update.trip.scheduleRelationship : null;
      if (Number.isFinite(Number(update.delay))) delaySeconds = Number(update.delay);
      const stopUpdates = Array.isArray(update.stopTimeUpdate) ? update.stopTimeUpdate : [];
      for (let index = stopUpdates.length - 1; index >= 0; index -= 1) {
        const stopUpdate = stopUpdates[index];
        const candidate = stopUpdate.arrival && stopUpdate.arrival.delay != null
          ? Number(stopUpdate.arrival.delay)
          : (stopUpdate.departure && stopUpdate.departure.delay != null ? Number(stopUpdate.departure.delay) : null);
        if (candidate != null && Number.isFinite(candidate)) {
          if (delaySeconds == null) delaySeconds = candidate;
          break;
        }
      }
    }
    return { vehicle: vehicle, position: position, assigned: assigned, delaySeconds: delaySeconds, relationship: relationship };
  }

  function renderLivePanel(service) {
    const node = $("live-info");
    if (!node) return;
    const live = getLiveInfo(service);
    if (!live) {
      node.innerHTML = '<div class="live-heading"><span class="live-dot muted"></span><strong>Tiempo real no aplicable</strong></div><p>La fecha seleccionada no es hoy. Selecciona la fecha actual para asociar las actualizaciones de Renfe.</p>';
      return;
    }
    const delay = live.delaySeconds;
    const delayText = delay == null ? "Sin demora publicada" : (delay > 0 ? "+" + Math.round(delay / 60) + " min" : (delay < 0 ? Math.round(delay / 60) + " min" : "En hora"));
    let statusText = live.relationship || "Sin actualización de viaje";
    let vehicleText = "Sin posición de vehículo asociada";
    if (live.vehicle) {
      const statusMap = { STOPPED_AT: "Detenido en estación", IN_TRANSIT_TO: "En circulación", INCOMING_AT: "Llegando a estación" };
      statusText = statusMap[live.vehicle.currentStatus] || statusText;
      const atStation = live.vehicle.stopId ? stationName(live.vehicle.stopId) : "";
      const platform = live.assigned && live.assigned.label ? live.assigned.label.match(/PLATF\.?\s*\(([^)]+)\)/i) : null;
      vehicleText = (live.assigned && (live.assigned.label || live.assigned.id) ? live.assigned.label || live.assigned.id : "Vehículo detectado") +
        (atStation ? " · " + atStation : "") + (platform ? " · Andén " + platform[1] : "");
    }
    if (live.relationship === "CANCELED") statusText = "SERVICIO CANCELADO";
    node.innerHTML =
      '<div class="live-heading"><span class="live-dot ' + (liveConnected ? "" : "muted") + '"></span><strong>Información en tiempo real de Renfe</strong><span class="live-delay ' + (delay != null && delay > 0 ? "delayed" : "") + '">' + escapeHtml(delayText) + "</span></div>" +
      '<p><strong>' + escapeHtml(statusText) + '</strong><br>' + escapeHtml(vehicleText) + '</p>' +
      (delay != null ? '<button class="text-button" id="use-live-delay" type="button">Usar retraso RT en el simulador ↗</button>' : '<small>Sin actualización RT para esta circulación en este momento.</small>');
    if ($("use-live-delay")) $("use-live-delay").addEventListener("click", function () {
      const input = $("delay-input");
      if (input) {
        input.value = Math.max(0, Math.round(delay / 60));
        renderSimulation();
        showToast("Retraso RT aplicado al simulador.");
      }
    });
  }

  function renderSimulation() {
    if (!activeService || !$("simulation-output")) return;
    const chain = getChain(activeService, 10);
    const delay = clampNumber($("delay-input").value, 0, 600);
    const turnaround = clampNumber($("turnaround-input").value, 0, 180);
    const recovery = clampNumber($("recovery-input").value, 0, 180);
    const rows = [];
    const firstArrival = parseMinutes(activeService.arrival);
    let previousScheduledArrival = firstArrival;
    let previousEstimatedArrival = firstArrival + delay;

    rows.push({
      service: activeService,
      depPlan: parseMinutes(activeService.departure),
      depEstimate: parseMinutes(activeService.departure),
      arrPlan: firstArrival,
      arrEstimate: previousEstimatedArrival,
      actual: true
    });

    for (let index = 1; index < chain.length; index += 1) {
      const service = chain[index];
      let depPlan = parseMinutes(service.departure);
      while (depPlan < previousScheduledArrival) depPlan += 1440;
      let arrPlan = parseMinutes(service.arrival);
      while (arrPlan < depPlan) arrPlan += 1440;
      const depEstimate = Math.max(depPlan, previousEstimatedArrival + turnaround);
      const inheritedDelay = Math.max(0, depEstimate - depPlan);
      const arrEstimate = arrPlan + Math.max(0, inheritedDelay - recovery);
      rows.push({ service: service, depPlan: depPlan, depEstimate: depEstimate, arrPlan: arrPlan, arrEstimate: arrEstimate, actual: false });
      previousScheduledArrival = arrPlan;
      previousEstimatedArrival = arrEstimate;
    }

    $("simulation-output").innerHTML =
      '<table class="sim-table"><thead><tr><th>CIRCULACIÓN</th><th>SALIDA<br>PROG. / EST.</th><th>LLEGADA<br>PROG. / EST.</th><th>RETRASO</th></tr></thead><tbody>' +
      rows.map(function (row, index) {
        const depCell = row.actual
          ? '<span class="time-pair"><span>' + clock(row.depPlan) + '</span><span class="planned">Llegada real introducida</span></span>'
          : '<span class="time-pair"><span class="planned">' + clock(row.depPlan) + '</span><span class="estimated">' + clock(row.depEstimate) + "</span></span>";
        const arrDelay = row.arrEstimate - row.arrPlan;
        const arrCell = '<span class="time-pair"><span class="planned">' + clock(row.arrPlan) + '</span><span class="estimated">' + clock(row.arrEstimate) + "</span></span>";
        return "<tr><td>" + escapeHtml(row.service.circulation) + (index === 0 ? '<br><span class="actual-tag">DEMORA INTRODUCIDA</span>' : "") + "</td><td>" + depCell + "</td><td>" + arrCell + '<td class="delay-cell ' + (arrDelay > 0 ? "delayed" : "") + '">' + escapeHtml(delayLabel(arrDelay)) + "</td></tr>";
      }).join("") + "</tbody></table>";

    if (chain.length === 1) {
      $("simulation-explanation").textContent = "No hay un siguiente servicio posible enlazado desde esta terminal con los criterios actuales.";
    } else {
      const next = rows[1];
      const last = rows[rows.length - 1];
      const firstDepDelay = Math.max(0, next.depEstimate - next.depPlan);
      const finalDelay = Math.max(0, last.arrEstimate - last.arrPlan);
      $("simulation-explanation").textContent = firstDepDelay === 0
        ? "El margen de inversión absorbe el retraso antes de la salida siguiente."
        : "La siguiente salida acumularía " + Math.round(firstDepDelay) + " min. Al final de los " + (rows.length - 1) + " servicios enlazados, la demora estimada sería de " + Math.round(finalDelay) + " min.";
    }
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }
  function delayLabel(value) {
    const rounded = Math.round(value);
    if (rounded <= 0) return "En hora";
    return "+" + rounded + " min";
  }
  function showNoMatch(title, description) {
    activeService = null;
    $("result-panel").classList.remove("hidden");
    $("empty-panel").classList.add("hidden");
    $("result-panel").innerHTML = '<div class="no-match"><strong>' + escapeHtml(title) + "</strong><p>" + escapeHtml(description) + "</p></div>";
  }
  function setLiveStatus(text, active) {
    const node = $("live-status");
    node.innerHTML = "<i></i> " + escapeHtml(text);
    node.classList.toggle("offline", !active);
  }
  function renderLiveHeader() {
    if (selectedDate !== madridToday()) setLiveStatus("RT SOLO PARA HOY", false);
    else setLiveStatus(liveConnected ? "RENFE RT CONECTADO" : "SIN CONEXIÓN RT", liveConnected);
  }
  function parseLiveMap(payload, key) {
    const map = new Map();
    const entities = payload && Array.isArray(payload.entity) ? payload.entity : [];
    entities.forEach(function (entity) {
      const wrapper = entity[key];
      const tripId = wrapper && wrapper.trip && wrapper.trip.tripId;
      if (tripId) map.set(String(tripId), entity);
    });
    return map;
  }
  async function refreshRealtime() {
    if (refreshBusy || selectedDate !== madridToday()) {
      renderLiveHeader();
      return;
    }
    refreshBusy = true;
    try {
      const feeds = await Promise.all([fetchJson(LIVE_URLS.vehicles), fetchJson(LIVE_URLS.updates)]);
      liveVehicles = parseLiveMap(feeds[0], "vehicle");
      liveUpdates = parseLiveMap(feeds[1], "tripUpdate");
      liveConnected = true;
      if (activeService) renderLivePanel(activeService);
    } catch (error) {
      liveConnected = false;
    } finally {
      refreshBusy = false;
      renderLiveHeader();
    }
  }
  function initEvents() {
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
    $("refresh-live").addEventListener("click", function () {
      refreshRealtime().then(function () { showToast(liveConnected ? "Datos GTFS-RT actualizados." : "No se pudo conectar con el feed de Renfe."); });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initEvents();
    initialize();
  });
})();