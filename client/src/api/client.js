// Single axios instance for all REST calls. The auth token is attached via
// an interceptor rather than manually on every call site.
import axios from 'axios';

// In production the client and the API are served from the same Vercel
// deployment, so a relative '/api' is all that's needed and there's no
// environment variable to forget. Locally, Vite proxies '/api' to the server
// on :4000 (see vite.config.js), so the same value works there too.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('chatter_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
