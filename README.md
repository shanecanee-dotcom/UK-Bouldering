# UK Boulders

A lightweight web app listing outdoor bouldering areas in the UK, with photos and nearby parking.

- **List + map**: search and filter areas by region, see them all on an OpenStreetMap map.
- **Area detail**: rock type, grade range, approach time and a short description.
- **Parking**: each area lists one or more parking spots with fees, notes, a "Directions" link and a map marker.
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
}
```

Coordinates and parking details are approximate. Check the
[BMC Regional Access Database](https://www.thebmc.co.uk/rad) for up-to-date access info.

## Deploying

It's a static site, so it can be hosted for free on GitHub Pages: Settings → Pages → deploy from the `main` branch root.
