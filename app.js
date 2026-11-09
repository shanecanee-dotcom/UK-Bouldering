import { AREAS } from "./data/areas.js";
import { loadWeather, nowIndex, assess, outlook, bestDay } from "./conditions.js";
import { WALKINS } from "./data/walkins.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Map ----------
// zoomSnap 0 = continuous zoom: needed for smooth trackpad zooming, and lets the whole UK
// fit short (phone) maps. Leaflet's own wheel zoom is replaced below.
const map = L.map("map", { zoomControl: true, zoomSnap: 0, zoomDelta: 1, scrollWheelZoom: false, minZoom: 4, maxZoom: 18 })
  .setView([54.3, -2.5], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Smooth wheel / trackpad zoom.
// Leaflet's built-in handler debounces wheel events, rounds each burst to a zoom step and plays a
// 250 ms animation, so trackpad pinches (lots of tiny events) feel laggy. Instead, apply the
// accumulated delta once per animation frame, zooming around the pointer.
(() => {
  const el = map.getContainer();
  let pending = 0;
  let anchor = null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    if (!pending) return;
    const z = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + pending));
    pending = 0;
    map.setZoomAround(anchor, z, { animate: false });
  };
  const queue = (dz, clientX, clientY) => {
    pending += dz;
    const r = el.getBoundingClientRect();
    anchor = L.point(clientX - r.left, clientY - r.top);
    frame ||= requestAnimationFrame(apply);
  };

  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      // Pinch arrives as ctrl+wheel with small deltas; mouse wheels and two-finger scrolls send bigger ones
      const perPx = e.ctrlKey ? 0.012 : 0.004;
      queue(Math.max(-1, Math.min(1, -px * perPx)), e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Safari sends trackpad pinches as gesture events (scale relative to the gesture start)
  let startZoom = null;
  el.addEventListener("gesturestart", (e) => { e.preventDefault(); startZoom = map.getZoom(); });
  el.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (startZoom == null) return;
    pending = startZoom + Math.log2(e.scale) - map.getZoom();
    const r = el.getBoundingClientRect();
    anchor = L.point(e.clientX - r.left, e.clientY - r.top);
    frame ||= requestAnimationFrame(apply);
  });
  el.addEventListener("gestureend", (e) => { e.preventDefault(); startZoom = null; });
})();

