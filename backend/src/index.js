const express = require('express');
const cors = require('cors');
const config = require('./config');
const { initSchema } = require('./db');
const es = require('./es');
const storage = require('./storage');
const path = require('path');
const fs = require('fs');

async function main() {
  await initSchema();
  await storage.init();
  // Elasticsearch is optional — don't block startup on it. On the free Render
  // plan an unreachable ES cluster would otherwise delay the first response by
  // the full request timeout while the service boots.
  es.ensureIndex().catch((e) =>
    console.warn('[es] index init failed (is Elasticsearch running?):', e.message)
  );

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) =>
    res.json({ ok: true, service: 'upsc-brainmap', time: new Date().toISOString() })
  );

  app.use('/api/canvases', require('./routes/canvases'));
  app.use('/api/nodes', require('./routes/nodes'));
  app.use('/api/edges', require('./routes/edges'));
  app.use('/api/attachments', require('./routes/attachments'));
  app.use('/api/search', require('./routes/search'));
  app.use('/api/ai', require('./routes/ai'));
  app.use('/api/epaper', require('./routes/epaper'));

  // --- Serve the built frontend (single-service production deployment) ---
  // During a Render deploy the Vite frontend is built into frontend/dist, and
  // we serve it here so the API and UI share a single URL. Running `npm start`
  // locally without a build simply skips this block and keeps using the Vite
  // dev server on :5173.
  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback: any non-API route returns index.html for client-side nav.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`[web] serving frontend from ${frontendDist}`);
  }

  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  app.listen(config.port, () =>
    console.log(`UPSC Brain Map API listening on http://localhost:${config.port}`)
  );
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
