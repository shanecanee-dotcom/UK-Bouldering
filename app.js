import { AREAS } from "./data/areas.js";
import { loadWeather, nowIndex, assess, outlook, bestDay } from "./conditions.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Map ----------
const map = L.map("map", { zoomControl: true }).setView([54.3, -2.5], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const cragIcon = (active = false) =>
  L.divIcon({ className: "", html: `<div class="pin${active ? " active" : ""}"></div>`, iconSize: [26, 26], iconAnchor: [13, 26] });
const parkingIcon = L.divIcon({ className: "", html: '<div class="p-pin">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });

const markers = new Map();
const parkingLayer = L.layerGroup().addTo(map);

for (const area of AREAS) {
  const m = L.marker([area.lat, area.lng], { icon: cragIcon(), title: area.name })
    .addTo(map)
    .bindTooltip(area.name)
    .on("click", () => showDetail(area.id));
  markers.set(area.id, m);
}

// ---------- Photos (Wikimedia Commons geosearch) ----------
const photoCache = new Map();

async function getPhotos(area) {
  if (area.photos?.length) return area.photos;
  if (photoCache.has(area.id)) return photoCache.get(area.id);

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${area.lat}|${area.lng}`,
    ggsradius: "800",
    ggslimit: "12",
    ggsnamespace: "6",
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: "640",
  });

  const promise = fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
    .then((r) => r.json())
    .then((data) =>
      Object.values(data.query?.pages ?? {})
        .map((p) => p.imageinfo?.[0] && { ...p.imageinfo[0], title: p.title })
        .filter((i) => i && /image\/(jpeg|png|webp)/.test(i.mime))
        .map((i) => ({
          url: i.thumburl || i.url,
          page: i.descriptionurl,
          credit: [stripTags(i.extmetadata?.Artist?.value), i.extmetadata?.LicenseShortName?.value]
            .filter(Boolean)
            .join(" · "),
        }))
    )
    .catch(() => []);

  photoCache.set(area.id, promise);
  return promise;
}

function stripTags(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent.trim();
}

// ---------- List view ----------
const regions = [...new Set(AREAS.map((a) => a.region))].sort();
$("#region").insertAdjacentHTML("beforeend", regions.map((r) => `<option>${esc(r)}</option>`).join(""));

// ---------- Weather ----------
let weather = null; // Map(areaId → Open-Meteo response)
const weatherReady = loadWeather(AREAS)
  .then((m) => (weather = m))
  .catch(() => null)
  .then((m) => {
    renderList();
    if (activeId) renderConditions(AREAS.find((a) => a.id === activeId));
    return m;
  });

const condNow = (a) => {
  const w = weather?.get(a.id);
  return w ? assess(a, w, nowIndex(w)) : null;
};
const LEVEL_RANK = { dry: 0, damp: 1, wet: 2 };

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const region = $("#region").value;
  const shown = AREAS.filter(
    (a) =>
      (!region || a.region === region) &&
      (!q || [a.name, a.region, a.rock, a.description].join(" ").toLowerCase().includes(q))
  );
  if ($("#list-sort").value === "driest" && weather) {
    shown.sort((a, b) => {
      const ca = condNow(a), cb = condNow(b);
      return LEVEL_RANK[ca.level] - LEVEL_RANK[cb.level] || ca.score - cb.score;
    });
  } else {
    shown.sort((a, b) => a.name.localeCompare(b.name));
  }

  $("#count").textContent = `${shown.length} area${shown.length === 1 ? "" : "s"}`;
  $("#area-list").innerHTML = shown
    .map(
      (a) => `
      <li>
        <button class="card" data-id="${a.id}" type="button">
          <div class="thumb" data-thumb="${a.id}"></div>
          <div>
            <h3>${esc(a.name)}</h3>
            <p class="meta">${esc(a.region)} · ${esc(a.rock)}</p>
            <div class="tags">
              <span class="tag">${esc(a.grades)}</span>
              <span class="tag parking">P ${a.parking.length} parking</span>
              ${a.problems?.length ? `<span class="tag">${a.problems.length} problems</span>` : ""}
              ${(() => { const c = condNow(a); return c ? `<span class="tag cond cond-${c.level}">${esc(c.label)}</span>` : ""; })()}
            </div>
          </div>
        </button>
      </li>`
    )
    .join("");

  for (const a of AREAS) markers.get(a.id).setOpacity(shown.includes(a) ? 1 : 0.25);

  // Lazy-load card thumbnails
  for (const a of shown) {
    getPhotos(a).then((photos) => {
      const el = document.querySelector(`[data-thumb="${a.id}"]`);
      if (el && photos[0]) el.style.backgroundImage = `url("${photos[0].url}")`;
    });
  }
}

$("#search").addEventListener("input", renderList);
$("#region").addEventListener("change", renderList);
$("#list-sort").addEventListener("change", renderList);
$("#area-list").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) showDetail(card.dataset.id);
});

// ---------- Problems ----------
// Font grade → sortable number: "f6B+" → 6.25, "f5+" → 5.5
function gradeValue(grade) {
  const m = /^f?(\d)([ABC])?(\+)?$/i.exec(grade.trim());
  if (!m) return 99;
  const [, n, letter, plus] = m;
  if (!letter) return +n + (plus ? 0.5 : 0);
  return +n + ("ABC".indexOf(letter.toUpperCase()) * 2 + (plus ? 1 : 0)) / 8;
}

const BANDS = [
  { id: "all", label: "All", test: () => true },
  { id: "3-5", label: "f3–f5+", test: (v) => v < 6 },
  { id: "6", label: "f6", test: (v) => v >= 6 && v < 7 },
  { id: "7", label: "f7", test: (v) => v >= 7 && v < 8 },
  { id: "8", label: "f8+", test: (v) => v >= 8 },
];

const TICKS_KEY = "ukboulders.ticks";
function loadTicks() {
  try { return new Set(JSON.parse(localStorage.getItem(TICKS_KEY)) || []); } catch { return new Set(); }
}
function saveTicks(ticks) {
  try { localStorage.setItem(TICKS_KEY, JSON.stringify([...ticks])); } catch {}
}
// Names repeat within a crag (e.g. several "Arete"s at Hound Tor), so include boulder + grade
const tickId = (area, p) => [area.id, p.boulder || "", p.name, p.grade].join("/");
const starsHtml = (n = 0) => (n ? `<span class="stars" aria-label="${n} star${n > 1 ? "s" : ""}">${"★".repeat(n)}</span>` : "");

function problemsSection(area) {
  if (!area.problems?.length)
    return `<h3>Problems</h3><p class="gallery-note">No problem list for this area yet.</p>`;
  const hasBoulders = area.problems.some((p) => p.boulder);
  return `
    <h3>Problems <span class="count-inline">(${area.problems.length})</span></h3>
    <div class="problem-controls">
      <div class="chips" role="group" aria-label="Filter by grade">
        ${BANDS.map((b) => `<button type="button" class="chip${b.id === "all" ? " on" : ""}" data-band="${b.id}">${b.label}</button>`).join("")}
      </div>
      <select id="problem-sort" aria-label="Sort problems">
        <option value="grade">Sort: grade</option>
        ${hasBoulders ? `<option value="boulder">Sort: boulder</option>` : ""}
        ${area.problems.some((p) => p.stars) ? `<option value="stars">Sort: stars</option>` : ""}
        <option value="name">Sort: name</option>
      </select>
    </div>
    <p id="tick-count" class="gallery-note"></p>
    <ul id="problem-list" class="problem-list"></ul>
    <p class="gallery-note">A selection of problems, not a full guide. Grades are a consensus and can change.</p>`;
}

function wireProblems(area) {
  let band = "all";
  const ticks = loadTicks();

  const render = () => {
    const sort = $("#problem-sort").value;
    const test = BANDS.find((b) => b.id === band).test;
    const list = area.problems
      .filter((p) => test(gradeValue(p.grade)))
      .sort((a, b) =>
        sort === "name" ? a.name.localeCompare(b.name)
        : sort === "boulder"
          ? !a.boulder - !b.boulder || (a.boulder || "").localeCompare(b.boulder || "") || gradeValue(a.grade) - gradeValue(b.grade)
        : sort === "stars" ? (b.stars || 0) - (a.stars || 0) || gradeValue(a.grade) - gradeValue(b.grade)
        : gradeValue(a.grade) - gradeValue(b.grade) || a.name.localeCompare(b.name)
      );

    let lastBoulder = null;
    $("#problem-list").innerHTML = list.length
      ? list
          .map((p) => {
            const id = tickId(area, p);
            const heading =
              sort === "boulder" && p.boulder !== lastBoulder
                ? `<li class="boulder-heading">${esc(p.boulder || "Other")}</li>`
                : "";
            lastBoulder = p.boulder;
            return heading + `
          <li class="problem${ticks.has(id) ? " ticked" : ""}${openId === id ? " open" : ""}" data-pid="${esc(id)}">
            <div class="problem-row">
              <input type="checkbox" data-tick="${esc(id)}" ${ticks.has(id) ? "checked" : ""} aria-label="Ticked ${esc(p.name)}" />
              <button type="button" class="problem-toggle" aria-expanded="${openId === id}">
                <span class="grade">${esc(p.grade)}</span>
                <span class="pname">${esc(p.name)} ${starsHtml(p.stars)}
                  ${sort !== "boulder" && p.boulder ? `<small>${esc(p.boulder)}</small>` : ""}
                </span>
                <span class="chev" aria-hidden="true">›</span>
              </button>
            </div>
            <div class="problem-detail"></div>
          </li>`;
          })
          .join("")
      : `<li class="gallery-note">No problems in this grade band yet.</li>`;

    const done = area.problems.filter((p) => ticks.has(tickId(area, p))).length;
    $("#tick-count").textContent = `${done} of ${area.problems.length} ticked`;

    const openLi = openId && document.querySelector(`.problem[data-pid="${CSS.escape(openId)}"]`);
    if (openLi) fillProblemDetail(openLi, area, byId.get(openId));
  };

  const byId = new Map(area.problems.map((p) => [tickId(area, p), p]));
  let openId = null;

  $("#problem-list").addEventListener("click", (e) => {
    const toggle = e.target.closest(".problem-toggle");
    if (!toggle) return;
    const id = toggle.closest(".problem").dataset.pid;
    openId = openId === id ? null : id;
    render();
  });

  $("#detail").querySelectorAll("[data-band]").forEach((chip) =>
    chip.addEventListener("click", () => {
      band = chip.dataset.band;
      $("#detail").querySelectorAll("[data-band]").forEach((c) => c.classList.toggle("on", c === chip));
      render();
    })
  );
  $("#problem-sort").addEventListener("change", render);
  $("#problem-list").addEventListener("change", (e) => {
    const id = e.target.dataset.tick;
    if (!id) return;
    e.target.checked ? ticks.add(id) : ticks.delete(id);
    saveTicks(ticks);
    render();
  });

  render();
}

// ---------- Problem detail: location, photo, notes, beta ----------

// Personal photos live in IndexedDB (they're too big for localStorage); notes in localStorage.
const photoDb = (() => {
  let dbp;
  const open = () =>
    (dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("ukboulders", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("photos");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const r = fn(db.transaction("photos", mode).objectStore("photos"));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null),
    put: (k, blob) => tx("readwrite", (s) => s.put(blob, k)),
    del: (k) => tx("readwrite", (s) => s.delete(k)).catch(() => {}),
  };
})();

const NOTES_KEY = "ukboulders.notes";
function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; } catch { return {}; }
}
function saveNote(id, text) {
  const notes = loadNotes();
  if (text.trim()) notes[id] = text; else delete notes[id];
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch {}
}

// Shrink phone photos to ~1400px JPEG before storing
async function shrinkImage(file, max = 1400) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
}

const walkingUrl = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

let objectUrl = null;

async function fillProblemDetail(li, area, p) {
  const id = tickId(area, p);
  const spot = p.boulder && area.boulders?.[p.boulder];
  const q = encodeURIComponent(`${p.name} ${area.name} boulder ${p.grade.replace(/^f/, "")}`);
  const note = loadNotes()[id] || "";

  li.querySelector(".problem-detail").innerHTML = `
    <div class="pd-section">
      <h5>Location</h5>
      ${spot
        ? `<p>${esc(p.boulder)}</p>
           <div class="parking-actions">
             <button type="button" data-act="map">Show on map</button>
             <a href="${walkingUrl(spot.lat, spot.lng)}" target="_blank" rel="noopener">Walking directions</a>
           </div>`
        : `<p class="muted">${p.boulder ? `${esc(p.boulder)} – exact` : "Exact"} boulder position isn't mapped yet, so this points to the crag.</p>
           <div class="parking-actions">
             <button type="button" data-act="map">Show crag on map</button>
             <a href="${walkingUrl(area.lat, area.lng)}" target="_blank" rel="noopener">Walking directions</a>
           </div>`}
    </div>

    <div class="pd-section">
      <h5>Photo</h5>
      <div class="pd-photo"></div>
      <label class="file-btn">
        <input type="file" accept="image/*" capture="environment" data-act="photo" hidden />
        <span>Add your photo</span>
      </label>
      <button type="button" class="link-btn" data-act="rmphoto" hidden>Remove photo</button>
    </div>

    <div class="pd-section">
      <h5>What it's like</h5>
      ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      <textarea data-act="note" rows="3" placeholder="Your notes: style, beta, conditions, landing…">${esc(note)}</textarea>
      <div class="parking-actions">
        <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Watch beta videos</a>
        <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Search the web</a>
      </div>
    </div>`;

  const panel = li.querySelector(".problem-detail");

  // Photo: data file photo first, then the user's own
  const showPhoto = async () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl), (objectUrl = null);
    const box = panel.querySelector(".pd-photo");
    const mine = await photoDb.get(id);
    panel.querySelector('[data-act="rmphoto"]').hidden = !mine;
    panel.querySelector(".file-btn span").textContent = mine ? "Replace your photo" : "Add your photo";
    if (mine) {
      objectUrl = URL.createObjectURL(mine);
      box.innerHTML = `<img src="${objectUrl}" alt="Your photo of ${esc(p.name)}" /><p class="muted">Your photo (saved on this device only)</p>`;
    } else if (p.photo) {
      box.innerHTML = `<img src="${esc(p.photo.url)}" alt="${esc(p.name)}" loading="lazy" />${p.photo.credit ? `<p class="muted">${esc(p.photo.credit)}</p>` : ""}`;
    } else {
      box.innerHTML = `<p class="muted">No photo yet. Add one next time you're there.</p>`;
    }
  };
  showPhoto();

  panel.querySelector('[data-act="map"]').addEventListener("click", () => {
    if (spot) focusBoulder(p.boulder);
    else map.flyTo([area.lat, area.lng], 16);
    if (matchMedia("(max-width: 760px)").matches) document.getElementById("map").scrollIntoView({ behavior: "smooth" });
  });
  panel.querySelector('[data-act="photo"]').addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await photoDb.put(id, await shrinkImage(file));
    } catch {
      alert("Couldn't save the photo on this device.");
    }
    showPhoto();
  });
  panel.querySelector('[data-act="rmphoto"]').addEventListener("click", async () => {
    await photoDb.del(id);
    showPhoto();
  });
  let t;
  panel.querySelector('[data-act="note"]').addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => saveNote(id, e.target.value), 300);
  });
}

