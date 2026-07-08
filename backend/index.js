import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db, getStravaToken, saveStravaToken } from "./db.js";
import ical from "node-ical";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(__dirname, "../frontend/dist");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.send("LayerLog backend is running ❄️🏃‍♂️");
});

// Serve the built frontend (production only — in dev, Vite serves it on its own port)
app.use(express.static(FRONTEND_DIST));

// Create a run
app.post("/runs", (req, res) => {
  const {
    date,
    distance,
    intensity,
    temperature,
    wind,
    sunny,
    comfort_rating,
    notes,
    clothing = [],
    strava_activity_id
  } = req.body;

  if (!date) return res.status(400).json({ error: "date is required" });

  db.run(
    `INSERT INTO runs (date, distance, intensity, temperature, wind, sunny, comfort_rating, notes, strava_activity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      date,
      distance,
      intensity,
      temperature,
      wind,
      sunny ? 1 : 0,
      comfort_rating,
      notes,
      strava_activity_id ?? null
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const runId = this.lastID;

      // Save clothing items
      const stmt = db.prepare(`INSERT INTO run_clothing (run_id, item) VALUES (?, ?)`);
      for (const item of clothing) stmt.run(runId, item);
      stmt.finalize();

      res.json({ id: runId });
    }
  );
});

// List runs (most recent first)
app.get("/runs", (req, res) => {
  db.all(
    `SELECT * FROM runs ORDER BY date DESC, id DESC LIMIT 200`,
    (err, runs) => {
      if (err) return res.status(500).json({ error: err.message });

      if (!runs.length) return res.json([]);

      const ids = runs.map(r => r.id);
      const placeholders = ids.map(() => "?").join(",");

      db.all(
        `SELECT run_id, item FROM run_clothing WHERE run_id IN (${placeholders})`,
        ids,
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });

          const clothingByRun = {};
          for (const row of rows) {
            clothingByRun[row.run_id] ??= [];
            clothingByRun[row.run_id].push(row.item);
          }

          res.json(runs.map(r => ({ ...r, clothing: clothingByRun[r.id] ?? [] })));
        }
      );
    }
  );
});

// Wind meaningfully increases how cold a run feels; fold it into a single
// "feels like" number so matching/baseline bands don't have to treat
// temperature and wind as separate dimensions. The 3°F knock for wind > 7mph
// is calibrated against a real remembered example (40°F + wind > 7mph wore
// the same as a plain 37°F day) -- not a general wind-chill formula.
function feelsLikeTemp({ temperature, wind }) {
  let feelsLike = temperature;
  if ((wind ?? 0) > 7) feelsLike -= 3;
  return feelsLike;
}

// Starting-point outfit by feels-like temperature, for when there isn't
// enough (or any) logged history yet. Calibrated against remembered
// examples at 40/37/35/20°F; bands without a direct example (24-30°F) are
// an interpolated best guess and may need adjusting once real data exists.
const BASELINE_BANDS = [
  { min: 39, items: ["T-Shirt", "Shorts"] },
  { min: 36, items: ["T-Shirt", "Shorts", "Thin Gloves"] },
  { min: 30, items: ["Long Shirt", "Shorts", "Thin Gloves"] },
  { min: 24, items: ["Long Shirt", "Shorts", "Long Tights", "Thin Gloves", "Beanie"] },
  {
    min: -Infinity,
    items: [
      "Long Shirt",
      "Vest",
      "Shorts",
      "Long Tights",
      "Sweatpants",
      "Thin Gloves",
      "Thick Gloves",
      "Beanie",
      "Gaiter/Buff"
    ]
  }
];

function baselineOutfit(feelsLike) {
  return BASELINE_BANDS.find((band) => feelsLike >= band.min).items;
}

// Recommendation: once there's enough logged history for a temp/wind band,
// your own data fully drives the answer, weighted toward well-calibrated
// (comfort near 3) and recent runs rather than just "highest comfort_rating"
// (which used to rank "too hot" runs above "just right" ones -- comfort is
// U-shaped, not linear). The calibrated baseline table is only a cold-start
// fallback for bands with too little history to trust yet.
app.get("/recommendation", (req, res) => {
  const temp = Number(req.query.temp);
  const wind = req.query.wind ? Number(req.query.wind) : 0;
  const sunny = req.query.sunny === "1" ? 1 : 0;

  const distance = req.query.distance ? Number(req.query.distance) : null;
  const intensity = req.query.intensity ? String(req.query.intensity) : null;

  if (Number.isNaN(temp)) return res.status(400).json({ error: "temp is required" });

  const targetFeelsLike = feelsLikeTemp({ temperature: temp, wind });
  const baseline = baselineOutfit(targetFeelsLike);

  // Widen the SQL-side window since the real similarity check (feels-like,
  // which needs each candidate's own wind) happens in JS below.
  const params = [temp];
  let where = `WHERE ABS(temperature - ?) <= 10`;

  if (distance !== null && !Number.isNaN(distance)) {
    // within ±20% distance
    where += ` AND distance IS NOT NULL AND ABS(distance - ?) <= (? * 0.2) `;
    params.push(distance, distance);
  }

  if (intensity) {
    where += ` AND intensity = ? `;
    params.push(intensity);
  }

  db.all(`SELECT * FROM runs ${where}`, params, (err, candidates) => {
    if (err) return res.status(500).json({ error: err.message });

    const matched = candidates
      .filter((r) => r.sunny === null || r.sunny === sunny)
      .map((r) => ({ ...r, feelsLike: feelsLikeTemp({ temperature: r.temperature, wind: r.wind }) }))
      .filter((r) => Math.abs(r.feelsLike - targetFeelsLike) <= 5)
      .sort((a, b) => Math.abs(a.comfort_rating - 3) - Math.abs(b.comfort_rating - 3) || new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    if (!matched.length) {
      return res.json({
        basis: [],
        recommended: baseline,
        note: `No similar logged runs yet — showing a starting-point suggestion for ${Math.round(targetFeelsLike)}°F (feels like).`
      });
    }

    const ids = matched.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");

    db.all(`SELECT run_id, item FROM run_clothing WHERE run_id IN (${placeholders})`, ids, (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const clothingByRun = {};
      for (const row of rows) {
        clothingByRun[row.run_id] ??= [];
        clothingByRun[row.run_id].push(row.item);
      }

      const scoredRuns = matched.map((r) => ({ ...r, clothing: clothingByRun[r.id] ?? [] }));
      const now = Date.now();

      // Weight each run's vote by recency and by how close to a "just
      // right" comfort rating it was, so one old, way-too-hot run doesn't
      // outvote several recent, well-calibrated ones.
      const weightedCounts = {};
      let totalWeight = 0;
      for (const r of scoredRuns) {
        const daysAgo = (now - new Date(r.date).getTime()) / 86400000;
        const recencyWeight = 1 / (1 + daysAgo / 180);
        const comfortWeight = 1 - Math.abs(r.comfort_rating - 3) / 2;
        const weight = Math.max(0.05, recencyWeight * comfortWeight);
        totalWeight += weight;
        for (const item of r.clothing) {
          weightedCounts[item] = (weightedCounts[item] || 0) + weight;
        }
      }

      // Once there's enough history (>=3 similar runs), trust it fully --
      // both presence AND absence are signal at that point (if none of your
      // last several similar runs included gloves, that's real evidence you
      // don't need them, not just missing data). Baseline is a cold-start
      // fallback only, not a permanent floor; it's used below only if there
      // isn't enough history yet, or if history is too inconsistent for
      // anything to clear the 50% bar.
      const enoughData = scoredRuns.length >= 3;
      let recommended = baseline;
      let usedHistory = false;

      if (enoughData) {
        const fromHistory = Object.entries(weightedCounts)
          .filter(([, weight]) => weight / totalWeight >= 0.5)
          .map(([item]) => item);

        if (fromHistory.length) {
          recommended = fromHistory;
          usedHistory = true;
        }
      }

      res.json({
        basis: scoredRuns.slice(0, 5),
        recommended,
        note: usedHistory
          ? `Based on ${scoredRuns.length} of your own similar run(s) (feels like ${Math.round(targetFeelsLike)}°F).`
          : enoughData
            ? `${scoredRuns.length} similar run(s) logged, but clothing was too inconsistent to call -- showing a starting-point baseline for ${Math.round(targetFeelsLike)}°F (feels like) instead.`
            : `Only ${scoredRuns.length} similar run(s) logged so far -- showing a starting-point baseline for ${Math.round(targetFeelsLike)}°F (feels like) until there's more history.`
      });
    });
  });
});

