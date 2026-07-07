// In production the frontend is served by the same Express app as the API,
// so requests can just be same-origin (empty base). In dev, Vite runs on its
// own port and needs the backend's actual address.
export const API_BASE = import.meta.env.PROD ? "" : "http://localhost:3001";
