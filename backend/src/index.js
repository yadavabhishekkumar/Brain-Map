const express = require('express');
const cors = require('cors');
const config = require('./config');
const { initSchema } = require('./db');
const es = require('./es');
const storage = require('./storage');

async function main() {
  await initSchema();
  await storage.init();
  try {
    await es.ensureIndex();
  } catch (e) {
    console.warn('[es] index init failed (is Elasticsearch running?):', e.message);
  }

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
