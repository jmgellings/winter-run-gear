import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./api";
import RunnaImport from "./RunnaImport";
import StravaImport from "./StravaImport";
import "./App.css";

const CLOTHING_GROUPS = [
  { label: "Upper body", items: ["T-Shirt", "Long Shirt", "Vest", "Jacket"] },
  { label: "Lower body", items: ["Shorts", "Long Tights", "Sweatpants"] },
  { label: "Hands", items: ["Thin Gloves", "Thick Gloves"] },
  { label: "Head & face", items: ["Headband", "Beanie", "Gaiter/Buff"] }
];

function nextHourParts() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);

  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

function formatForecastHour(isoLike) {
  if (!isoLike) return "";
  const d = new Date(isoLike);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRunDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

// The fields for an actual logged run: what you wore, how it felt. Shared by the
// Log tab's create form and the edit modal. When `hideDetails` is set (Log tab only,
// once a Strava run has been selected), the auto-filled date/distance/conditions rows
// are skipped and only comfort/notes/clothing show.
function RunFields({ value, onChange, hideDetails = false }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const toggleClothing = (item) => {
    const clothing = Array.isArray(value.clothing) ? value.clothing : [];
    const has = clothing.includes(item);
    set({ clothing: has ? clothing.filter((x) => x !== item) : [...clothing, item] });
  };

  return (
    <>
      {!hideDetails && (
        <>
          <div className="form-grid form-grid-nowrap">
            <label className="field">
              Date
              <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
            </label>

            <label className="field">
              Distance (mi)
              <input
                type="number"
                step="0.1"
                value={value.distance ?? ""}
                onChange={(e) => set({ distance: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              Intensity
              <select value={value.intensity} onChange={(e) => set({ intensity: e.target.value })}>
                <option value="easy">easy</option>
                <option value="moderate">moderate</option>
                <option value="hard">hard</option>
              </select>
            </label>

            <label className="field-checkbox">
              <input type="checkbox" checked={!!value.sunny} onChange={(e) => set({ sunny: e.target.checked })} />
              Sunny
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              Temp (°F)
              <input
                type="number"
                value={value.temperature}
                onChange={(e) => set({ temperature: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              Wind (mph)
              <input type="number" value={value.wind} onChange={(e) => set({ wind: Number(e.target.value) })} />
            </label>
          </div>
        </>
      )}

      <label className="field">
        Comfort (1=freezing, 3=good, 5=too hot)
        <div className="slider-row">
          <input
            type="range"
            min="1"
            max="5"
            value={value.comfort_rating}
            onChange={(e) => set({ comfort_rating: Number(e.target.value) })}
          />
          <span className="slider-value">{value.comfort_rating}</span>
        </div>
      </label>

      <label className="field">
        Notes
        <input
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="e.g., windy on bridge, hands cold"
        />
      </label>

      <div>
        <div style={{ marginBottom: 8 }}>Clothing</div>
        <div className="clothing-groups">
          {CLOTHING_GROUPS.map((group) => (
            <div className="clothing-group" key={group.label}>
              <div className="group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => toggleClothing(item)}
                  className={`chip${value.clothing?.includes(item) ? " selected" : ""}`}
                >
                  {item}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("plan"); // "plan" | "log"
  const weatherReqId = useRef(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null); // holds the run being edited

  // Plan tab: what should I wear for an upcoming run?
  const [planSource, setPlanSource] = useState(null); // which Runna workout this came from
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [planForm, setPlanForm] = useState(() => {
    const { date, time } = nextHourParts();
    return {
      date,
      time,
      distance: null,
      intensity: "easy",
      temperature: 40,
      wind: 5,
      sunny: false
    };
  });
  const [weather, setWeather] = useState(null);
  const [recommendation, setRecommendation] = useState(null);

  // Log tab: what did I actually wear, and how did it feel?
  const [logSource, setLogSource] = useState(null); // which Strava activity this came from
  const [showLogDetails, setShowLogDetails] = useState(false);
  const [stravaRefreshTick, setStravaRefreshTick] = useState(0);

  function defaultLogForm() {
    return {
      date: new Date().toISOString().slice(0, 10),
      distance: 3,
      intensity: "easy",
      temperature: 40,
      wind: 5,
      sunny: false,
      comfort_rating: 3,
      notes: "",
      clothing: [],
      strava_activity_id: null
    };
  }

  const [form, setForm] = useState(defaultLogForm);

  async function fetchWeather() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }

      if (!planForm.date || !planForm.time) {
        reject(new Error("Missing date/time"));
        return;
      }

      const requestedTarget = `${planForm.date}T${planForm.time}`;
      const targetDate = new Date(requestedTarget);
      const reqId = ++weatherReqId.current;

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

            const url = new URL("https://api.open-meteo.com/v1/forecast");
            url.searchParams.set("latitude", String(lat));
            url.searchParams.set("longitude", String(lon));
            url.searchParams.set("hourly", "temperature_2m,wind_speed_10m,precipitation,cloud_cover");
            url.searchParams.set("temperature_unit", "fahrenheit");
            url.searchParams.set("wind_speed_unit", "mph");
            url.searchParams.set("timezone", "auto");

            const res = await fetch(url);
            const data = await res.json();

            const hourly = data?.hourly;
            if (!hourly?.time?.length) {
              reject(new Error("No hourly data returned"));
              return;
            }

            let idx = hourly.time.findIndex((t) => new Date(t) >= targetDate);
            if (idx === -1) idx = hourly.time.length - 1; // fallback to last available hour

            const chosenTime = hourly.time[idx];
            const temperatureF = hourly.temperature_2m?.[idx];
            const windMph = hourly.wind_speed_10m?.[idx];
            const precipitation = hourly.precipitation?.[idx];
            const cloudCover = hourly.cloud_cover?.[idx];

            const sunny = (precipitation ?? 0) <= 0 && (cloudCover ?? 100) < 40;

            // Ignore stale responses (user changed date/time again before this resolved)
            if (reqId !== weatherReqId.current) {
              resolve();
              return;
            }

            setWeather({ requestedTarget, chosenTime, temperatureF, windMph, precipitation, cloudCover, sunny });

            setPlanForm((f) => ({
              ...f,
              temperature: Number(temperatureF ?? f.temperature),
              wind: Number(windMph ?? f.wind),
              sunny: Boolean(sunny)
            }));

            resolve();
          } catch (e) {
            reject(e);
          }
        },
        (err) => {
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function getRecommendation() {
    const params = new URLSearchParams({
      temp: String(planForm.temperature),
      wind: String(planForm.wind),
      sunny: planForm.sunny ? "1" : "0",
      intensity: planForm.intensity
    });

    if (planForm.distance != null) {
      params.set("distance", String(planForm.distance));
    }

    const res = await fetch(`${API_BASE}/recommendation?${params}`);
    const data = await res.json();
    setRecommendation(data);
  }

  async function oneClickRecommend() {
    try {
      await fetchWeather();
    } catch {
      // fall back to the manually entered temp/wind/sunny values
    }
    await getRecommendation();
  }

  // Best-effort: look up actual conditions for a Strava activity's time/place.
  // Open-Meteo only has reliable data for the last ~2-3 months, so older
  // activities (or ones missing GPS) just leave temp/wind/sunny untouched.
  async function fetchWeatherForActivity(a) {
    const [lat, lon] = a.start_latlng ?? [];
    if (lat == null || lon == null || !a.start_date_local) return null;

    try {
      const res = await fetch(`${API_BASE}/weather/hourly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, targetTimeISO: a.start_date_local })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function refreshRuns() {
    const res = await fetch(`${API_BASE}/runs`);
    const data = await res.json();
    setRuns(data);
  }

  useEffect(() => {
    refreshRuns();
  }, []);

  async function submitRun(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Failed to save run");
        return;
      }

      await refreshRuns();
      setForm(defaultLogForm());
      setLogSource(null);
      setShowLogDetails(false);
      setStravaRefreshTick((t) => t + 1);
      alert("Saved!");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRun(id) {
    if (!confirm("Delete this run? This cannot be undone.")) return;
    await fetch(`${API_BASE}/runs/${id}`, { method: "DELETE" });
    await refreshRuns();
    setEditOpen(false);
    setEditForm(null);
  }

  function openEditModal(run) {
    setEditForm({
      id: run.id,
      date: run.date,
      distance: run.distance,
      intensity: run.intensity,
      temperature: run.temperature,
      wind: run.wind ?? 0,
      sunny: !!run.sunny,
      comfort_rating: run.comfort_rating ?? 3,
      notes: run.notes ?? "",
      clothing: run.clothing ?? []
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editForm?.id) return;
    await fetch(`${API_BASE}/runs/${editForm.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm)
    });
    await refreshRuns();
    setEditOpen(false);
    setEditForm(null);
  }

  const recentRuns = useMemo(() => runs.slice(0, 10), [runs]);

  const planDetailFields = (
    <>
      <label className="field">
        Distance (mi)
        <input
          type="number"
          step="0.1"
          value={planForm.distance ?? ""}
          onChange={(e) =>
            setPlanForm({ ...planForm, distance: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <div className="form-grid">
        <label className="field">
          Intensity
          <select
            value={planForm.intensity}
            onChange={(e) => setPlanForm({ ...planForm, intensity: e.target.value })}
          >
            <option value="easy">easy</option>
            <option value="moderate">moderate</option>
            <option value="hard">hard</option>
          </select>
        </label>

        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={planForm.sunny}
            onChange={(e) => setPlanForm({ ...planForm, sunny: e.target.checked })}
          />
          Sunny
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          Temp (°F)
          <input
            type="number"
            value={planForm.temperature}
            onChange={(e) => setPlanForm({ ...planForm, temperature: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          Wind (mph)
          <input
            type="number"
            value={planForm.wind}
            onChange={(e) => setPlanForm({ ...planForm, wind: Number(e.target.value) })}
          />
        </label>
      </div>
    </>
  );

  return (
    <div className="app-container">
      <div className="app-header">
        <h1>LayerLog</h1>
        <span className="app-tagline">
          Dress right.
          <br />
          Run happy.
        </span>
      </div>

      <div className="tabs">
        <button className={`tab${mode === "plan" ? " active" : ""}`} onClick={() => setMode("plan")}>Plan</button>
        <button className={`tab${mode === "log" ? " active" : ""}`} onClick={() => setMode("log")}>Log</button>
      </div>

      {mode === "plan" ? (
        <div>
          <section className="card">
            <h2>What should I wear?</h2>

            {!planSource && planDetailFields}

            <RunnaImport
              onUseWorkout={(plan, meta) => {
                const workoutDate =
                  plan.start_date ?? (plan.start ? new Date(plan.start).toISOString().slice(0, 10) : null);

                setPlanForm((f) => ({
                  ...f,
                  distance: plan.parsed?.distanceMi ?? plan.distance_mi ?? f.distance,
                  intensity: plan.parsed?.intensity ?? plan.intensity ?? f.intensity,
                  date: workoutDate ?? f.date
                }));

                setPlanSource(plan.title);
                setShowPlanDetails(false);
                setRecommendation(null);
                setWeather(null);
              }}
            />

            <hr className="section-divider" />

            <div className="form-grid form-grid-nowrap">
              <label className="field">
                Date
                <input
                  type="date"
                  value={planForm.date}
                  onChange={(e) => setPlanForm({ ...planForm, date: e.target.value })}
                />
              </label>

              <label className="field">
                Time
                <input
                  type="time"
                  value={planForm.time}
                  onChange={(e) => setPlanForm({ ...planForm, time: e.target.value })}
                />
              </label>
            </div>

            {planSource && (
              <button
                type="button"
                className="link-button details-toggle"
                onClick={() => setShowPlanDetails((s) => !s)}
              >
                {showPlanDetails ? "Hide details" : "Edit details"}
              </button>
            )}

            {planSource && showPlanDetails && planDetailFields}

            <button
              className="btn-primary"
              type="button"
              onClick={oneClickRecommend}
              style={{ width: "100%", marginTop: 14 }}
            >
              Get Recommendation
            </button>

            {recommendation && (
              <div className="card-inset">
                <div className="muted">
                  {weather ? `Forecast hour: ${formatForecastHour(weather.chosenTime)}` : "Conditions used"}
                </div>
                <div className="weather-temp" style={{ marginTop: 4 }}>
                  {Math.round(weather ? weather.temperatureF : planForm.temperature)}°F
                </div>
                <div className="muted">
                  wind {Math.round(weather ? weather.windMph : planForm.wind)} mph •{" "}
                  {(weather ? weather.sunny : planForm.sunny) ? "sunny" : "cloudy/precip"}
                </div>
              </div>
            )}

            {recommendation && (
              <div className="card-inset">
                <div style={{ marginBottom: 6 }}>{recommendation.note}</div>
                <div>
                  <strong>Suggested:</strong>{" "}
                  {recommendation.recommended?.length ? recommendation.recommended.join(", ") : "—"}
                </div>

                {recommendation.basis?.length ? (
                  <>
                    <div style={{ marginTop: 10, fontWeight: 600 }}>Top similar runs</div>
                    <ul>
                      {recommendation.basis.map((r) => (
                        <li key={r.id}>
                          {r.date} — {r.distance ?? "?"} mi — {r.intensity ?? "?"} — {r.temperature}°F — comfort{" "}
                          {r.comfort_rating} — {r.clothing?.join(", ") || "no clothing"}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div>
          <StravaImport
            refreshSignal={stravaRefreshTick}
            onUseActivity={async (a, meta) => {
              const date = a.start_date_local
                ? new Date(a.start_date_local).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);

              const miles = a.distance != null ? a.distance / 1609.344 : null;

              setForm((f) => ({
                ...f,
                date,
                distance: miles != null ? Number(miles.toFixed(2)) : f.distance,
                strava_activity_id: String(a.id)
              }));

              setLogSource(a.name || "Run");
              setShowLogDetails(false);

              const weather = await fetchWeatherForActivity(a);
              if (weather) {
                setForm((f) => ({
                  ...f,
                  temperature: Math.round(weather.temperatureF ?? f.temperature),
                  wind: Math.round(weather.windMph ?? f.wind),
                  sunny: Boolean(weather.sunny)
                }));
              }
            }}
          />

          <section className="card">
            <h2>Log a run</h2>

            <form onSubmit={submitRun} style={{ display: "grid", gap: 10 }}>
              {logSource && (
                <button
                  type="button"
                  className="link-button details-toggle"
                  onClick={() => setShowLogDetails((s) => !s)}
                >
                  {showLogDetails ? "Hide details" : "Edit details"}
                </button>
              )}

              <RunFields value={form} onChange={setForm} hideDetails={logSource && !showLogDetails} />

              <div className="actions-row">
                <button className="btn-primary" disabled={loading} type="submit" style={{ width: "100%" }}>
                  {loading ? "Saving..." : "Save Run"}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <h2>Recent Runs</h2>
            {recentRuns.length === 0 ? (
              <div className="muted">No runs logged yet. Get back out there!</div>
            ) : (
              <ul className="run-cards">
                {recentRuns.map((r) => (
                  <li key={r.id} className="run-card">
                    <div className="run-card-header">
                      <div className="run-card-date">
                        {formatRunDate(r.date)}
                        <span className={`intensity-pill intensity-${r.intensity}`}>{r.intensity}</span>
                      </div>
                      <button type="button" className="link-button" onClick={() => openEditModal(r)}>
                        Edit
                      </button>
                    </div>

                    <div className="run-card-meta">
                      <span className="metric">{r.distance != null ? `${r.distance} mi` : "— mi"}</span>
                      <span className="metric">{r.temperature}°F</span>
                      {r.wind ? <span className="metric">{r.wind} mph</span> : null}
                      {r.sunny ? <span className="metric">☀️</span> : null}
                      <span className="metric">comfort {r.comfort_rating}/5</span>
                    </div>

                    {r.clothing?.length ? (
                      <div className="run-card-clothing">
                        {r.clothing.map((item) => (
                          <span key={item} className="chip-static">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {r.notes ? <div className="run-card-notes">"{r.notes}"</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {editOpen && editForm && (
        <div
          className="modal-overlay"
          onClick={() => {
            setEditOpen(false);
            setEditForm(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 style={{ margin: 0 }}>Edit run</h3>
              <button
                type="button"
                onClick={() => {
                  setEditOpen(false);
                  setEditForm(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="modal-body">
              <RunFields value={editForm} onChange={setEditForm} />

              <div className="modal-actions">
                <button type="button" onClick={() => deleteRun(editForm.id)}>
                  Delete
                </button>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditOpen(false);
                      setEditForm(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button className="btn-primary" type="button" onClick={saveEdit}>
                    Save changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