// ---------- Boulder markers ----------
const boulderLayer = L.layerGroup().addTo(map);
const boulderMarkers = new Map();

function showBoulders(area) {
  boulderLayer.clearLayers();
  boulderMarkers.clear();
  for (const [name, b] of Object.entries(area.boulders || {})) {
    const count = (area.problems || []).filter((p) => p.boulder === name).length;
    const m = L.circleMarker([b.lat, b.lng], {
      radius: 7, weight: 2, color: "#fff", fillColor: "#d1582c", fillOpacity: 0.9,
    })
      .bindTooltip(name)
      .bindPopup(`<strong>${esc(name)}</strong><br>${count} problem${count === 1 ? "" : "s"} listed<br><a href="${walkingUrl(b.lat, b.lng)}" target="_blank" rel="noopener">Walking directions</a>`)
      .addTo(boulderLayer);
    boulderMarkers.set(name, m);
  }
}

function focusBoulder(name) {
  const m = boulderMarkers.get(name);
  if (!m) return;
  map.flyTo(m.getLatLng(), 17);
  map.once("moveend", () => m.openPopup());
}

// ---------- Conditions panel ----------
const dayName = (d) => new Date(`${d.date}T12:00`).toLocaleDateString("en-GB", { weekday: "short" });

function renderConditions(area) {
  const box = document.getElementById("conditions");
  if (!box) return;
  const w = weather?.get(area.id);
  if (!w) {
    box.innerHTML = `<p class="gallery-note">Couldn't load the weather right now. Try again later.</p>`;
    return;
  }
  const now = assess(area, w, nowIndex(w));
  const days = outlook(area, w);
  const best = bestDay(days);

  box.innerHTML = `
    <div class="cond-now cond-${now.level}">
      <strong>${esc(now.label)}</strong>
      <span>${now.friction}</span>
    </div>
    <p class="cond-stats">
      Rain last 48h: <strong>${now.rain48.toFixed(1)} mm</strong> ·
      ${Math.round(now.temp)}°C · ${now.hum}% humidity · wind ${Math.round(now.wind)} km/h
    </p>
    ${now.fragile ? `<p class="cond-warn">Sandstone is weak when wet: holds snap and wear away. Give it at least a full dry day after rain.</p>` : ""}
    ${best ? `<p class="cond-best">Best day this week: <strong>${best.isToday ? "Today" : dayName(best)}</strong> (${esc(best.label.toLowerCase())}, ${Math.round(best.tempMax)}°C)</p>` : ""}
    <div class="outlook" role="list">
      ${days
        .map(
          (d) => `
        <div class="day cond-${d.level}${d === best ? " best" : ""}" role="listitem"
             title="${esc(d.label)} · ${d.friction} · sunrise ${d.sunrise}, sunset ${d.sunset}">
          <span class="d-name">${d.isToday ? "Today" : dayName(d)}</span>
          <span class="d-dot" aria-hidden="true"></span>
          <span class="d-label">${esc(d.level === "dry" ? "Dry" : d.level === "damp" ? "Damp" : "Wet")}</span>
          <span class="d-temp">${Math.round(d.tempMax)}°</span>
          <span class="d-rain">${d.rainDay.toFixed(1)} mm · ${d.rainChance ?? 0}%</span>
        </div>`
        )
        .join("")}
    </div>
    <p class="gallery-note">
      An estimate from recent rain, humidity and wind, not a reading of the rock. Shaded and woodland boulders
      can stay damp for longer. Today's daylight: ${days[0]?.sunrise ?? "–"}–${days[0]?.sunset ?? "–"}.
      Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
    </p>`;
}

