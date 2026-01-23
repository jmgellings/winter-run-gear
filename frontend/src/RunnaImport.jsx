import { API_BASE } from "./api";
import { useEffect, useState } from "react";

export default function RunnaImport({
  onUseWorkout,
  limit = 5,
  hideUrlInput = false,
  title = "Next 5 Workouts (Runna)"
}) {
  const [icsUrl, setIcsUrl] = useState(localStorage.getItem("runnaIcsUrl") || "");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (icsUrl) loadUpcoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icsUrl, limit]);  

  async function loadUpcoming() {
    setErr("");
    setLoading(true);
    try {
      localStorage.setItem("runnaIcsUrl", icsUrl);
  
      const res = await fetch(`${API_BASE}/runna/upcoming`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icsUrl })
      });
  
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
  
      const upcoming = (data || []).slice(0, limit);
      setEvents(upcoming);

      // auto-select soonest
      if (upcoming.length) onUseWorkout?.(upcoming[0], { auto: true });

    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }  

  function extractDuration(description = "") {
    // Matches: "1h50m - 2h0m" or "45m - 55m" etc
    const match = description.match(/(\d+h)?\d+m\s*-\s*(\d+h)?\d+m/);
    return match ? match[0].replace(/\s*-\s*/, " – ") : "";
  }

  return (
    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
      <h2>{title}</h2>

      {!hideUrlInput ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            placeholder="Paste Runna iCal/ICS URL here"
            style={{ flex: 1 }}
          />
          <button onClick={loadUpcoming} disabled={!icsUrl || loading}>
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={loadUpcoming} disabled={!icsUrl || loading}>
            {loading ? "Loading..." : "Refresh Runna"}
          </button>
          {!icsUrl ? (
            <div style={{ opacity: 0.8 }}>
              No Runna ICS URL saved yet — load it once on the Plan tab.
            </div>
          ) : null}
        </div>
      )}


      {err ? <div style={{ color: "crimson" }}>{err}</div> : null}

      {events.length ? (
        <ul style={{ marginTop: 10 }}>
          {events.map((e, idx) => {
            const start = new Date(e.start);
            const label = start.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric"
            });
            const duration = extractDuration(e.description);
            
            return (
              <li key={`${e.title}-${idx}`} style={{ marginBottom: 10 }}>
                <div><strong>{e.title}</strong></div>
            
                <div style={{ opacity: 0.8 }}>{label}</div>
            
                {e.parsed?.distanceMi ? (
                  <div style={{ opacity: 0.8 }}>
                    Parsed: {e.parsed.distanceMi.toFixed(1)} mi, {e.parsed.intensity}
                  </div>
                ) : (
                  <div style={{ opacity: 0.8 }}>
                    Parsed intensity: {e.parsed?.intensity || "easy"} (distance not found)
                  </div>
                )}
            
                {duration ? (
                  <div style={{ opacity: 0.8 }}>Duration: {duration}</div>
                ) : null}
            
                <button
                  type="button"
                  onClick={() => onUseWorkout(e, { auto: false })}
                  style={{ marginTop: 6 }}
                >
                  Use this workout
                </button>
              </li>
            );
            
          })}
        </ul>
      ) : (
        <div style={{ marginTop: 8, opacity: 0.8 }}>
          Paste your Runna calendar ICS URL and click Load.
        </div>
      )}
    </div>
  );
}
