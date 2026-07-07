import sqlite3 from "sqlite3";
import path from "path";

sqlite3.verbose();

const DB_PATH = path.join(process.cwd(), "runs.db");

export const db = new sqlite3.Database(DB_PATH);

// --- Base tables ---
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      distance REAL,
      intensity TEXT,
      temperature REAL,
      wind REAL,
      sunny INTEGER,
      comfort_rating INTEGER,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS run_clothing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      item TEXT
    )
  `);

  // --- MIGRATIONS / ADDITIONS FOR STRAVA SUPPORT ---

  db.all("PRAGMA table_info(runs)", (err, cols) => {
    if (err) {
      console.error("PRAGMA table_info(runs) failed:", err);
      return;
    }

    const createIndex = () => {
      db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_strava_activity_id ON runs(strava_activity_id)",
        (e) => {
          if (e) console.error("Failed to create strava index:", e);
        }
      );
    };

    const has = (cols || []).some((c) => c.name === "strava_activity_id");
    if (!has) {
      db.run("ALTER TABLE runs ADD COLUMN strava_activity_id TEXT", (e) => {
        if (e) console.error("Failed to add strava_activity_id:", e);
        else console.log("Added runs.strava_activity_id");
        createIndex();
      });
    } else {
      createIndex();
    }
  });

  db.run(
    `CREATE TABLE IF NOT EXISTS strava_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER
    )`,
    (e) => {
      if (e) console.error("Failed to create strava_tokens:", e);
    }
  );
});

// --- Token helpers ---
export function getStravaToken(cb) {
  db.get("SELECT access_token, refresh_token, expires_at FROM strava_tokens WHERE id = 1", cb);
}

export function saveStravaToken({ access_token, refresh_token, expires_at }, cb) {
  db.run(
    `INSERT INTO strava_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token=excluded.access_token,
       refresh_token=excluded.refresh_token,
       expires_at=excluded.expires_at`,
    [access_token, refresh_token, expires_at],
    cb
  );
}