// POST /runna/upcoming
// body: { icsUrl: "https://.../calendar.ics" }
app.post("/runna/upcoming", async (req, res) => {
  try {
    const { icsUrl } = req.body;
    if (!icsUrl) return res.status(400).json({ error: "icsUrl is required" });

    const data = await icalFromUrl(icsUrl);

    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // next 14 days

    const events = [];

    for (const value of Object.values(data)) {
      if (!value || value.type !== "VEVENT") continue;

      // Non-recurring event
      if (value.start instanceof Date && !value.rrule) {
        if (value.start >= now && value.start <= horizon) {
          events.push(toEvent(value, value.start, value.end));
        }
        continue;
      }

      // Recurring event: expand occurrences within horizon
      if (value.rrule) {
        const dates = value.rrule.between(now, horizon, true);
        for (const start of dates) {
          // duration handling
          const durationMs =
            value.end instanceof Date && value.start instanceof Date
              ? value.end.getTime() - value.start.getTime()
              : 60 * 60 * 1000;

          const end = new Date(start.getTime() + durationMs);
          events.push(toEvent(value, start, end));
        }
      }
    }

    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json(events.slice(0, 5));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Weather for a location, returning the hourly forecast at/after targetTime
// POST /weather/hourly
// body: { lat: number, lon: number, targetTimeISO: "2026-01-23T14:00" }
app.post("/weather/hourly", async (req, res) => {
  try {
    const { lat, lon, targetTimeISO } = req.body;

    if (typeof lat !== "number" || typeof lon !== "number") {
      return res.status(400).json({ error: "lat and lon must be numbers" });
    }
    if (!targetTimeISO) {
      return res.status(400).json({ error: "targetTimeISO is required" });
    }

    // Open-Meteo's default window starts at "today" — a target in the past
    // (e.g. an older Strava run) needs past_days, or it silently falls back
    // to today's data instead of the actual requested date.
    const targetDateOnly = targetTimeISO.slice(0, 10);
    const todayDateOnly = new Date().toISOString().slice(0, 10);
    const daysAgo = Math.round((Date.parse(todayDateOnly) - Date.parse(targetDateOnly)) / 86400000);
    const pastDays = Math.min(92, Math.max(0, daysAgo));

    // Open-Meteo: ask for Fahrenheit + mph to match your UI
    const url = "https://api.open-meteo.com/v1/forecast";
    const params = {
      latitude: lat,
      longitude: lon,
      hourly: "temperature_2m,wind_speed_10m,precipitation,cloud_cover",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      timezone: "auto",
      past_days: pastDays
    };

    const response = await axios.get(url, { params });
    const hourly = response.data?.hourly;

    if (!hourly?.time?.length) {
      return res.status(500).json({ error: "No hourly data returned" });
    }

    // Find the first hour >= targetTimeISO (strings are ISO-like and comparable)
    const target = targetTimeISO.slice(0, 16); // "YYYY-MM-DDTHH:MM"
    let idx = hourly.time.findIndex((t) => t >= target);
    if (idx === -1) idx = hourly.time.length - 1;

    const tempF = hourly.temperature_2m?.[idx];
    const windMph = hourly.wind_speed_10m?.[idx];
    const precip = hourly.precipitation?.[idx];
    const cloud = hourly.cloud_cover?.[idx];

    // Simple “sunny” heuristic: low clouds and no precip
    const sunny = (precip ?? 0) <= 0 && (cloud ?? 100) < 40;

    res.json({
      chosenTime: hourly.time[idx],
      temperatureF: tempF,
      windMph: windMph,
      precipitation: precip,
      cloudCover: cloud,
      sunny
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/runs/:id", (req, res) => {
  const id = Number(req.params.id);
  const r = req.body;

  db.run(
    `UPDATE runs
     SET date=?, distance=?, intensity=?, temperature=?, wind=?, sunny=?, comfort_rating=?, notes=?
     WHERE id=?`,
    [
      r.date,
      r.distance,
      r.intensity,
      r.temperature,
      r.wind,
      r.sunny ? 1 : 0,
      r.comfort_rating,
      r.notes ?? "",
      id
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // Replace clothing rows
      db.run(`DELETE FROM run_clothing WHERE run_id=?`, [id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });

        const clothing = Array.isArray(r.clothing) ? r.clothing : [];
        if (!clothing.length) return res.json({ ok: true });

        const stmt = db.prepare(`INSERT INTO run_clothing (run_id, item) VALUES (?, ?)`);
        for (const item of clothing) stmt.run(id, item);
        stmt.finalize(() => res.json({ ok: true }));
      });
    }
  );
});

app.delete("/runs/:id", (req, res) => {
  const id = Number(req.params.id);

  // delete clothing first (foreign key-ish)
  db.run(`DELETE FROM run_clothing WHERE run_id=?`, [id], (err1) => {
    if (err1) return res.status(500).json({ error: err1.message });

    db.run(`DELETE FROM runs WHERE id=?`, [id], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ ok: true });
    });
  });
});

app.get("/auth/strava/login", (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Missing STRAVA_CLIENT_ID or STRAVA_REDIRECT_URI in .env");
  }

  const scope = "read,activity:read_all";

  const url =
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&approval_prompt=auto` +
    `&scope=${encodeURIComponent(scope)}`;

  res.redirect(url);
});

app.get("/auth/strava/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    const tokenRes = await axios.post("https://www.strava.com/oauth/token", {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code"
    });

    const { access_token, refresh_token, expires_at } = tokenRes.data;

    saveStravaToken({ access_token, refresh_token, expires_at }, (err) => {
      if (err) return res.status(500).send(err.message);
      res.send("✅ Strava connected! You can close this tab and return to the app.");
    });
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e.message ||
      "OAuth token exchange failed";
    res.status(500).send(msg);
  }
});

// --- STRAVA (backend only for now) ---
// Returns your most recent N Strava activities that are NOT yet logged in our DB
  app.get("/strava/recent", (req, res) => {
    const limit = Math.min(Number(req.query.limit || 5), 10);

    // Fetch extra so we can still return limit runs after filtering
    const fetchCount = Math.min(Math.max(limit * 5, 15), 50);

  // Step 1: ensure we have a token stored, refreshing it first if it's expired
  getFreshStravaToken(async (err, tokenRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tokenRow?.access_token) {
      return res.status(401).json({
        error: "Strava not connected yet (no token stored). We'll add OAuth next."
      });
    }

    try {
      // Step 2: call Strava to get your recent activities
      const stravaRes = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${tokenRow.access_token}` },
        params: { per_page: fetchCount }
      });

      const activities = Array.isArray(stravaRes.data) ? stravaRes.data : [];

      // Keep only runs (Strava activity type is typically "Run") from the last 30 days
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const runsOnly = activities.filter(
        (a) => a?.type === "Run" && new Date(a.start_date).getTime() >= thirtyDaysAgo
      );

      // Step 3: filter out those already logged in our DB
      const ids = runsOnly.map((a) => String(a.id));
      if (!ids.length) return res.json({ activities: [] });

      const placeholders = ids.map(() => "?").join(",");
      db.all(
        `SELECT strava_activity_id FROM runs WHERE strava_activity_id IN (${placeholders})`,
        ids,
        (e2, rows) => {
          if (e2) return res.status(500).json({ error: e2.message });

          const logged = new Set((rows || []).map((r) => String(r.strava_activity_id)));
          const unlogged = runsOnly.filter((a) => !logged.has(String(a.id))).slice(0, limit);
          res.json({ activities: unlogged });

        }
      );
    } catch (e) {
      // If token is invalid/expired, this will likely be 401. We'll implement refresh in OAuth step.
      const status = e?.response?.status || 500;
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e.message ||
        "Strava request failed";
      res.status(status).json({ error: msg });
    }
  });
});

