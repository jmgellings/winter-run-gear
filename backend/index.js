import express from "express";
import cors from "cors";
import { db, getStravaToken, saveStravaToken } from "./db.js";
import ical from "node-ical";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("LayerLog backend is running ❄️🏃‍♂️");
});

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

// Recommendation: find similar temps (+/- 5F), pick best comfort, return common clothing
app.get("/recommendation", (req, res) => {
  const temp = Number(req.query.temp);
  const sunny = req.query.sunny === "1" ? 1 : 0;

  const distance = req.query.distance ? Number(req.query.distance) : null;
  const intensity = req.query.intensity ? String(req.query.intensity) : null;

  if (Number.isNaN(temp)) return res.status(400).json({ error: "temp is required" });

  const params = [temp, sunny];
  let where = `
    WHERE ABS(temperature - ?) <= 5
      AND (sunny IS NULL OR sunny = ?)
  `;

  if (distance !== null && !Number.isNaN(distance)) {
    // within ±20% distance
    where += ` AND distance IS NOT NULL AND ABS(distance - ?) <= (? * 0.2) `;
    params.push(distance, distance);
  }

  if (intensity) {
    where += ` AND intensity = ? `;
    params.push(intensity);
  }

  db.all(
    `SELECT * FROM runs
     ${where}
     ORDER BY comfort_rating DESC, date DESC
     LIMIT 10`,
    params,
    (err, runs) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!runs.length) return res.json({ basis: [], recommended: [], note: "No similar runs yet." });

      // ...keep your existing clothing lookup + counting logic here...
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

          const scoredRuns = runs.map(r => ({ ...r, clothing: clothingByRun[r.id] ?? [] }));

          const counts = {};
          for (const r of scoredRuns) {
            for (const item of r.clothing) counts[item] = (counts[item] || 0) + 1;
          }

          const recommended = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([item]) => item);

          res.json({
            basis: scoredRuns.slice(0, 5),
            recommended,
            note: `Based on ${scoredRuns.length} similar run(s) within ±5°F` +
              (distance !== null ? ` and ~same distance` : ``) +
              (intensity ? ` and intensity=${intensity}` : ``) +
              `.`
          });
        }
      );
    }
  );
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

    // Open-Meteo: ask for Fahrenheit + mph to match your UI
    const url = "https://api.open-meteo.com/v1/forecast";
    const params = {
      latitude: lat,
      longitude: lon,
      hourly: "temperature_2m,wind_speed_10m,precipitation,cloud_cover",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      timezone: "auto"
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

  // Step 1: ensure we have a token stored (OAuth comes next)
  getStravaToken(async (err, tokenRow) => {
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

      // Keep only runs (Strava activity type is typically "Run")
      const runsOnly = activities.filter((a) => a?.type === "Run");

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

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
