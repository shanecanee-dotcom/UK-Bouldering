# UK Boulders

A lightweight web app listing outdoor bouldering areas in the UK, with photos and nearby parking.

- **List + map**: search and filter areas by region, see them all on an OpenStreetMap map.
- **Area detail**: rock type, grade range, approach time and a short description.
- **Parking**: each area lists one or more parking spots with fees, notes, a "Directions" link and a map marker.
- **Conditions**: a "likely dry / may be damp / wet" estimate for each crag, the rain over the last 48 hours, a friction hint and a 7-day outlook with the best day, from [Open-Meteo](https://open-meteo.com) (no API key needed). Sandstone crags use a stricter rule. The logic is in [`conditions.js`](conditions.js).
- **Walk-ins**: the walking route from each car park to the crag drawn on the map, with distance, ascent, an estimated time and the nearest postcode for sat-navs. The routes are precomputed into [`data/walkins.js`](data/walkins.js).
- **Works offline**: installable to a phone's home screen. A service worker ([`sw.js`](sw.js)) caches the app, crag data, problems and walk-ins, and keeps the map tiles and photos you've viewed. The last weather forecast is kept for up to six days and marked as saved. Map tiles are only cached as you view them, never bulk-downloaded, per the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/). Bump `VERSION` in `sw.js` when you add new app files.
- **Pin a boulder**: on any problem, pin its boulder using your phone's GPS or by tapping the map. Pins are stored on your device; "Copy pins" on the Problems tab gives you lines to paste into `boulders` in `data/areas.js` so everyone gets them.
- **OpenStreetMap problems**: boulders and individually mapped problems from OSM (ODbL) are merged in from [`data/osm.js`](data/osm.js), built by `python3 tools/build_osm.py`. Some of these use V grades, which sort alongside Font grades.
- **Access**: each crag's BMC Regional Access Database status (including any current restriction), parking and approach notes, parking locations, grid reference and open-access status, with a link to the live BMC page. Built into [`data/access.js`](data/access.js) by `python3 tools/build_access.py`; re-run it now and then, as access changes. BMC's database covers England and Wales; Scottish crags point to the Scottish Outdoor Access Code.
- **Photos**: pulled live from [Wikimedia Commons](https://commons.wikimedia.org) (freely licensed, geotagged near each crag) with credits. You can pin your own photos per area with the `photos` field.

No build step: plain HTML, CSS and JavaScript, with [Leaflet](https://leafletjs.com) loaded from a CDN.

## Run locally

The app uses ES modules, so serve it over HTTP rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Adding or editing areas

All data lives in [`data/areas.js`](data/areas.js). Add an object to `AREAS`:

```js
{
  id: "my-crag",
  name: "My Crag",
  region: "Peak District",
  lat: 53.0, lng: -1.6,
  rock: "Gritstone",
  grades: "f3 – f7A",
  approach: "10 min",
  description: "…",
  parking: [
    { name: "Main car park", lat: 53.0, lng: -1.6, notes: "…", fee: "Free" },
  ],
  // optional – otherwise photos come from Wikimedia Commons
  photos: [{ url: "images/my-crag-1.jpg", credit: "Your name" }],
  // optional problem list; boulder links to the boulders map below
  problems: [
    {
      name: "The Arete", grade: "f6A", stars: 2, boulder: "Big Block",
      description: "Balancy arête with a good landing.",          // optional
      photo: { url: "images/the-arete.jpg", credit: "Your name" }, // optional
    },
  ],
  // optional boulder positions, keyed by the problems' boulder name
  boulders: { "Big Block": { lat: 53.0, lng: -1.6 } },
}
```

Ticks, personal notes and personal photos added in the app are stored only in that browser (localStorage / IndexedDB).
To publish a photo or description for everyone, add `photo` / `description` to the problem in `data/areas.js`.

After adding a crag or changing crag/parking coordinates, regenerate the walk-ins (takes a minute or two; it calls free public APIs politely):

```bash
python3 tools/build_walkins.py
```

It uses OSRM walking routes over OpenStreetMap paths, Open-Meteo elevation and postcodes.io. A route that's wildly longer than the straight-line distance is dropped and shown as "no walking route mapped".

Coordinates and parking details are approximate. Check the
[BMC Regional Access Database](https://www.thebmc.co.uk/rad) for up-to-date access info.

## Deploying

It's a static site, so it can be hosted for free on GitHub Pages: Settings → Pages → deploy from the `main` branch root.
