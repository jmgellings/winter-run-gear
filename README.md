# LayerLog

Plan it, run it, log it. LayerLog is a small running companion that:

- recommends what to wear for an upcoming run, based on the conditions and comfort ratings of your own past runs
- imports your recent activities from Strava and backfills real weather (temp/wind/sunny) for each one from its GPS + timestamp
- shows your next few upcoming workouts from a Runna training calendar

It's designed to be self-hosted, one instance per person — there's no shared multi-user backend, so your data and your Strava connection stay entirely on your own deployment.

## Prerequisites

- Node.js 20+
- A free [Strava](https://strava.com) account and your own Strava API application (see below — every instance needs its own, you can't reuse someone else's)
- (Optional) A [Runna](https://runna.com) training plan, if you want the upcoming-workouts import

## 1. Create your own Strava API app

Strava requires each application to have its own registered credentials.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an application (any name/website works for personal use).
2. Note the **Client ID** and **Client Secret** it gives you.
3. Set **Authorization Callback Domain** to wherever this will run — `localhost` for local development, or your deployed domain (e.g. `yourapp.up.railway.app`) once you've deployed it.

You can revisit this later if you deploy after first running it locally — just update the callback domain to match.

## 2. Get your Runna calendar URL

1. In the Runna app, go to Settings and find the calendar export/sync option (label varies by app version — look for "Calendar Sync" or "Export").
2. Copy the link it gives you. It's usually a `webcal://...` URL — change that prefix to `https://` before pasting it into LayerLog.
3. Paste it into the "Next Workouts (Runna)" box on the Plan tab. It's remembered in your browser after that.

## Local development

```bash
git clone https://github.com/jmgellings/winter-run-gear.git
cd winter-run-gear

cp backend/.env.example backend/.env
# edit backend/.env and fill in STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET
# (STRAVA_REDIRECT_URI is already set correctly for local dev)

npm install --prefix backend
npm install --prefix frontend

npm start --prefix backend      # http://localhost:3001
npm run dev --prefix frontend   # http://localhost:5173
```

Open `http://localhost:5173` — the frontend talks to the backend on `:3001` automatically in dev.

## Deploying your own instance (Railway)

The app deploys as a single Railway service: Express serves both the API and the built frontend, so there's only one service to run and one bill.

1. Push this repo to your own GitHub account (fork it, or clone and push to a new repo of your own).
2. Create a new [Railway](https://railway.app) project and connect that repo. Railway detects the root `package.json` and uses the build/start commands in `railway.json` automatically.
3. Add a **Volume**, mounted at `/data` (service canvas → "+ Add" → Volume, attach it to this service). This is what keeps `runs.db` from disappearing on every redeploy — without it, your data resets each time you push a change.
4. Add environment variables under the service's **Variables** tab:
   - `STRAVA_CLIENT_ID`
   - `STRAVA_CLIENT_SECRET`
   - `DB_PATH=/data/runs.db`
5. Generate a public domain (service → Settings → Networking → Generate Domain). If it asks for a port, use `8080`.
6. Set `STRAVA_REDIRECT_URI=https://<your-domain>/auth/strava/callback`, using the domain from step 5.
7. Update your Strava app's **Authorization Callback Domain** (strava.com/settings/api) to that same bare domain (no `https://`, no path).
8. Visit your domain, click **Connect Strava**, and log your first run.

Cost is usage-based on Railway's hobby tier — roughly a few dollars a month for an app this size.

## Environment variables

See [`backend/.env.example`](backend/.env.example) for the full list.

## Notes & limitations

- Data lives in a single SQLite file. This is built for one person per deployment, not a shared multi-tenant service.
- Weather auto-fill (both for planning and for Strava-imported runs) uses [Open-Meteo](https://open-meteo.com), which only has reliable data for roughly the last 2–3 months — older Strava activities won't get weather backfilled.
- Runna has no public API. The calendar import relies on its ICS export link, so it's a pasted URL, not an OAuth connection — there's nothing to "log in" to on the Runna side.
- Strava's API rate limits (100 requests/15 min, 1000/day by default) apply per app. Fine for personal use; if you ever expand this beyond your own instance, keep that in mind.

## License

MIT — see [LICENSE](LICENSE).
