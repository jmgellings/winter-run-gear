import { useEffect, useState } from "react";
import { API_BASE } from "./api";

function metersToMiles(m) {
  return m == null ? null : m / 1609.344;
}

function prettyWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function StravaImport({ onUseActivity }) {
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState([]);
  const [err, setErr] = useState("");

  async function loadRecent() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/strava/recent?limit=5`);
      const data = await res.json();

      if (res.status === 401) {
        // Not connected yet
        setActivities([]);
        setErr(data?.error || "Strava not connected");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load Strava activities");

      const list = data?.activities || [];
      setActivities(list);

      // auto-select first one if available
      if (list.length) onUseActivity?.(list[0], { auto: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  function connectStrava() {
    // Opens backend OAuth in a new tab
    window.open(`${API_BASE}/auth/strava/login`, "_blank");
  }

  useEffect(() => {
    // auto-load on mount
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Recent Runs (Strava)</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={connectStrava}>Connect Strava</button>
          <button type="button" onClick={loadRecent} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {err ? <div style={{ color: "crimson", marginTop: 8 }}>{err}</div> : null}

      {!err && activities.length === 0 ? (
        <div style={{ marginTop: 10, opacity: 0.85 }}>All recent runs recorded!</div>
      ) : null}

      {activities.length ? (
        <ul style={{ marginTop: 10 }}>
          {activities.map((a) => {
            const miles = metersToMiles(a.distance);
            const durationMin = a.moving_time != null ? Math.round(a.moving_time / 60) : null;

            return (
              <li key={a.id} style={{ marginBottom: 10 }}>
                <div><strong>{a.name || "Run"}</strong></div>
                <div style={{ opacity: 0.85 }}>
                  {prettyWhen(a.start_date_local)} •{" "}
                  {miles != null ? `${miles.toFixed(2)} mi` : "—"} •{" "}
                  {durationMin != null ? `${durationMin} min` : "—"}
                </div>
                <button
                  type="button"
                  onClick={() => onUseActivity?.(a, { auto: false })}
                  style={{ marginTop: 6 }}
                >
                  Use this run
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
