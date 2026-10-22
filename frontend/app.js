const API_BASE_URL = (window.SURF_CHECK_API_BASE ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8777"
    : "")).replace(/\/+$/, "");

function apiUrl(path) {
  if (!API_BASE_URL) {
    throw new Error("Не задан URL backend. Настройте SURF_CHECK_API_URL в GitHub Actions.");
  }
  return `${API_BASE_URL}${path}`;
}

function display(v) {
  if (v === null || v === undefined || v === "") return "—";
  return v;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kaliningrad",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ts * 1000));
}

function fmtFull(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kaliningrad",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ts * 1000));
}

function scoreClass(score) {
  if (score >= 75) return "good";
  if (score >= 45) return "ok";
  return "bad";
}

function barClass(score) {
  if (score >= 65) return "good";
  if (score >= 40) return "ok";
  return "bad";
}

function waveCompass(degrees, direction) {
  if (degrees === null || degrees === undefined || degrees === "") {
    return `
      <div class="wave-panel">
        <div class="wave-reading">
          <div class="wave-label">Направление волны</div>
          <div class="wave-value">Нет данных</div>
        </div>
      </div>
    `;
  }

  const bearing = Number(degrees);
  if (!Number.isFinite(bearing)) {
    return `
      <div class="wave-panel">
        <div class="wave-reading">
          <div class="wave-label">Направление волны</div>
          <div class="wave-value">Нет данных</div>
        </div>
      </div>
    `;
  }

  const label = `${Math.round(bearing)}°${direction ? " · " + direction : ""}`;
  return `
    <div class="wave-panel">
      <svg class="wave-compass" viewBox="0 0 88 88" role="img"
        aria-label="Направление волны по модели: ${esc(label)}"
        title="Угол по данным модели: от севера по часовой стрелке">
        <circle cx="44" cy="44" r="39" fill="var(--card)" stroke="var(--line)" stroke-width="1.5"/>
        <circle cx="44" cy="44" r="27" fill="none" stroke="var(--line)" stroke-width="1"/>
        <text x="44" y="14" text-anchor="middle" fill="var(--muted)" font-size="8" font-weight="700">С</text>
        <text x="74" y="47" text-anchor="middle" fill="var(--muted)" font-size="8" font-weight="700">В</text>
        <text x="44" y="81" text-anchor="middle" fill="var(--muted)" font-size="8" font-weight="700">Ю</text>
        <text x="14" y="47" text-anchor="middle" fill="var(--muted)" font-size="8" font-weight="700">З</text>
        <g transform="rotate(${bearing} 44 44)">
          <path d="M44 62 L44 26" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
          <path d="M44 20 L35 34 L44 30 L53 34 Z" fill="var(--accent)"/>
        </g>
        <circle cx="44" cy="44" r="4" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/>
      </svg>
      <div class="wave-reading">
        <div class="wave-label">Направление волны · угол модели</div>
        <div class="wave-value">${esc(label)}</div>
        <div class="wave-sub">Стрелка показывает угол в градусах от севера</div>
      </div>
    </div>
  `;
}

let requestInFlight = false;
let editorMap = null;
let editorSpots = [];
let editorMarkers = new Map();
let selectedSpotId = null;
let placingSpot = false;
let editorDirty = false;

function setEditorMessage(message) {
  const el = document.getElementById("editor-message");
  el.textContent = message || "";
  el.hidden = !message;
}

function selectedEditorSpot() {
  return editorSpots.find(spot => spot.id === selectedSpotId);
}

function setEditorDirty() {
  editorDirty = true;
  document.getElementById("save-spots").textContent = "Сохранить изменения";
}

