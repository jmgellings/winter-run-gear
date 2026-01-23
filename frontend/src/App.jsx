import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./api";
import RunnaImport from "./RunnaImport";
import StravaImport from "./StravaImport";

const CLOTHING_OPTIONS = [
  "T-Shirt",
  "Long Shirt",
  "Vest",
  "Jacket",
  "Shorts",
  "Long Tights",
  "Sweatpants",
  "Thin Gloves",
  "Thick Gloves",
  "Headband",
  "Beanie",
  "Gaiter/Buff"
];

export default function App() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("plan"); // "plan" | "log"
  const [selectedPlan, setSelectedPlan] = useState(null);
  const weatherReqId = useRef(0);
  const [editingRunId, setEditingRunId] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null); // holds the run being edited

  const [form, setForm] = useState({
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
  });

  const toggleEditClothing = (item) => {
    setEditForm((f) => {
      if (!f) return f;
      const clothing = Array.isArray(f.clothing) ? f.clothing : [];
      const has = clothing.includes(item);
      return { ...f, clothing: has ? clothing.filter((x) => x !== item) : [...clothing, item] };
    });
  };  

  const [planInputs, setPlanInputs] = useState(() => {
    const { date, time } = nextHourParts();
    return {
      distance: null,
      intensity: "easy",
      temperature: 40,
      wind: 5,
      sunny: false,
      plannedDate: date,
      plannedTime: time
    };
  });  

  const [planWeather, setPlanWeather] = useState(null);

  const [planRec, setPlanRec] = useState(null);

  const [rec, setRec] = useState(null);

  const toggleClothing = (item) => {
    setForm((f) => {
      const has = f.clothing.includes(item);
      return { ...f, clothing: has ? f.clothing.filter(x => x !== item) : [...f.clothing, item] };
    });
  };

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

  function nextHourLocalISO() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
  
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }  

  // Add useRef to your imports:
// import { useEffect, useMemo, useRef, useState } from "react";

  async function fetchPlanWeather(override) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        alert("Geolocation not supported in this browser.");
        reject(new Error("Geolocation not supported"));
        return;
      }

      const plannedDate = override?.plannedDate;
      const plannedTime = override?.plannedTime;

      if (!plannedDate || !plannedTime) {
        alert("Pick a planned date and time first.");
        reject(new Error("Missing planned date/time"));
        return;
      }

      const requestedTarget = `${plannedDate}T${plannedTime}`;
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
            url.searchParams.set(
              "hourly",
              "temperature_2m,wind_speed_10m,precipitation,cloud_cover"
            );
            url.searchParams.set("temperature_unit", "fahrenheit");
            url.searchParams.set("wind_speed_unit", "mph");
            url.searchParams.set("timezone", "auto");

            const res = await fetch(url);
            const data = await res.json();

            const hourly = data?.hourly;
            if (!hourly?.time?.length) {
              alert("No hourly data returned");
              reject(new Error("No hourly data returned"));
              return;
            }

            // Compare as Dates (not strings)
            let idx = hourly.time.findIndex((t) => new Date(t) >= targetDate);
            if (idx === -1) idx = hourly.time.length - 1; // fallback to last available hour

            const chosenTime = hourly.time[idx];
            const temperatureF = hourly.temperature_2m?.[idx];
            const windMph = hourly.wind_speed_10m?.[idx];
            const precipitation = hourly.precipitation?.[idx];
            const cloudCover = hourly.cloud_cover?.[idx];

            const sunny = (precipitation ?? 0) <= 0 && (cloudCover ?? 100) < 40;

            // Ignore stale responses (clicked another run)
            if (reqId !== weatherReqId.current) {
              resolve(); // resolve quietly; a newer request is in flight
              return;
            }

            setPlanWeather({
              requestedTarget,
              chosenTime,
              temperatureF,
              windMph,
              precipitation,
              cloudCover,
              sunny
            });

            setPlanInputs((p) => ({
              ...p,
              temperature: Number(temperatureF ?? p.temperature),
              wind: Number(windMph ?? p.wind),
              sunny: Boolean(sunny)
            }));

            resolve();
          } catch (e) {
            alert(e.message || "Weather fetch failed");
            reject(e);
          }
        },
        (err) => {
          alert(err.message || "Unable to get location");
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
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
      await fetch(`${API_BASE}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      await refreshRuns();
      alert("Saved!");
    } finally {
      setLoading(false);
    }
  }

  async function getRecommendation() {
    const params = new URLSearchParams({
      temp: String(form.temperature),
      wind: String(form.wind),
      sunny: form.sunny ? "1" : "0"
    });
    const res = await fetch(`${API_BASE}/recommendation?${params}`);
    const data = await res.json();
    setRec(data);
  }

  async function getPlanRecommendation() {
    const params = new URLSearchParams({
      temp: String(planInputs.temperature),
      wind: String(planInputs.wind),
      sunny: planInputs.sunny ? "1" : "0",
      intensity: planInputs.intensity
    });
  
    if (planInputs.distance != null) {
      params.set("distance", String(planInputs.distance));
    }
  
    const res = await fetch(`${API_BASE}/recommendation?${params}`);
    const data = await res.json();
    setPlanRec(data);
  }

  async function deleteRun(id) {
    if (!confirm("Delete this run? This cannot be undone.")) return;
    await fetch(`${API_BASE}/runs/${id}`, { method: "DELETE" });
    await refreshRuns();
    setEditOpen(false);
    setEditForm(null);
  }  

  async function planOneClickRecommend() {
    // 1) fetch weather (uses current planned date/time from inputs)
    await fetchPlanWeather({ plannedDate: planInputs.plannedDate, plannedTime: planInputs.plannedTime });
  
    // 2) then run recommendation (will use updated planInputs temp/wind/sunny)
    await getPlanRecommendation();
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
  
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>Winter Run Gear</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setMode("plan")} disabled={mode === "plan"}>Plan</button>
        <button onClick={() => setMode("log")} disabled={mode === "log"}>Log</button>
      </div>

      {mode === "plan" ? (
        <div>
        <RunnaImport
          key="runna-plan"
          limit={5}
          onUseWorkout={(plan, meta) => {
            setSelectedPlan(plan);
          
            const workoutDate =
              plan.start_date ??
              (plan.start ? new Date(plan.start).toISOString().slice(0, 10) : null);
          
            // Update state
            setPlanInputs((p) => ({
              ...p,
              distance: plan.parsed?.distanceMi ?? plan.distance_mi ?? p.distance,
              intensity: plan.parsed?.intensity ?? plan.intensity ?? p.intensity,
              plannedDate: workoutDate ?? p.plannedDate
            }));
          
            setPlanRec(null);
            setPlanWeather(null);
          
            // ✅ IMPORTANT: use the NEW workoutDate + CURRENT time picker value
            if (!meta?.auto && workoutDate) {
              fetchPlanWeather({ plannedDate: workoutDate, plannedTime: planInputs.plannedTime });
            }
          }}          
        />
      
      {selectedPlan && (
        <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginTop: 12 }}>
          <h2>Analyze planned run</h2>

          <div style={{ marginBottom: 8 }}>
            <strong>{selectedPlan.title}</strong>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label>
              Distance (mi)
              <input
                type="number"
                step="0.1"
                value={planInputs.distance ?? ""}
                onChange={(e) =>
                  setPlanInputs({
                    ...planInputs,
                    distance: e.target.value === "" ? null : Number(e.target.value)
                  })
                }
                style={{ width: "100%" }}
              />
            </label>

            <label>
              Intensity
              <select
                value={planInputs.intensity}
                onChange={(e) => setPlanInputs({ ...planInputs, intensity: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="easy">easy</option>
                <option value="moderate">moderate</option>
                <option value="hard">hard</option>
              </select>
            </label>

            <label>
              Temp (°F)
              <input
                type="number"
                value={planInputs.temperature}
                onChange={(e) => setPlanInputs({ ...planInputs, temperature: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
            <label>
              Wind (mph)
              <input
                type="number"
                value={planInputs.wind}
                onChange={(e) => setPlanInputs({ ...planInputs, wind: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                type="checkbox"
                checked={planInputs.sunny}
                onChange={(e) => setPlanInputs({ ...planInputs, sunny: e.target.checked })}
              />
              Sunny
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
            
            <label>
              Planned date
              <input
                type="date"
                value={planInputs.plannedDate}
                onChange={(e) => setPlanInputs({ ...planInputs, plannedDate: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <label>
              Planned time
              <input
                type="time"
                value={planInputs.plannedTime}
                onChange={(e) => setPlanInputs({ ...planInputs, plannedTime: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              onClick={() =>
                fetchPlanWeather({
                  plannedDate: planInputs.plannedDate,
                  plannedTime: planInputs.plannedTime
                })
              }
              style={{ width: "100%" }}
            >
              Check Weather
            </button>
            </div>
          </div>

          {planWeather && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Weather preview</div>
              <div style={{ opacity: 0.85 }}>
                Forecast hour: {formatForecastHour(planWeather.chosenTime)}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>{Math.round(planWeather.temperatureF)}°F</strong> • wind {Math.round(planWeather.windMph)} mph •{" "}
                {planWeather.sunny ? "sunny" : "cloudy/precip"}
              </div>
            </div>
          )}
            
            <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" onClick={planOneClickRecommend} style={{ width: "100%" }}>
              Get recommendation
            </button>

            </div>
          </div>

          {planRec && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
              <div style={{ marginBottom: 6 }}>{planRec.note}</div>

              <div>
                <strong>Suggested:</strong>{" "}
                {planRec.recommended?.length ? planRec.recommended.join(", ") : "—"}
              </div>

              {planRec.basis?.length ? (
                <>
                  <div style={{ marginTop: 10, fontWeight: 600 }}>Top similar runs</div>
                  <ul>
                    {planRec.basis.map((r) => (
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
      )}

      </div>
      
      ) : (
        <div>
          <StravaImport
          onUseActivity={(a, meta) => {
            const date = a.start_date_local
              ? new Date(a.start_date_local).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10);

            const miles = a.distance != null ? a.distance / 1609.344 : null;

            setForm((f) => ({
              ...f,
              date,
              distance: miles != null ? Number(miles.toFixed(2)) : f.distance,
              intensity: f.intensity, // keep yours for now; we can infer later
              strava_activity_id: String(a.id) // ✅ key piece
              // notes unchanged (per your preference)
            }));

            if (!meta?.auto) alert("Loaded Strava run into the form!");
          }}
        />
          <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
            <h2>Log a run</h2>

            <form onSubmit={submitRun} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>
                  Date
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Distance (mi)
                  <input
                    type="number"
                    step="0.1"
                    value={form.distance}
                    onChange={(e) => setForm({ ...form, distance: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Intensity
                  <select
                    value={form.intensity}
                    onChange={(e) => setForm({ ...form, intensity: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="easy">easy</option>
                    <option value="moderate">moderate</option>
                    <option value="hard">hard</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>
                  Temp (°F)
                  <input
                    type="number"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Wind (mph)
                  <input
                    type="number"
                    value={form.wind}
                    onChange={(e) => setForm({ ...form, wind: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={form.sunny}
                    onChange={(e) => setForm({ ...form, sunny: e.target.checked })}
                  />
                  Sunny
                </label>
              </div>

              <label>
                Comfort (1=freezing, 3=good, 5=too hot)
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={form.comfort_rating}
                  onChange={(e) => setForm({ ...form, comfort_rating: Number(e.target.value) })}
                />
                <div>Selected: {form.comfort_rating}</div>
              </label>

              <label>
                Notes
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  style={{ width: "100%" }}
                  placeholder="e.g., windy on bridge, hands cold"
                />
              </label>

              <div>
                <div style={{ marginBottom: 8 }}>Clothing</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {CLOTHING_OPTIONS.map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => toggleClothing(item)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: form.clothing.includes(item) ? "#111" : "#fff",
                        color: form.clothing.includes(item) ? "#fff" : "#111",
                        cursor: "pointer"
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button disabled={loading} type="submit">
                  {loading ? "Saving..." : "Save run"}
                </button>
              </div>
            </form>

            {rec && (
              <div style={{ marginTop: 16, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <h3>Recommendation</h3>
                <div>{rec.note}</div>
                <div style={{ marginTop: 8 }}>
                  <strong>Suggested:</strong>{" "}
                  {rec.recommended?.length ? rec.recommended.join(", ") : "—"}
                </div>

                {rec.basis?.length ? (
                  <>
                    <div style={{ marginTop: 10, fontWeight: 600 }}>Top similar runs</div>
                    <ul>
                      {rec.basis.map((r) => (
                        <li key={r.id}>
                          {r.date} — {r.temperature}°F, wind {r.wind ?? "?"} — comfort {r.comfort_rating} —{" "}
                          {r.clothing?.join(", ") || "no clothing logged"}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
          </section>

          <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
            <h2>Recent Runs</h2>
            {recentRuns.length === 0 ? (
              <div>No unlogged recent runs. Get back out there!</div>
            ) : (
              <ul>
                {recentRuns.map((r) => (
                  <li key={r.id} style={{ marginBottom: 8 }}>
                    <strong>{r.date}</strong> — {r.distance} mi — {r.intensity} — {r.temperature}°F — comfort{" "}
                    {r.comfort_rating} — {r.clothing?.join(", ") || "no clothing"}
                    {r.notes ? ` — (${r.notes})` : ""}

                    <button type="button" onClick={() => openEditModal(r)} style={{ marginLeft: 8 }}>
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    {editOpen && editForm && (
      <div
        onClick={() => {
          setEditOpen(false);
          setEditForm(null);
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          zIndex: 9999
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(720px, 100%)",
            background: "#fff",
            borderRadius: 12,
            padding: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label>
                Date
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  style={{ width: "100%" }}
                />
              </label>

              <label>
                Distance (mi)
                <input
                  type="number"
                  step="0.1"
                  value={editForm.distance}
                  onChange={(e) => setEditForm({ ...editForm, distance: Number(e.target.value) })}
                  style={{ width: "100%" }}
                />
              </label>

              <label>
                Intensity
                <select
                  value={editForm.intensity}
                  onChange={(e) => setEditForm({ ...editForm, intensity: e.target.value })}
                  style={{ width: "100%" }}
                >
                  <option value="easy">easy</option>
                  <option value="moderate">moderate</option>
                  <option value="hard">hard</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label>
                Temp (°F)
                <input
                  type="number"
                  value={editForm.temperature}
                  onChange={(e) => setEditForm({ ...editForm, temperature: Number(e.target.value) })}
                  style={{ width: "100%" }}
                />
              </label>

              <label>
                Wind (mph)
                <input
                  type="number"
                  value={editForm.wind}
                  onChange={(e) => setEditForm({ ...editForm, wind: Number(e.target.value) })}
                  style={{ width: "100%" }}
                />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
                <input
                  type="checkbox"
                  checked={!!editForm.sunny}
                  onChange={(e) => setEditForm({ ...editForm, sunny: e.target.checked })}
                />
                Sunny
              </label>
            </div>

            <label>
              Comfort (1=freezing, 3=good, 5=too hot)
              <input
                type="range"
                min="1"
                max="5"
                value={editForm.comfort_rating}
                onChange={(e) => setEditForm({ ...editForm, comfort_rating: Number(e.target.value) })}
              />
              <div>Selected: {editForm.comfort_rating}</div>
            </label>

            <label>
              Notes
              <input
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <div>
              <div style={{ marginBottom: 8 }}>Clothing</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {CLOTHING_OPTIONS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => toggleEditClothing(item)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid #ddd",
                      background: editForm.clothing?.includes(item) ? "#111" : "#fff",
                      color: editForm.clothing?.includes(item) ? "#fff" : "#111",
                      cursor: "pointer"
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => deleteRun(editForm.id)}
                style={{ background: "#fff", border: "1px solid #ddd" }}
              >
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
                <button type="button" onClick={saveEdit}>
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
