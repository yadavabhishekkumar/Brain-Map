const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };

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
  createCanvas: (name) => request('/canvases', { method: 'POST', body: JSON.stringify({ name }) }),
  getCanvas: (id) => request(`/canvases/${id}`),
  updateCanvas: (id, data) => request(`/canvases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCanvas: (id) => request(`/canvases/${id}`, { method: 'DELETE' }),

  createNode: (canvasId, data) => request(`/canvases/${canvasId}/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (id, data) => request(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNode: (id) => request(`/nodes/${id}`, { method: 'DELETE' }),
  getNode: (id) => request(`/nodes/${id}`),

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

  askAI: (nodeId, question) => request('/ai/ask', { method: 'POST', body: JSON.stringify({ node_id: nodeId, question }) }),

  aiBuild: (canvasId, prompt, nodeId) =>
    request('/ai/build', { method: 'POST', body: JSON.stringify({ canvas_id: canvasId, prompt, node_id: nodeId || null }) }),

  applyAIAnswer: (nodeId, text, action, mode = 'append') =>
    request('/ai/apply', {
      method: 'POST',
      body: JSON.stringify({ node_id: nodeId, text, action, mode, author: 'You' }),
    }),

  listChats: (nodeId) => request(`/nodes/${nodeId}/chats`),

  downloadEpaper: (payload) => request('/epaper/download', { method: 'POST', body: JSON.stringify(payload) }),

  epaperLogin: () => request('/epaper/login', { method: 'POST', body: JSON.stringify({}) }),
};

export const fileUrl = (id) => `${API_BASE}/attachments/${id}/file`;