// Like getStravaToken, but refreshes via Strava's OAuth endpoint first if the
// stored access token is expired (or about to expire within 60s).
function getFreshStravaToken(cb) {
  getStravaToken(async (err, tokenRow) => {
    if (err) return cb(err);
    if (!tokenRow?.access_token) return cb(null, tokenRow);

    const now = Math.floor(Date.now() / 1000);
    if (tokenRow.expires_at && tokenRow.expires_at > now + 60) {
      return cb(null, tokenRow);
    }

    try {
      const refreshRes = await axios.post("https://www.strava.com/oauth/token", {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token
      });

      const { access_token, refresh_token, expires_at } = refreshRes.data;
      saveStravaToken({ access_token, refresh_token, expires_at }, (e) => {
        if (e) return cb(e);
        cb(null, { access_token, refresh_token, expires_at });
      });
    } catch (e) {
      cb(e);
    }
  });
}

function toEvent(e, start, end) {
  const title = e.summary ?? "";
  const description = e.description ?? "";

  return {
    title,
    start,
    end,
    description,
    location: e.location ?? "",
    // optional: try to extract useful hints from title/description
    parsed: parseRunnaText(`${title}\n${description}`)
  };
}

function icalFromUrl(url) {
  // Prefer the async API when available
  if (ical.async?.fromURL) return ical.async.fromURL(url);

  // Fallback to callback API
  return new Promise((resolve, reject) => {
    ical.fromURL(url, {}, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Very simple heuristics — adjust as you see how Runna formats your events
function parseRunnaText(text) {
  const lower = text.toLowerCase();

  // distance examples: "6 mi", "6.2 miles", "10km"
  const miMatch = lower.match(/(\d+(\.\d+)?)\s*(mi|miles)\b/);
  const kmMatch = lower.match(/(\d+(\.\d+)?)\s*(km|kilometers)\b/);

  let distanceMi = null;
  if (miMatch) distanceMi = Number(miMatch[1]);
  if (!distanceMi && kmMatch) distanceMi = Number(kmMatch[1]) * 0.621371;

  let intensity = "easy";
  if (lower.includes("tempo") || lower.includes("threshold")) intensity = "hard";
  else if (lower.includes("interval") || lower.includes("repeats")) intensity = "hard";
  else if (lower.includes("steady") || lower.includes("moderate")) intensity = "moderate";
  else if (lower.includes("easy") || lower.includes("recovery")) intensity = "easy";
  else if (lower.includes("long run")) intensity = "moderate";

  return {
    distanceMi, // might be null if not found
    intensity
  };
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