// Crag pins are coloured by today's conditions once the weather has loaded
const cragIcon = (level = "unknown", active = false) => {
  const s = active ? 30 : 24;
  return L.divIcon({
    className: "",
    html: `<div class="pin ${level}${active ? " active" : ""}"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s],
    tooltipAnchor: [0, -s],
  });
};
const parkingIcon = L.divIcon({ className: "", html: '<div class="p-pin">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });

const markers = new Map();
const parkingLayer = L.layerGroup().addTo(map);

for (const area of AREAS) {
  const m = L.marker([area.lat, area.lng], { icon: cragIcon(), title: area.name })
    .addTo(map)
    .bindTooltip(area.name, { direction: "top" })
    .on("click", () => showDetail(area.id));
  markers.set(area.id, m);
}

function updateMarkers() {
  for (const a of AREAS) markers.get(a.id).setIcon(cragIcon(condNow(a)?.level, a.id === activeId));
}

const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `<span class="cond-dry"><i></i>Dry</span><span class="cond-damp"><i></i>Damp</span><span class="cond-wet"><i></i>Wet</span>`;
  div.title = "Today's estimated conditions";
  return div;
};

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
    if (m) {
      updateMarkers();
      legend.addTo(map);
    }
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
      (a) => {
        const c = condNow(a);
        const walk = walkFor(a, bestWalkIndex(a));
        return `
      <li>
        <button class="card" data-id="${a.id}" type="button">
          <div class="thumb" data-thumb="${a.id}"></div>
          <div class="card-body">
            <div class="card-top">
              <h3>${esc(a.name)}</h3>
              ${c ? `<span class="pill cond-${c.level}" title="${esc(c.label)}"><i></i>${esc(shortLabel(c))}</span>` : ""}
            </div>
            <p class="meta">${esc(a.region)} · ${esc(a.rock)}</p>
            <p class="card-stats">
              <span>${esc(a.grades.replace(/\s/g, ""))}</span>
              ${a.problems?.length ? `<span>${a.problems.length} problems</span>` : ""}
              ${walk?.path ? `<span>${walk.minutes} min walk</span>` : ""}
            </p>
          </div>
        </button>
      </li>`;
      }
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

// Hovering a card highlights its pin on the map
const hoverPin = (id, on) => {
  const m = markers.get(id);
  m?.getElement()?.classList.toggle("hover", on);
  m?.setZIndexOffset(on ? 1000 : 0);
};
$("#area-list").addEventListener("mouseover", (e) => {
  const card = e.target.closest(".card");
  if (card) hoverPin(card.dataset.id, true);
});
$("#area-list").addEventListener("mouseout", (e) => {
  const card = e.target.closest(".card");
  if (card && !card.contains(e.relatedTarget)) hoverPin(card.dataset.id, false);
});

// Short labels for the small card pill
const shortLabel = (c) =>
  ({ "Likely dry": "Dry", "May be damp": "Damp", "Probably wet": "Wet", Raining: "Raining", "Too wet for sandstone": "Too wet" }[c.label] || c.label);

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
    return `<p class="lead muted">No problem list for this area yet. If you know the problems here, they can be added to <code>data/areas.js</code>.</p>`;
  const hasBoulders = area.problems.some((p) => p.boulder);
  return `
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
    <p id="tick-count" class="tick-count"></p>
    <div class="tick-bar" aria-hidden="true"><span id="tick-bar"></span></div>
    <ul id="problem-list" class="problem-list"></ul>
    <p class="fine-print">A selection of problems, not a full guide. Grades are a consensus and can change. Tap a problem for its location, your photo and notes, and beta videos.</p>`;
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
    $("#tick-bar").style.width = `${(done / area.problems.length) * 100}%`;

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
           <div class="actions">
             <button type="button" class="btn" data-act="map">Show on map</button>
             <a class="btn" href="${walkingUrl(spot.lat, spot.lng)}" target="_blank" rel="noopener">Walking directions</a>
           </div>`
        : `<p class="muted">${p.boulder ? `${esc(p.boulder)}: exact` : "Exact"} boulder position isn't mapped yet, so this points to the crag.</p>
           <div class="actions">
             <button type="button" class="btn" data-act="map">Show crag on map</button>
             <a class="btn" href="${walkingUrl(area.lat, area.lng)}" target="_blank" rel="noopener">Walking directions</a>
           </div>`}
    </div>

    <div class="pd-section">
      <h5>Photo</h5>
      <div class="pd-photo"></div>
      <div class="actions">
        <label class="file-btn">
          <input type="file" accept="image/*" capture="environment" data-act="photo" hidden />
          <span class="btn">Add your photo</span>
        </label>
        <button type="button" class="btn" data-act="rmphoto" hidden>Remove photo</button>
      </div>
    </div>

    <div class="pd-section">
      <h5>What it's like</h5>
      ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      <textarea data-act="note" rows="3" placeholder="Your notes: style, beta, conditions, landing…">${esc(note)}</textarea>
      <div class="actions">
        <a class="btn primary" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">▶ Watch beta videos</a>
        <a class="btn" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Search the web</a>
      </div>
    </div>`;

  const panel = li.querySelector(".problem-detail");

  // Photo: data file photo first, then the user's own
  const showPhoto = async () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl), (objectUrl = null);
    const box = panel.querySelector(".pd-photo");
    const mine = await photoDb.get(id);
    panel.querySelector('[data-act="rmphoto"]').hidden = !mine;
    panel.querySelector(".file-btn .btn").textContent = mine ? "Replace your photo" : "Add your photo";
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
function ago(t) {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function renderConditions(area) {
  const box = document.getElementById("conditions");
  if (!box) return;
  const w = weather?.get(area.id);
  if (!w) {
    box.innerHTML = `<p class="muted">Couldn't load the weather right now. Try again later.</p>`;
    return;
  }
  const now = assess(area, w, nowIndex(w));
  const days = outlook(area, w);
  const best = bestDay(days);

  const heroPill = document.getElementById("hero-cond");
  if (heroPill) {
    heroPill.className = `hero-pill cond-${now.level}`;
    heroPill.innerHTML = `<i></i>${esc(now.label)}`;
  }

  box.className = "cond-card";
  box.innerHTML = `
    <div class="cond-now cond-${now.level}">
      <strong><i></i>${esc(now.label)}</strong>
      <span>${now.friction}</span>
    </div>
    ${weather.stale ? `<p class="cond-warn">Offline: this is the forecast saved ${esc(ago(weather.fetchedAt))}.</p>` : ""}
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
    <p class="fine-print">
      Daylight today ${days[0]?.sunrise ?? "–"}–${days[0]?.sunset ?? "–"}. An estimate from recent rain, humidity and wind,
      not a reading of the rock; shaded and woodland boulders can stay damp for longer.
      Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
    </p>`;
}

