import { API_BASE } from "./api";
import { useEffect, useState } from "react";

export default function RunnaImport({
  onUseWorkout,
  limit = 3,
  hideUrlInput = false,
  title = "Next 3 Workouts (Runna)"
}) {
  const [icsUrl, setIcsUrl] = useState(localStorage.getItem("runnaIcsUrl") || "");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(null);

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
      if (upcoming.length) {
        setSelectedIdx(0);
        onUseWorkout?.(upcoming[0], { auto: true });
      } else {
        setSelectedIdx(null);
      }

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
    <div>
      <h3 className="subsection-heading">{title}</h3>

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
            <div className="muted">No Runna ICS URL saved yet — load it once on the Plan tab.</div>
          ) : null}
        </div>
      )}

      {err ? <div className="error-text">{err}</div> : null}

      {events.length ? (
        <ul className="run-list" style={{ marginTop: 10 }}>
          {events.map((e, idx) => {
            const start = new Date(e.start);
            const label = start.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric"
            });
            const duration = extractDuration(e.description);
            const meta = [label, duration].filter(Boolean).join(" • ");

            const selected = idx === selectedIdx;

            return (
              <li key={`${e.title}-${idx}`} className={selected ? "selected" : ""}>
                <div>
                  <div><strong>{e.title}</strong></div>
                  <div className="muted">{meta}</div>
                </div>
                <div className="workout-action">
                  <span className="intensity-tag">{e.parsed?.intensity || "easy"}</span>
                  <button
                    type="button"
                    className={selected ? "btn-primary" : ""}
                    onClick={() => {
                      setSelectedIdx(idx);
                      onUseWorkout(e, { auto: false });
                    }}
                  >
                    {selected ? "Selected" : "Use"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="muted" style={{ marginTop: 8 }}>
          Paste your Runna calendar ICS URL and click Load.
        </div>
      )}
    </div>
  );
}
