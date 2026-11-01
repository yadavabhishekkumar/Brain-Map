const axios = require('axios');
const config = require('./config');

// Elasticsearch is accessed over its REST API via axios (no Node-18-only client needed).
const base = config.elasticUrl.replace(/\/+$/, '');

async function request(method, path, body) {
  const opts = { method, url: `${base}${path}`, timeout: 8000 };
  if (body !== undefined) opts.data = body;
  const resp = await axios(opts);
  return resp.data;
}

async function indexExists() {
  try {
    await request('GET', `/${config.esIndex}`);
    return true;
  } catch (e) {
    if (e.response && e.response.status === 404) return false;
    throw e;
  }
}

async function ensureIndex() {
  if (await indexExists()) return;
  await request('PUT', `/${config.esIndex}`, {
    mappings: {
      properties: {
        canvas_id: { type: 'keyword' },
        label: { type: 'text', fields: { keyword: { type: 'keyword' } } },
        content: { type: 'text' },
        extracted: { type: 'text' },
        depth: { type: 'integer' },
        updated_at: { type: 'date' },
      },
    },
  });
}

async function indexNode(doc) {
  await request('PUT', `/${config.esIndex}/_doc/${encodeURIComponent(doc.id)}`, {
    canvas_id: doc.canvas_id,
    label: doc.label,
    content: doc.content || '',
    extracted: doc.extracted || '',
    depth: doc.depth || 0,
    updated_at: new Date().toISOString(),
  });
}

async function removeNode(id) {
  try {
    await request('DELETE', `/${config.esIndex}/_doc/${encodeURIComponent(id)}`);
  } catch (e) {
    // 404 is fine — the document was already gone
  }
}

async function search(q, canvasId) {
  const must = [
    { multi_match: { query: q, fields: ['label^3', 'content^2', 'extracted'], type: 'best_fields' } },
  ];
  if (canvasId) must.push({ term: { canvas_id: canvasId } });

  const data = await request('POST', `/${config.esIndex}/_search`, {
    query: { bool: { must } },
    highlight: {
      fields: { label: {}, content: {}, extracted: {} },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },
    size: 50,
  });

  const rawHits = (data.hits && data.hits.hits) || [];
  const hits = rawHits.map((h) => ({
    id: h._id,
    canvas_id: h._source.canvas_id,
    label: h._source.label,
    content: h._source.content,
    depth: h._source.depth,
    score: h._score,
    highlight: h.highlight || {},
  }));

  return {
    hits,
    total: data.hits && data.hits.total ? data.hits.total.value : hits.length,
  };
}

module.exports = { ensureIndex, indexNode, removeNode, search };