// ---------- Walk-ins (precomputed by tools/build_walkins.py) ----------
const walkLayer = L.layerGroup().addTo(map);
let walkLines = [];

const walkFor = (area, i) => WALKINS[area.id]?.find((w) => w.parking === i);
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

// Shortest walk-in is the "main" one
function bestWalkIndex(area) {
  const routed = (WALKINS[area.id] || []).filter((w) => w.path);
  return routed.length ? routed.reduce((a, b) => (b.minutes < a.minutes ? b : a)).parking : 0;
}

function walkSummary(area) {
  const w = walkFor(area, bestWalkIndex(area));
  return w?.path ? `~${w.minutes} min (${fmtDist(w.distance)})` : area.approach;
}

function drawWalks(area) {
  walkLayer.clearLayers();
  walkLines = (WALKINS[area.id] || []).map((w) =>
    w.path
      ? L.polyline(w.path, { weight: 4, dashArray: "6 8", lineCap: "round" })
          .bindTooltip(`~${w.minutes} min · ${fmtDist(w.distance)} · ↑${w.ascent} m`, { sticky: true })
          .addTo(walkLayer)
      : null
  );
  highlightWalk(area, bestWalkIndex(area));
}

function highlightWalk(area, i) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--parking").trim() || "#1d5fa8";
  walkLines.forEach((line, j) => {
    if (!line) return;
    const on = (WALKINS[area.id] || [])[j]?.parking === i;
    line.setStyle({ color: accent, opacity: on ? 0.95 : 0.35, weight: on ? 5 : 3 });
    if (on) line.bringToFront();
  });
  document.querySelectorAll(".parking-item").forEach((li) => li.classList.toggle("walk-on", +li.dataset.parking === i));
}

// ---------- Detail view ----------
let activeId = null;
let currentTab = "overview";

function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