// ---------- Detail view ----------
let activeId = null;

function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

async function showDetail(id) {
  const area = AREAS.find((a) => a.id === id);
  if (!area) return;

  if (activeId) markers.get(activeId).setIcon(cragIcon());
  activeId = id;
  markers.get(id).setIcon(cragIcon(true));

  $("#list-view").hidden = true;
  $("#detail-view").hidden = false;
  $(".sidebar").scrollTop = 0;
  history.replaceState(null, "", `#${id}`);

  $("#detail").innerHTML = `
    <h2>${esc(area.name)}</h2>
    <p class="meta">${esc(area.region)}</p>
    <div class="facts">
      <div class="fact"><span>Rock</span><strong>${esc(area.rock)}</strong></div>
      <div class="fact"><span>Grades</span><strong>${esc(area.grades)}</strong></div>
      <div class="fact"><span>Approach</span><strong>${esc(area.approach)}</strong></div>
    </div>
    <p>${esc(area.description)}</p>

    <h3>Conditions</h3>
    <div id="conditions" class="conditions"><p class="gallery-note">Loading conditions…</p></div>

    ${problemsSection(area)}

    <h3>Parking</h3>
    <ul class="parking-list">
      ${area.parking
        .map(
          (p, i) => `
        <li class="parking-item">
          <h4>${esc(p.name)}</h4>
          <p>${esc(p.notes)}</p>
          <p><strong>${esc(p.fee)}</strong></p>
          <div class="parking-actions">
            <a href="${directionsUrl(p.lat, p.lng)}" target="_blank" rel="noopener">Directions</a>
            <button type="button" data-zoom="${i}">Show on map</button>
          </div>
        </li>`
        )
        .join("")}
    </ul>

    <h3>Photos</h3>
    <div id="gallery" class="gallery"><p class="gallery-note">Loading photos…</p></div>

    <p class="disclaimer">
      Parking locations are approximate and access arrangements change. Check the
      <a href="https://www.thebmc.co.uk/rad" target="_blank" rel="noopener">BMC Regional Access Database</a>
      before visiting, park considerately and never block gates.
    </p>`;

  if (area.problems?.length) wireProblems(area);
  weatherReady.then(() => { if (activeId === id) renderConditions(area); });

  $("#detail").querySelectorAll("[data-zoom]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = area.parking[btn.dataset.zoom];
      map.flyTo([p.lat, p.lng], 16);
    })
  );

  showBoulders(area);

  // Parking markers for this area
  parkingLayer.clearLayers();
  for (const p of area.parking) {
    L.marker([p.lat, p.lng], { icon: parkingIcon, title: p.name })
      .bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.fee)}<br><a href="${directionsUrl(p.lat, p.lng)}" target="_blank" rel="noopener">Directions</a>`)
      .addTo(parkingLayer);
  }
  const bounds = L.latLngBounds([[area.lat, area.lng], ...area.parking.map((p) => [p.lat, p.lng])]);
  map.flyToBounds(bounds.pad(0.6), { maxZoom: 15 });

  const photos = await getPhotos(area);
  if (activeId !== id) return; // user moved on
  $("#gallery").innerHTML = photos.length
    ? photos
        .map(
          (ph) => `
        <figure>
          <a href="${esc(ph.page || ph.url)}" target="_blank" rel="noopener">
            <img src="${esc(ph.url)}" alt="Photo near ${esc(area.name)}" loading="lazy" />
          </a>
          <figcaption title="${esc(ph.credit || "")}">${esc(ph.credit || "")}</figcaption>
        </figure>`
        )
        .join("") + `<p class="gallery-note" style="grid-column:1/-1">Photos from Wikimedia Commons taken near this crag.</p>`
    : `<p class="gallery-note">No photos found nearby yet.</p>`;
}

function showList() {
  if (activeId) markers.get(activeId).setIcon(cragIcon());
  activeId = null;
  parkingLayer.clearLayers();
  boulderLayer.clearLayers();
  $("#detail-view").hidden = true;
  $("#list-view").hidden = false;
  history.replaceState(null, "", location.pathname);
  map.flyToBounds(L.latLngBounds(AREAS.map((a) => [a.lat, a.lng])).pad(0.1));
}

$("#back").addEventListener("click", showList);

// ---------- Init ----------
const fitAll = () => map.fitBounds(L.latLngBounds(AREAS.map((a) => [a.lat, a.lng])).pad(0.1));

renderList();
const initial = location.hash.slice(1);
if (initial && AREAS.some((a) => a.id === initial)) showDetail(initial);
else fitAll();

addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (AREAS.some((a) => a.id === id)) showDetail(id);
  else if (!id && activeId) showList();
});

// Keep the map sized correctly if the layout changes (e.g. it was hidden at load, or the phone rotates)
new ResizeObserver(() => {
  map.invalidateSize();
  if (!activeId) fitAll();
}).observe($("#map"));
