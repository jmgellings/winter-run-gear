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