async function showDetail(id) {
  const area = AREAS.find((a) => a.id === id);
  if (!area) return;

  const prev = activeId;
  activeId = id;
  if (prev) markers.get(prev).setIcon(cragIcon(condNow(AREAS.find((a) => a.id === prev))?.level));
  markers.get(id).setIcon(cragIcon(condNow(area)?.level, true)).setZIndexOffset(500);
  if (prev && prev !== id) markers.get(prev).setZIndexOffset(0);

  $("#list-view").hidden = true;
  $("#detail-view").hidden = false;
  document.body.classList.add("detail-mode");
  $(".sidebar").scrollTop = 0;
  history.replaceState(null, "", `#${id}`);

  const nProblems = area.problems?.length || 0;
  const mainWalk = walkFor(area, bestWalkIndex(area));

  $("#detail").innerHTML = `
    <header class="crag-hero" id="hero">
      <span class="hero-credit" id="hero-credit"></span>
      <div class="hero-text">
        <span class="hero-pill" id="hero-cond"></span>
        <h2>${esc(area.name)}</h2>
        <p>${esc(area.region)} · ${esc(area.rock)}</p>
      </div>
    </header>

    <div class="stats">
      <div><span>Grades</span><strong>${esc(area.grades.replace(/\s/g, ""))}</strong></div>
      <div><span>Problems</span><strong>${nProblems || "–"}</strong></div>
      <div><span>Walk-in</span><strong>${mainWalk?.path ? `~${mainWalk.minutes} min` : esc(area.approach)}</strong></div>
    </div>

    <nav class="tabs" role="tablist" aria-label="Crag sections">
      <button class="tab" role="tab" data-tab="overview">Overview</button>
      <button class="tab" role="tab" data-tab="problems">Problems${nProblems ? ` <span class="n">${nProblems}</span>` : ""}</button>
      <button class="tab" role="tab" data-tab="parking">Parking</button>
    </nav>

    <section class="panel" data-panel="overview" role="tabpanel">
      <p class="lead">${esc(area.description)}</p>
      <h3>Conditions</h3>
      <div id="conditions"><p class="muted">Loading conditions…</p></div>
      <h3>Photos</h3>
      <div id="gallery" class="gallery"><p class="gallery-note">Loading photos…</p></div>
    </section>

    <section class="panel" data-panel="problems" role="tabpanel">
      ${problemsSection(area)}
    </section>

    <section class="panel" data-panel="parking" role="tabpanel">
      ${area.parking.length
        ? `<ul class="parking-list">${area.parking.map((p, i) => parkingCard(area, p, i)).join("")}</ul>`
        : area.parkingNote ? "" : `<p class="lead muted">No car park is mapped for this crag yet.</p>`}
      ${area.parkingNote ? `<p class="cond-warn">${esc(area.parkingNote)}</p>` : ""}
      ${WALKINS[area.id]?.some((w) => w.path)
        ? `<p class="fine-print">Walk-ins follow mapped paths from OpenStreetMap. Times use Naismith's rule
           (5 km/h plus 10 min per 100 m of ascent). Ascent comes from coarse elevation data, so treat it as approximate.</p>
           <p class="fine-print">No signal at the crag? Open this page and tap "Show walk-in" before you set off: the map
           tiles you view are saved for offline use.</p>`
        : ""}
      <p class="disclaimer">
        Access arrangements change. Check the
        <a href="https://www.thebmc.co.uk/rad" target="_blank" rel="noopener">BMC Regional Access Database</a>
        before visiting, park considerately and never block gates.
      </p>
    </section>`;

  // Tabs (the chosen tab sticks as you move between crags)
  const tabs = $("#detail").querySelectorAll(".tab");
  const selectTab = (name, scroll) => {
    currentTab = name;
    tabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
    $("#detail").querySelectorAll(".panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (scroll) {
      const nav = $("#detail .tabs");
      const sb = $(".sidebar");
      if (sb.scrollTop > nav.offsetTop) sb.scrollTop = nav.offsetTop;
    }
  };
  tabs.forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab, true)));
  selectTab(currentTab === "problems" && !nProblems ? "overview" : currentTab, false);

  if (nProblems) wireProblems(area);
  weatherReady.then(() => { if (activeId === id) renderConditions(area); });

  $("#detail").querySelectorAll("[data-zoom]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = +btn.dataset.zoom;
      const p = area.parking[i];
      const w = walkFor(area, i);
      if (w?.path) {
        highlightWalk(area, i);
        map.flyToBounds(L.latLngBounds(w.path).pad(0.25), { maxZoom: 17 });
      } else {
        map.flyTo([p.lat, p.lng], 16);
      }
      if (matchMedia("(max-width: 760px)").matches) document.getElementById("map").scrollIntoView({ behavior: "smooth" });
    })
  );

  showBoulders(area);

  // Parking markers for this area
  parkingLayer.clearLayers();
  area.parking.forEach((p, i) => {
    const w = walkFor(area, i);
    L.marker([p.lat, p.lng], { icon: parkingIcon, title: p.name })
      .bindPopup(
        `<strong>${esc(p.name)}</strong><br>${esc(p.fee)}` +
          (w?.postcode ? `<br>Sat nav: ${esc(w.postcode)}` : "") +
          (w?.path ? `<br>Walk-in ~${w.minutes} min, ${fmtDist(w.distance)}` : "") +
          `<br><a href="${directionsUrl(p.lat, p.lng)}" target="_blank" rel="noopener">Driving directions</a>`
      )
      .on("click", () => highlightWalk(area, i))
      .addTo(parkingLayer);
  });

  drawWalks(area);
  const bounds = L.latLngBounds([[area.lat, area.lng], ...area.parking.map((p) => [p.lat, p.lng]), ...(mainWalk?.path || [])]);
  // Jump rather than fly: a long fly-over from the UK view shows blank tiles for seconds
  map.fitBounds(bounds.pad(0.3), { maxZoom: 16 });

  const photos = await getPhotos(area);
  if (activeId !== id) return; // user moved on
  if (photos[0]) {
    $("#hero").style.backgroundImage = `url("${photos[0].url}")`;
    $("#hero-credit").textContent = photos[0].credit ? `Photo: ${photos[0].credit}` : "";
  }
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
  const prev = activeId;
  activeId = null;
  if (prev) markers.get(prev).setIcon(cragIcon(condNow(AREAS.find((a) => a.id === prev))?.level)).setZIndexOffset(0);
  parkingLayer.clearLayers();
  boulderLayer.clearLayers();
  walkLayer.clearLayers();
  $("#detail-view").hidden = true;
  $("#list-view").hidden = false;
  document.body.classList.remove("detail-mode");
  history.replaceState(null, "", location.pathname + location.search);
  fitAll();
}