function editorMarkerIcon(selected) {
  return L.divIcon({
    className: selected ? "spot-marker-icon selected" : "spot-marker-icon",
    html: "<span></span>",
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

function selectEditorSpot(spotId) {
  selectedSpotId = spotId;
  placingSpot = false;
  const spot = selectedEditorSpot();
  if (!spot) return;

  for (const [id, marker] of editorMarkers) {
    marker.setIcon(editorMarkerIcon(id === spotId));
  }

  document.getElementById("spot-name").value = spot.name;
  document.getElementById("spot-name").placeholder = "Например, Зеленоградск";
  document.getElementById("spot-lat").value = Number(spot.lat).toFixed(6);
  document.getElementById("spot-lon").value = Number(spot.lon).toFixed(6);
  document.getElementById("editor-instruction").textContent =
    "Можно переименовать точку, перетащить маркер или задать координаты вручную.";
  setEditorMessage("");
}

function addEditorMarker(spot) {
  const marker = L.marker([spot.lat, spot.lon], {
    draggable: true,
    icon: editorMarkerIcon(spot.id === selectedSpotId),
    keyboard: true,
    title: spot.name
  }).addTo(editorMap);

  marker.on("click", () => selectEditorSpot(spot.id));
  marker.on("dragstart", () => selectEditorSpot(spot.id));
  marker.on("drag", event => {
    const {lat, lng} = event.target.getLatLng();
    spot.lat = lat;
    spot.lon = lng;
    if (selectedSpotId === spot.id) {
      document.getElementById("spot-lat").value = lat.toFixed(6);
      document.getElementById("spot-lon").value = lng.toFixed(6);
    }
    setEditorDirty();
  });
  marker.on("dragend", () => {
    const name = spot.name;
    marker.options.title = name;
    setEditorDirty();
  });

  editorMarkers.set(spot.id, marker);
}

function renderEditorMarkers() {
  for (const marker of editorMarkers.values()) {
    marker.remove();
  }
  editorMarkers.clear();

  for (const spot of editorSpots) {
    addEditorMarker(spot);
  }
}

function ensureEditorMap() {
  if (!window.L) {
    throw new Error("Не загрузилась библиотека карты. Проверьте подключение к интернету и откройте редактор снова.");
  }
  if (editorMap) return;

  editorMap = L.map("spot-map").setView([54.92, 20.25], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(editorMap);

  editorMap.on("click", event => {
    if (!placingSpot) return;

    const {lat, lng} = event.latlng;
    const profile = editorSpots.reduce((closest, spot) => {
      if (!closest) return spot;
      const distance = (item) =>
        Math.hypot((item.lat - lat) * Math.cos(lat * Math.PI / 180), item.lon - lng);
      return distance(spot) < distance(closest) ? spot : closest;
    }, null);

    const spot = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: "Новая точка",
      note: "Пользовательская точка прогноза",
      lat,
      lon: lng,
      bestFrom: [...(profile?.bestFrom || [270, 310, 350])],
      offshore: [...(profile?.offshore || [90, 135, 180])]
    };
    editorSpots.push(spot);
    selectedSpotId = spot.id;
    addEditorMarker(spot);
    selectEditorSpot(spot.id);
    document.getElementById("spot-name").focus();
    document.getElementById("spot-name").select();
    document.getElementById("editor-instruction").textContent =
      "Новая точка добавлена. Задайте название и сохраните изменения.";
    setEditorDirty();
  });
}

async function openSpotEditor() {
  const dialog = document.getElementById("spot-editor");
  const button = document.getElementById("manage-spots");
  button.disabled = true;
  setEditorMessage("");
  document.getElementById("editor-instruction").textContent = "Загружаю сохранённые точки…";

  try {
    const response = await fetch(apiUrl("/api/spots"), {cache: "no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    editorSpots = payload.spots;
    editorDirty = false;
    selectedSpotId = null;
    placingSpot = false;
    ensureEditorMap();
    renderEditorMarkers();
    document.getElementById("spot-name").value = "";
    document.getElementById("spot-name").placeholder = "Например, Зеленоградск";
    document.getElementById("spot-lat").value = "";
    document.getElementById("spot-lon").value = "";
    document.getElementById("editor-instruction").textContent =
      "Выберите маркер, чтобы изменить название или координаты, либо добавьте новую карточку.";
    dialog.showModal();
    setTimeout(() => {
      editorMap.invalidateSize();
      if (editorMarkers.size) {
        const bounds = L.featureGroup([...editorMarkers.values()]).getBounds();
        if (bounds.isValid()) editorMap.fitBounds(bounds.pad(0.18), {maxZoom: 10});
      }
    }, 0);
  } catch (error) {
    setEditorMessage("Не удалось открыть редактор: " + error.message);
    dialog.showModal();
  } finally {
    button.disabled = false;
  }
}

function closeSpotEditor() {
  const dialog = document.getElementById("spot-editor");
  if (editorDirty && !confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
  editorDirty = false;
  dialog.close();
}

function startAddingSpot() {
  if (editorSpots.length >= 40) {
    setEditorMessage("Достигнут лимит в 40 точек.");
    return;
  }
  placingSpot = true;
  selectedSpotId = null;
  for (const marker of editorMarkers.values()) {
    marker.setIcon(editorMarkerIcon(false));
  }
  document.getElementById("spot-name").value = "";
  document.getElementById("spot-lat").value = "";
  document.getElementById("spot-lon").value = "";
  document.getElementById("spot-name").placeholder = "Название новой карточки";
  document.getElementById("editor-instruction").textContent =
    "Нажмите на карту в месте новой точки. Для сохранения потребуется название.";
  setEditorMessage("");
}

function updateSelectedCoordinates() {
  const spot = selectedEditorSpot();
  if (!spot) return;

  const lat = Number(document.getElementById("spot-lat").value);
  const lon = Number(document.getElementById("spot-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return;
  }

  spot.lat = lat;
  spot.lon = lon;
  editorMarkers.get(spot.id)?.setLatLng([lat, lon]);
  setEditorDirty();
}

async function saveEditedSpots() {
  const selected = selectedEditorSpot();
  if (selected) {
    const lat = document.getElementById("spot-lat").valueAsNumber;
    const lon = document.getElementById("spot-lon").valueAsNumber;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setEditorMessage("Проверьте координаты: широта от -90 до 90, долгота от -180 до 180.");
      return;
    }
    selected.name = document.getElementById("spot-name").value.trim();
    selected.lat = lat;
    selected.lon = lon;
  }
  if (editorSpots.some(spot => !spot.name.trim())) {
    setEditorMessage("У каждой карточки должно быть название.");
    return;
  }

  const token = sessionStorage.getItem("surfCheckWriteToken") ||
    prompt("Введите токен доступа для изменения точек:");
  if (!token) return;

  const button = document.getElementById("save-spots");
  button.disabled = true;
  setEditorMessage("");

  try {
    const response = await fetch(apiUrl("/api/spots"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({spots: editorSpots})
    });
    const payload = await response.json();
    if (response.status === 401) sessionStorage.removeItem("surfCheckWriteToken");
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    sessionStorage.setItem("surfCheckWriteToken", token);

    editorSpots = payload.spots;
    editorDirty = false;
    document.getElementById("spot-editor").close();
    const status = document.getElementById("status");
    status.innerHTML = '<span class="spinner"></span>Сохранил точки, обновляю прогноз…';
    load(false);
  } catch (error) {
    setEditorMessage("Не удалось сохранить изменения: " + error.message);
  } finally {
    button.disabled = false;
  }
}

document.getElementById("spot-name").addEventListener("input", event => {
  const spot = selectedEditorSpot();
  if (!spot) return;
  spot.name = event.target.value;
  const marker = editorMarkers.get(spot.id);
  if (marker) marker.options.title = spot.name;
  setEditorDirty();
});
document.getElementById("spot-lat").addEventListener("input", updateSelectedCoordinates);
document.getElementById("spot-lon").addEventListener("input", updateSelectedCoordinates);
document.getElementById("spot-editor").addEventListener("click", event => {
  if (event.target === event.currentTarget) closeSpotEditor();
});

function metric(label, value) {
  return `
    <div class="metric">
      <div class="label">${esc(label)}</div>
      <div class="value">${esc(display(value))}</div>
    </div>
  `;
}

function renderSummary(data) {
  const el = document.getElementById("summary");

  if (!data || !data.summary) {
    el.style.display = "none";
    return;
  }

  const bn = data.summary.best_now;
  const bx = data.summary.best_next;

  el.style.display = "block";

  el.innerHTML = `
    <div class="hero-grid">
      <div class="hero-item">
        <div class="hero-label">Лучший спот сейчас</div>
        <div class="hero-value">${bn ? esc(bn.spot) : "—"}</div>
        <div class="hero-detail">${bn
          ? esc(bn.verdict) + " · " + bn.score + "/100 · волна " + display(bn.wave) + " м · ветер " + display(bn.wind) + " м/с"
          : "Пока нет доступных данных"}</div>
      </div>

      <div class="hero-item">
        <div class="hero-label">Лучшее окно на 48 часов</div>
        <div class="hero-value">${bx ? esc(bx.spot) : "—"}</div>
        <div class="hero-detail">${bx
          ? fmtFull(bx.ts) + " · " + esc(bx.verdict) + " · " + bx.score + "/100"
          : "Подходящего прогноза пока нет"}</div>
      </div>
    </div>
  `;
}

function renderCard(s) {
  if (s.error) {
    return `
      <div class="card">
        <div class="card-top">
          <div>
            <h2>${esc(s.name)}</h2>
            <div class="note">${esc(s.note || "")}</div>
            <a class="map-link" href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=13/${s.lat}/${s.lon}" target="_blank" rel="noopener noreferrer">Точка прогноза на карте ↗</a>
          </div>
          <div class="score bad">!</div>
        </div>
        <div class="verdict">Ошибка</div>
        <div class="reasons">
          <div class="reason">${esc(s.error)}</div>
        </div>
      </div>
    `;
  }

  const n = s.now || {};
  const b = s.best || {};
  const score = Number(n.score || 0);

  const forecastHours = (s.hours || []).slice(0, 48);
  const bars = forecastHours.map(h => {
    const hs = Number(h.score || 0);
    const title = fmtFull(h.ts)
      + " · " + h.verdict
      + " · " + hs + "/100"
      + " · волна " + display(h.wave) + " м"
      + " · ветер " + display(h.wind) + " м/с";

    return `<div class="bar ${barClass(hs)}" style="height:${Math.max(8, hs)}%" title="${esc(title)}"></div>`;
  }).join("");

  const reasons = (n.reasons || []).map(r => `<div class="reason">${esc(r)}</div>`).join("")
    || `<div class="reason">Нет деталей.</div>`;

  return `
    <div class="card">
      <div class="card-top">
        <div>
          <h2>${esc(s.name)}</h2>
          <div class="note">${esc(s.note || "")}</div>
          <a class="map-link" href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=13/${s.lat}/${s.lon}" target="_blank" rel="noopener noreferrer">Точка прогноза на карте ↗</a>
        </div>
        <div class="score ${scoreClass(score)}">${score}</div>
      </div>

      <div class="verdict">${esc(n.verdict || "—")}</div>
      ${waveCompass(n.waveDirDeg, n.waveDir)}

      <div class="metrics">
        ${metric("Волна", n.wave == null ? null : n.wave + " м")}
        ${metric("Период", n.period == null ? null : n.period + " с")}
        ${metric("Ветер", n.wind == null ? null : n.wind + " м/с " + (n.windDir || ""))}
        ${metric("Порывы", n.gust == null ? null : n.gust + " м/с")}
        ${metric("Вода", n.sst == null ? null : n.sst + "°C")}
        ${metric("Уровень", n.level)}
        ${metric("Гидрокостюм", n.gear)}
      </div>

      <div class="reasons">
        ${reasons}
      </div>

      <div class="best">
        <strong>Лучшее окно:</strong>
        ${b.ts ? fmtFull(b.ts) + " · " + esc(b.verdict) + " · " + b.score + "/100" : "—"}
      </div>

      <div class="chart">
        ${bars}
      </div>
      <div class="chart-labels"><span>${forecastHours.length ? fmtTime(forecastHours[0].ts) : "—"}</span><span>+48 ч</span></div>
    </div>
  `;
}

async function load(force = false) {
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  const refreshBtn = document.getElementById("refresh");

  if (requestInFlight) return;
  requestInFlight = true;
  refreshBtn.disabled = true;

  try {
    if (!document.getElementById("cards").children.length) {
      status.innerHTML = '<span class="spinner"></span>Получаю данные…';
    }

    const res = await fetch(force ? apiUrl("/api/refresh") : apiUrl("/api/state"), {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error(`Backend ответил HTTP ${res.status}`);
    }

    const state = await res.json();

    refreshBtn.textContent = state.loading ? "Обновление…" : "Обновить";
    refreshBtn.disabled = Boolean(state.loading);

    if (state.error) {
      error.textContent = "Ошибка: " + state.error;
      error.style.display = "block";
    } else {
      error.style.display = "none";
    }

    if (state.loading && !state.data) {
      status.innerHTML = '<span class="spinner"></span>Запрашиваю прогноз…';
      setTimeout(() => load(false), 2000);
      return;
    }

    if (state.data) {
      renderSummary(state.data);

      const cards = document.getElementById("cards");
      const spots = state.data.spots || [];

      if (!spots.length) {
        cards.innerHTML = '<div class="empty">Нет данных.</div>';
      } else {
        cards.innerHTML = spots.map(renderCard).join("");
      }

      document.getElementById("footer").textContent =
        "Источник: " + (state.data.source || "Open-Meteo") +
        ". Обновлено: " + (state.updated ? fmtFull(state.updated) : "—") +
        ". " + (state.data.disclaimer || "");

      if (state.loading) {
        status.innerHTML = '<span class="spinner"></span>Обновляю данные…';
        refreshBtn.disabled = false;
        setTimeout(() => load(false), 2000);
      } else {
        status.textContent = "Обновлено: " + (state.updated ? fmtFull(state.updated) : "—");
      }
    } else {
      status.textContent = "Данных пока нет.";
      setTimeout(() => load(false), 2000);
    }
  } catch (e) {
    error.textContent = "Не удалось получить состояние сервиса: " + e;
    error.style.display = "block";
    status.textContent = "Ошибка backend-сервиса.";
  } finally {
    requestInFlight = false;
    if (!document.getElementById("refresh").textContent.includes("Обновление")) {
      refreshBtn.disabled = false;
    }
  }
}

load(false);
setInterval(() => load(false), 300000);
