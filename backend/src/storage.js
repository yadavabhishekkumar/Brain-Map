const fs = require('fs');
const path = require('path');
const config = require('./config');

let minioClient = null;

function useLocal() {
  return config.storage.backend === 'local';
}

function getMinio() {
  if (!minioClient) {
    const Minio = require('minio');
    const m = config.storage.minio;
    minioClient = new Minio.Client({
      endPoint: m.endPoint,
      port: m.port,
      useSSL: m.useSSL,
      accessKey: m.accessKey,
      secretKey: m.secretKey,
    });
  }
  return minioClient;
}

async function ensureBucket() {
  const mc = getMinio();
  const bucket = config.storage.minio.bucket;
  const exists = await mc.bucketExists(bucket);
  if (!exists) await mc.makeBucket(bucket);
}

async function init() {
  if (useLocal()) {
    fs.mkdirSync(config.storage.localDir, { recursive: true });
  } else {
    await ensureBucket();
  }
}

async function put(key, buffer, contentType) {
  if (useLocal()) {
    const file = path.join(config.storage.localDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return key;
  }
  const mc = getMinio();
  await mc.putObject(config.storage.minio.bucket, key, buffer, buffer.length, {
    'Content-Type': contentType || 'application/octet-stream',
  });
  return key;
}

async function getBuffer(key) {
  if (useLocal()) {
    return fs.readFileSync(path.join(config.storage.localDir, key));
  }
  const mc = getMinio();
  const stream = await mc.getObject(config.storage.minio.bucket, key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function getStream(key) {
  if (useLocal()) {
    return {
      stream: fs.createReadStream(path.join(config.storage.localDir, key)),
      contentType: 'application/octet-stream',
    };
  }
  const mc = getMinio();
  const stream = await mc.getObject(config.storage.minio.bucket, key);
  let contentType = 'application/octet-stream';
  try {
    const stat = await mc.statObject(config.storage.minio.bucket, key);
    if (stat && stat.metaData && stat.metaData['content-type']) {
      contentType = stat.metaData['content-type'];
    }
  } catch (e) {
    // ignore stat failures
  }
  return { stream, contentType };
}

async function remove(key) {
  if (useLocal()) {
    const file = path.join(config.storage.localDir, key);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const mc = getMinio();
  try {
    await mc.removeObject(config.storage.minio.bucket, key);
  } catch (e) {
    // ignore
  }
}

module.exports = { init, put, getBuffer, getStream, remove, useLocal };
