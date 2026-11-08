// Climbing conditions from Open-Meteo (https://open-meteo.com, CC BY 4.0).
//
// The verdict is a simple estimate from recent rainfall, humidity and wind,
// not a measurement of the rock. Sheltered or woodland boulders (and seepage)
// can stay wet much longer, so the UI always shows the numbers behind it.

const CACHE_KEY = "ukboulders.weather";
const CACHE_MS = 30 * 60 * 1000;

const HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m"];
const DAILY = ["precipitation_sum", "precipitation_probability_max", "temperature_2m_max", "wind_speed_10m_max", "sunrise", "sunset"];

// One request for every crag (Open-Meteo accepts comma-separated coordinates)
export async function loadWeather(areas) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    const sameCrags = cached?.ids?.join() === areas.map((a) => a.id).join();
    if (cached && sameCrags && Date.now() - cached.at < CACHE_MS) return toMap(areas, cached.data);
  } catch {}

  const params = new URLSearchParams({
    latitude: areas.map((a) => a.lat).join(","),
    longitude: areas.map((a) => a.lng).join(","),
    hourly: HOURLY.join(","),
    daily: DAILY.join(","),
    past_days: "2",
    forecast_days: "7",
    timezone: "Europe/London",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data];

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), ids: areas.map((a) => a.id), data }));
  } catch {}
  return toMap(areas, data);
}

const toMap = (areas, data) => new Map(areas.map((a, i) => [a.id, data[i]]));

// Index of the current hour in the hourly arrays (times are local, "YYYY-MM-DDTHH:00")
export function nowIndex(w) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const key = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
  const i = w.hourly.time.indexOf(key);
  return i >= 0 ? i : Math.min(48, w.hourly.time.length - 1);
}

const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

// Weighted recent rain: the last 12h count fully, 12–24h at 60%, 24–48h at 30%.
// Humid, still air slows drying; a breeze speeds it up.
function wetness(w, i) {
  const rain = w.hourly.precipitation;
  let score = 0;
  for (let k = 1; k <= 48 && i - k >= 0; k++) {
    score += (rain[i - k] || 0) * (k <= 12 ? 1 : k <= 24 ? 0.6 : 0.3);
  }
  score += (rain[i] || 0) * 1.5;
  const from = Math.max(0, i - 12);
  const hum = avg(w.hourly.relative_humidity_2m.slice(from, i + 1));
  const wind = avg(w.hourly.wind_speed_10m.slice(from, i + 1));
  if (hum > 90) score *= 1.3;
  if (wind > 15) score *= 0.8;
  return score;
}

const fragile = (area) => /sandstone/i.test(area.rock);

// Verdict for a given hour
export function assess(area, w, i) {
  const h = w.hourly;
  const rainNow = h.precipitation[i] || 0;
  const score = wetness(w, i);
  const rain48 = h.precipitation.slice(Math.max(0, i - 48), i).reduce((s, x) => s + (x || 0), 0);
  const temp = h.temperature_2m[i];
  const hum = h.relative_humidity_2m[i];
  const wind = h.wind_speed_10m[i];

  let level, label;
  if (rainNow >= 0.3) [level, label] = ["wet", "Raining"];
  else if (fragile(area)) {
    // Wet sandstone is weak: holds snap and wear. Only call it dry when it really should be.
    [level, label] = score < 0.3 ? ["dry", "Likely dry"] : ["wet", "Too wet for sandstone"];
  } else if (score < 0.5) [level, label] = ["dry", "Likely dry"];
  else if (score < 2.5) [level, label] = ["damp", "May be damp"];
  else [level, label] = ["wet", "Probably wet"];

  let friction;
  if (temp > 18 || hum > 85) friction = "Poor friction";
  else if (temp >= 0 && temp <= 14 && hum < 75) friction = "Good friction";
  else friction = "OK friction";

  return { level, label, score, rain48, temp, hum, wind, friction, fragile: fragile(area) };
}

// Daily outlook: judge each day at 1pm, using the forecast rain leading up to it
export function outlook(area, w) {
  const ni = nowIndex(w);
  const today = w.hourly.time[ni].slice(0, 10);
  const lateToday = +w.hourly.time[ni].slice(11, 13) >= 15;
  return w.daily.time
    .map((date, d) => {
      const i = w.hourly.time.indexOf(`${date}T13:00`);
      if (i < 0 || date < today) return null;
      const a = assess(area, w, i);
      return {
        date,
        isToday: date === today,
        over: date === today && lateToday, // too late in the day to recommend it
        ...a,
        rainDay: w.daily.precipitation_sum[d],
        rainChance: w.daily.precipitation_probability_max[d],
        tempMax: w.daily.temperature_2m_max[d],
        windMax: w.daily.wind_speed_10m_max[d],
        sunrise: w.daily.sunrise[d]?.slice(11),
        sunset: w.daily.sunset[d]?.slice(11),
      };
    })
    .filter(Boolean);
}

// Best day in the outlook: lowest wetness, then fewer rain chances, then cooler
export function bestDay(days) {
  return days.filter((d) => !d.over).sort((a, b) => a.score - b.score || a.rainChance - b.rainChance || a.tempMax - b.tempMax)[0];
}
