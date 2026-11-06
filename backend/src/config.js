require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || 'postgres://upsc:upsc@localhost:5433/upsc',
  elasticUrl: process.env.ES_URL || 'http://localhost:9200',
  esIndex: process.env.ES_INDEX || 'brainmap_nodes',
  storage: {
    // 'local' (filesystem - default) or 'minio' (S3-compatible object store, optional)
    backend: process.env.STORAGE_BACKEND || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || './storage',
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'upsc-notes',
    },
  },
  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  // DeepSeek is used for chat: Q&A and brain-map generation (both OpenAI-compatible).
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  },
  // Google Gemini (exposed through its OpenAI-compatible endpoint).
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  },
};