function parkingCard(area, p, i) {
  const w = walkFor(area, i);
  return `
    <li class="parking-item" data-parking="${i}">
      <div class="parking-head">
        <span class="p-badge" aria-hidden="true">P</span>
        <h4>${esc(p.name)}</h4>
      </div>
      <div class="parking-meta">
        <span><strong>${esc(p.fee)}</strong></span>
        ${w?.postcode
          ? `<span>Sat nav <strong>${esc(w.postcode)}</strong>${w.postcodeDistance > 150 ? ` (nearest, ${fmtDist(w.postcodeDistance)} away)` : ""}</span>`
          : ""}
      </div>
      ${w?.path
        ? `<div class="walk-line"><span>Walk-in <strong>~${w.minutes} min</strong></span><span>${fmtDist(w.distance)}</span><span>↑${w.ascent} m</span></div>`
        : w?.unrouted
          ? `<div class="walk-line muted">No walking route mapped. ${fmtDist(w.straight)} in a straight line.</div>`
          : ""}
      <p>${esc(p.notes)}</p>
      <div class="actions">
        <a class="btn primary" href="${directionsUrl(p.lat, p.lng)}" target="_blank" rel="noopener">Driving directions</a>
        <button type="button" class="btn" data-zoom="${i}">${w?.path ? "Show walk-in" : "Show on map"}</button>
      </div>
    </li>`;
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

// ---------- Offline support ----------
function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = text;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  }, 4000);
}

const updateOnline = () => ($("#offline").hidden = navigator.onLine);
addEventListener("online", updateOnline);
addEventListener("offline", updateOnline);
updateOnline();

if ("serviceWorker" in navigator) {
  const firstInstall = !navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register("sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => { if (firstInstall) toast("Ready to use offline"); })
    .catch(() => {}); // e.g. private browsing: the app still works online
}

// Keep the map sized correctly if the layout changes (e.g. it was hidden at load, or the phone rotates)
new ResizeObserver(() => {
  map.invalidateSize();
  // Skip fitting while the map has no real size yet (e.g. a hidden pane), or Leaflet zooms right out
  if (!activeId && $("#map").clientHeight > 50) fitAll();
}).observe($("#map"));
