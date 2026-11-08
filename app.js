import { AREAS } from "./data/areas.js";

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

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const region = $("#region").value;
  const shown = AREAS.filter(
    (a) =>
      (!region || a.region === region) &&
      (!q || [a.name, a.region, a.rock, a.description].join(" ").toLowerCase().includes(q))
  );

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
$("#area-list").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) showDetail(card.dataset.id);
});

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

  $("#detail").querySelectorAll("[data-zoom]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = area.parking[btn.dataset.zoom];
      map.flyTo([p.lat, p.lng], 16);
    })
  );

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
