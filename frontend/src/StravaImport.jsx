import { useEffect, useState } from "react";
import { API_BASE } from "./api";

function metersToMiles(m) {
  return m == null ? null : m / 1609.344;
}

// Strava's start_date_local is already local wall-clock time, but it's
// suffixed with "Z" as if it were UTC. Parsing it with `new Date()` and
// letting toLocaleString() convert to the browser's timezone double-applies
// an offset (e.g. a 6:47 AM run shows as 2:47 AM in a UTC-4 timezone), so we
// pull the components out directly instead of treating it as a real instant.
function prettyWhen(localIso) {
  if (!localIso) return "";
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";

  const [, y, mo, d, h, mi] = m.map(Number);
  const dateForLabel = new Date(y, mo - 1, d);
  const weekday = dateForLabel.toLocaleDateString(undefined, { weekday: "short" });
  const month = dateForLabel.toLocaleDateString(undefined, { month: "short" });

  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";

  return `${weekday}, ${month} ${d}, ${hour12}:${String(mi).padStart(2, "0")} ${ampm}`;
}

export default function StravaImport({ onUseActivity, refreshSignal }) {
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState([]);
  const [err, setErr] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [connected, setConnected] = useState(true); // optimistic until we hear otherwise

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
        setConnected(false);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load Strava activities");

      setConnected(true);
      const list = data?.activities || [];
      setActivities(list);

      // auto-select first one if available
      if (list.length) {
        setSelectedId(list[0].id);
        onUseActivity?.(list[0], { auto: true });
      } else {
        setSelectedId(null);
      }
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
    // auto-load on mount, and again whenever a run is saved elsewhere
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  return (
    <div className="card">
      <div className="strava-header">
        <div className="strava-header-top">
          <h2 style={{ margin: 0 }}>Recent Runs (Strava)</h2>
          {connected && (
            <button
              type="button"
              className="icon-button"
              onClick={loadRecent}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              {loading ? "…" : "⟳"}
            </button>
          )}
        </div>

        {!connected && (
          <div className="strava-header-actions">
            <button type="button" onClick={connectStrava}>Connect Strava</button>
            <button type="button" onClick={loadRecent} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        )}
      </div>

      {err ? <div className="error-text" style={{ marginTop: 8 }}>{err}</div> : null}

      {!err && activities.length === 0 ? (
        <div className="muted" style={{ marginTop: 10 }}>All recent runs recorded!</div>
      ) : null}

      {activities.length ? (
        <ul className="run-list" style={{ marginTop: 10 }}>
          {activities.map((a) => {
            const miles = metersToMiles(a.distance);
            const durationMin = a.moving_time != null ? Math.round(a.moving_time / 60) : null;
            const selected = a.id === selectedId;

            return (
              <li key={a.id} className={selected ? "selected" : ""}>
                <div>
                  <div><strong>{a.name || "Run"}</strong></div>
                  <div className="muted">
                    {prettyWhen(a.start_date_local)} •{" "}
                    {miles != null ? `${miles.toFixed(2)} mi` : "—"} •{" "}
                    {durationMin != null ? `${durationMin} min` : "—"}
                  </div>
                </div>
                <button
                  type="button"
                  className={`select-btn${selected ? " btn-primary" : ""}`}
                  onClick={() => {
                    setSelectedId(a.id);
                    onUseActivity?.(a, { auto: false });
                  }}
                >
                  {selected ? "Selected" : "Use"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
