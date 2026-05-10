import { apiFetch } from "./api.js";

export async function fetchNews(symbol) {
  return apiFetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
}
