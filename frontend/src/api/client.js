const TOKEN_KEY = 'lp_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = body instanceof FormData;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, { method, headers, body: isForm ? body : body && JSON.stringify(body) });
  if (res.status === 401 && token && !path.startsWith('/auth')) onUnauthorized();
  if (raw && res.ok) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.map((d) => d.message || `${d.field}: invalid`).join(', ');
    throw new ApiError(res.status, detail ? `${data.error}: ${detail}` : data.error || 'Request failed', data.details);
  }
  return data;
}
