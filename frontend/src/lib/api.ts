// URL du backend FastAPI. À définir via NEXT_PUBLIC_API_URL en production.
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
