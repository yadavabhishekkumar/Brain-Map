import { getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch (e) {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listCanvases: () => request('/canvases'),
  createCanvas: (name, categoryId) =>
    request('/canvases', { method: 'POST', body: JSON.stringify({ name, category_id: categoryId || null }) }),
  getCanvas: (id) => request(`/canvases/${id}`),
  updateCanvas: (id, data) => request(`/canvases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCanvas: (id) => request(`/canvases/${id}`, { method: 'DELETE' }),
  forkCanvas: (id) => request(`/canvases/${id}/fork`, { method: 'POST' }),
  setCanvasVisibility: (id, isPublic) =>
    request(`/canvases/${id}`, { method: 'PUT', body: JSON.stringify({ is_public: isPublic }) }),

  listCategories: () => request('/categories'),
  createCategory: (name) => request('/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCategory: (id, name) => request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  moveCanvases: (canvasIds, categoryId) =>
    request('/canvases/move', {
      method: 'POST',
      body: JSON.stringify({ canvas_ids: canvasIds, category_id: categoryId || null }),
    }),

  signup: (email, password, name) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  googleLogin: (idToken) =>
    request('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
  me: () => request('/auth/me'),

  updateProfile: (name) => request('/auth/me', { method: 'PUT', body: JSON.stringify({ name }) }),

  getStats: () => request('/stats'),

  createNode: (canvasId, data) => request(`/canvases/${canvasId}/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (id, data) => request(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNode: (id) => request(`/nodes/${id}`, { method: 'DELETE' }),
  mergeNode: (id, mode) => request(`/nodes/${id}/merge-into-parent`, { method: 'POST', body: JSON.stringify({ mode }) }),
  getNode: (id) => request(`/nodes/${id}`),
  exportNode: (id) => request(`/nodes/${id}/export`, { method: 'POST' }),

  createEdge: (canvasId, data) => request(`/canvases/${canvasId}/edges`, { method: 'POST', body: JSON.stringify(data) }),
  updateEdge: (id, data) => request(`/edges/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEdge: (id) => request(`/edges/${id}`, { method: 'DELETE' }),

  uploadAttachment: (nodeId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/nodes/${nodeId}/attachments`, { method: 'POST', body: fd });
  },
  extractAttachment: (id, mode = 'auto') =>
    request(`/attachments/${id}/extract`, { method: 'POST', body: JSON.stringify({ mode }) }),
  applyAttachment: (id, action, text) =>
    request(`/attachments/${id}/apply`, { method: 'POST', body: JSON.stringify({ action, text }) }),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),

  search: (q, canvasId) =>
    request(`/search?q=${encodeURIComponent(q)}${canvasId ? `&canvas_id=${encodeURIComponent(canvasId)}` : ''}`),

  linkCanvas: (canvasId, data) => request(`/canvases/${canvasId}/link`, { method: 'POST', body: JSON.stringify(data) }),

  askAI: (nodeId, question, model, context) =>
    request('/ai/ask', { method: 'POST', body: JSON.stringify({ node_id: nodeId, question, model, context: context || '' }) }),

  respond: (prompt, context, model, canvasId) =>
    request('/ai/respond', { method: 'POST', body: JSON.stringify({ prompt, context: context || '', model, canvas_id: canvasId || null }) }),

  aiBuild: (canvasId, prompt, nodeId, model) =>
    request('/ai/build', {
      method: 'POST',
      body: JSON.stringify({ canvas_id: canvasId, prompt, node_id: nodeId || null, model }),
    }),

  applyAIAnswer: (nodeId, text, action, mode = 'append', model) =>
    request('/ai/apply', {
      method: 'POST',
      body: JSON.stringify({ node_id: nodeId, text, action, mode, author: 'You', model }),
    }),

  rearrangeNode: (nodeId, prompt, mode, model) =>
    request('/ai/rearrange', {
      method: 'POST',
      body: JSON.stringify({ node_id: nodeId, prompt, mode, model }),
    }),

  listChats: (nodeId) => request(`/nodes/${nodeId}/chats`),

  listCanvasChats: (canvasId) => request(`/canvases/${canvasId}/chats`),

  downloadEpaper: (payload) => request('/epaper/download', { method: 'POST', body: JSON.stringify(payload) }),

  epaperLogin: () => request('/epaper/login', { method: 'POST', body: JSON.stringify({}) }),

  epaperSaveCookies: (cookies) => request('/epaper/cookies', { method: 'POST', body: JSON.stringify({ cookies }) }),

  epaperGetCookies: () => request('/epaper/cookies'),

  epaperClearCookies: () => request('/epaper/cookies', { method: 'DELETE' }),

  analyzeEpaper: (formData) => request('/epaper/analyze', { method: 'POST', body: formData }),

  importTextToCanvas: (text, canvasName, mode) =>
    request('/ai/import-text', { method: 'POST', body: JSON.stringify({ text, canvas_name: canvasName, mode }) }),
};

export const fileUrl = (id) => `${API_BASE}/attachments/${id}/file`;

// Fetch a downloaded e-paper PDF as a Blob (with auth) and trigger a browser download.
export async function downloadEpaperFile(filePath, filename) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/epaper/file?path=${encodeURIComponent(filePath)}`, { headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch (e) {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'epaper.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
