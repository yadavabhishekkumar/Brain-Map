const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const ai = require('../ai');
const { authRequired } = require('../services/auth');

const router = express.Router();
router.use(authRequired);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const BASE = 'https://epaper.thehindu.com/ccidist-ws/th/th_international';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://epaper.thehindu.com/',
};
// Resolve a usable Chrome/Chromium executable across platforms. The interactive
// "Login / refresh session" flow launches a *visible* browser on the machine that
// runs the backend, so it only works when the app is hosted on a desktop with Chrome.
const CHROME_CANDIDATES = [
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function findChrome() {
  if (process.env.EPAPER_CHROME_PATH) return process.env.EPAPER_CHROME_PATH;
  // Playwright-managed Chromium (installed via `npx playwright install chromium`).
  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (e) {}
  return (
    CHROME_CANDIDATES.find((p) => {
      try {
        return fs.existsSync(p);
      } catch (e) {
        return false;
      }
    }) || null
  );
}

const CHROME = findChrome();
const PROFILE_DIR = process.env.EPAPER_PROFILE_DIR || path.join(__dirname, '..', '..', '.epaper-profile');

const NO_CHROME_HINT =
  'The e-paper downloader needs Google Chrome installed on the machine that runs the backend. ' +
  'This server has no Chrome, so this feature cannot run here. To use it, run the app locally on ' +
  'your own computer (where Chrome is installed), or set EPAPER_CHROME_PATH to a Chrome/Chromium ' +
  'executable on the server.';

// --- Saved session cookies (for headless/cloud login) ---
const COOKIES_FILE = process.env.EPAPER_COOKIES_FILE || path.join(PROFILE_DIR, 'cookies.json');

function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {}
  return [];
}

function saveCookies(cookies) {
  fs.mkdirSync(path.dirname(COOKIES_FILE), { recursive: true });
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
}

function mapSameSite(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'no_restriction' || s === 'none') return 'None';
  if (s === 'strict') return 'Strict';
  return 'Lax';
}

function isHinduDomain(d) {
  const s = String(d || '').toLowerCase();
  return s.endsWith('thehindu.com') || s.endsWith('thehindu.in');
}

// Parse a pasted cookie blob into Playwright cookie objects. Accepts, in order of
// detection: a JSON array (Cookie-Editor / EditThisCookie export), a Netscape
// cookies.txt export, a `curl` command ("Copy as cURL"), or a plain
// "Cookie: name=value; name2=value2" header string.
function parseCookies(input) {
  const text = String(input || '').trim();
  if (!text) return [];

  // 1) JSON array export
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      const mapped = arr
        .filter((c) => c && c.name && isHinduDomain(c.domain))
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          expires: c.expirationDate
            ? Math.round(Number(c.expirationDate))
            : c.expires
              ? Math.round(new Date(c.expires).getTime() / 1000)
              : -1,
          httpOnly: !!c.httpOnly,
          secure: !!c.secure,
          sameSite: mapSameSite(c.sameSite),
        }));
      if (mapped.length) return mapped;
    } catch (e) {
      // fall through
    }
  }

  // 2) Netscape cookies.txt export (tab-separated rows)
  if (text.includes('\t')) {
    const cookies = [];
    for (const line of text.split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw) continue;
      if (raw.startsWith('#') && !raw.startsWith('#HttpOnly_')) continue;
      const isHttpOnly = raw.startsWith('#HttpOnly_');
      const parts = (isHttpOnly ? raw.slice('#HttpOnly_'.length) : raw).split('\t');
      if (parts.length < 6) continue;
      const domain = (parts[0] || '').trim();
      const pathPart = (parts[2] || '').trim();
      const secure = String(parts[3] || '').trim().toUpperCase() === 'TRUE';
      const expiry = (parts[4] || '').trim();
      const name = (parts[5] || '').trim();
      const value = (parts.slice(6).join('\t') || '').trim();
      if (!name || !isHinduDomain(domain)) continue;
      cookies.push({
        name,
        value,
        domain,
        path: pathPart || '/',
        expires: expiry && expiry !== '0' ? Number(expiry) : -1,
        httpOnly: isHttpOnly,
        secure,
        sameSite: 'Lax',
      });
    }
    if (cookies.length) return cookies;
  }

  // 3) `curl` command ("Copy as cURL (bash)") — extract the Cookie header(s).
  const curlChunks = [];
  for (const m of text.matchAll(/(?:-H|--header)\s+['"]cookie:\s*([^'"]+)['"]/gi)) curlChunks.push(m[1]);
  for (const m of text.matchAll(/(?:-b|--cookie)\s+['"]([^'"]+)['"]/gi)) curlChunks.push(m[1]);
  if (curlChunks.length) {
    const cookies = [];
    for (const chunk of curlChunks) {
      for (const part of chunk.split(';')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) {
          cookies.push({ name, value, domain: '.thehindu.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' });
        }
      }
    }
    if (cookies.length) return cookies;
  }

  // 4) Plain header / raw "name=value; name2=value2"
  let t = text.replace(/^Cookie\s*:/i, '');
  const cookies = [];
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) {
      cookies.push({ name, value, domain: '.thehindu.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' });
    }
  }
  return cookies;
}

let loginBrowser = null;

function toDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function resolveIssue(date) {
  const url = `${BASE}/issues?fromDate=${date}&toDate=${date}`;
  const resp = await axios.get(url, { timeout: 30000, headers: HEADERS });
  const web = resp.data && resp.data.issues && resp.data.issues.web;
  return web && web.length ? web[0] : null;
}

async function ensureLoginClosed() {
  if (loginBrowser) {
    try {
      await loginBrowser.close();
    } catch (e) {}
    loginBrowser = null;
  }
}

function isPdf(buf) {
  return buf && buf.length > 4 && buf.slice(0, 5).toString('ascii').startsWith('%PDF');
}

async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return (data && data.text ? data.text : '').replace(/\r\n/g, '\n').trim();
}

async function downloadPdf(issue, folder) {
  if (!CHROME) throw new Error(NO_CHROME_HINT);
  await ensureLoginClosed();
  const url = `${BASE}/issues/${issue.id}/pagespdffull?download=true`;
  const dateStr = (issue.publishedDate || '').slice(0, 10);
  const filename = `TheHindu_${dateStr}.pdf`;
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, filename);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME,
    headless: true,
    acceptDownloads: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  try {
    const cookies = loadCookies();
    if (cookies.length) {
      try {
        await context.addCookies(cookies);
      } catch (e) {
        console.warn('[epaper] could not apply saved cookies:', e.message);
      }
    }
    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    let pdfBuffer = null;
    let downloadObj = null;
    page.on('response', async (resp) => {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (ct.includes('pdf')) {
        try {
          const b = await resp.body();
          if (isPdf(b)) pdfBuffer = b;
        } catch (e) {}
      }
    });
    page.on('download', (d) => {
      downloadObj = d;
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      // A download-triggered navigation aborts with net::ERR_ABORTED — expected.
    }

    const start = Date.now();
    while (!downloadObj && !pdfBuffer && Date.now() - start < 60000) {
      await page.waitForTimeout(500);
    }

    if (downloadObj) {
      await downloadObj.saveAs(filePath);
    } else if (pdfBuffer) {
      fs.writeFileSync(filePath, pdfBuffer);
    } else {
      throw new Error(
        'Could not download the PDF — you may need to log in first. Use the "Login" button, sign in to The Hindu, then retry.'
      );
    }
    return { filename, filePath, size: fs.statSync(filePath).size };
  } finally {
    await context.close();
  }
}

// Resolve a date -> issue (preview without downloading)
router.get('/resolve', async (req, res, next) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    const issue = await resolveIssue(date);
    if (!issue) return res.status(404).json({ error: `No e-paper found for ${date}` });
    res.json({ date, issueId: issue.id, title: issue.title, publishedDate: issue.publishedDate });
  } catch (e) {
    next(e);
  }
});

// Open a browser window so the user can log in once (session is reused afterwards)
router.post('/login', async (req, res, next) => {
  try {
    if (!CHROME) {
      return res.status(400).json({ error: NO_CHROME_HINT });
    }
    await ensureLoginClosed();
    try {
      loginBrowser = await chromium.launchPersistentContext(PROFILE_DIR, {
        executablePath: CHROME,
        headless: false,
        acceptDownloads: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    } catch (launchErr) {
      return res.status(400).json({
        error:
          'Could not open a browser window on the server: ' +
          launchErr.message +
          ' — this login step needs a desktop with Chrome and cannot run on a headless/cloud server.',
      });
    }
    const page = loginBrowser.pages()[0] || await loginBrowser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.goto('https://epaper.thehindu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    res.json({
      ok: true,
      message: 'A browser window opened — log in to The Hindu, then close the window and retry the download.',
    });
  } catch (e) {
    next(e);
  }
});

// --- Session cookie management (headless/cloud login) ---
router.post('/cookies', async (req, res, next) => {
  try {
    const { cookies } = req.body || {};
    const parsed = parseCookies(cookies);
    if (!parsed.length) {
      return res.status(400).json({
        error:
          'No cookies could be read. Log in at epaper.thehindu.com first, then paste one of these:\n' +
          '• a "Cookie: name=value; …" header,\n' +
          '• a cookies.txt export (from the "Get cookies.txt LOCALLY" extension), or\n' +
          '• a JSON cookie array (from the Cookie-Editor extension).',
      });
    }
    saveCookies(parsed);
    res.json({ ok: true, count: parsed.length, names: parsed.map((c) => c.name) });
  } catch (e) {
    next(e);
  }
});

// Report whether a session has been saved (never returns secret values).
router.get('/cookies', (req, res) => {
  const cookies = loadCookies();
  res.json({ ok: true, count: cookies.length, names: cookies.map((c) => c.name) });
});

// Clear the saved session.
router.delete('/cookies', (req, res) => {
  try {
    if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
  } catch (e) {}
  res.json({ ok: true });
});

// Download e-paper(s) for a single date or a range
router.post('/download', async (req, res, next) => {
  try {
    if (!CHROME) return res.status(400).json({ error: NO_CHROME_HINT });
    const { date, fromDate, toDate, folder } = req.body || {};
    const targetFolder = (folder || '').trim() || path.join(os.homedir(), 'HinduEpaper');

    const dates = [];
    if (date) {
      dates.push(date);
    } else if (fromDate && toDate) {
      const from = new Date(`${fromDate}T00:00:00`);
      const to = new Date(`${toDate}T00:00:00`);
      if (isNaN(from) || isNaN(to) || from > to) {
        return res.status(400).json({ error: 'Invalid date range' });
      }
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(toDateStr(d));
      }
    } else {
      return res.status(400).json({ error: 'Provide either "date" or "fromDate"+"toDate"' });
    }

    const downloaded = [];
    const skipped = [];
    for (const d of dates) {
      try {
        const issue = await resolveIssue(d);
        if (!issue) {
          skipped.push({ date: d, reason: 'No issue published for this date' });
          continue;
        }
        const result = await downloadPdf(issue, targetFolder);
        downloaded.push({ date: d, ...result });
      } catch (e) {
        skipped.push({ date: d, reason: e.message });
      }
    }

    res.json({ ok: true, folder: targetFolder, downloaded, skipped });
  } catch (e) {
    next(e);
  }
});

// Stream a downloaded PDF back to the device (for mobile/cloud use).
router.get('/file', async (req, res, next) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    // Resolve and validate the path to prevent directory traversal.
    const resolved = path.resolve(String(filePath));
    const home = path.resolve(os.homedir());
    const appRoot = path.resolve(__dirname, '..', '..');
    const allowed = [home, appRoot].some(
      (root) => resolved === root || resolved.startsWith(root + path.sep)
    );
    if (!allowed || !resolved.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (e) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!stat.isFile()) return res.status(404).json({ error: 'File not found' });

    res.download(resolved, path.basename(resolved), (err) => {
      if (err && !res.headersSent) next(err);
      else if (err) console.error('[epaper] stream error:', err.message);
    });
  } catch (e) {
    next(e);
  }
});

// Parse a PDF (upload or file path) and analyze its text with DeepSeek.
router.post('/analyze', upload.single('file'), async (req, res, next) => {
  try {
    const { prompt, model, effort, filePath } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt is required' });

    let buffer;
    if (req.file) {
      buffer = req.file.buffer;
    } else if (filePath) {
      buffer = fs.readFileSync(filePath);
    } else {
      return res.status(400).json({ error: 'Provide a PDF file or a filePath' });
    }

    const text = await extractPdfText(buffer);
    if (!text) {
      return res.status(422).json({ error: 'Could not extract text from this PDF (it may be image-only).' });
    }

    const modelName = model || 'deepseek-v4-pro';
    const effortLevel = effort || 'high';

    const messages = [
      {
        role: 'system',
        content:
          'You are a UPSC exam preparation assistant. Analyze the provided e-paper text according to the user prompt. ' +
          'Base your answer only on the provided text and present it clearly and completely.',
      },
      { role: 'user', content: `E-paper content:\n\n${text}\n\n---\n\n${prompt.trim()}` },
    ];

    const r = await ai.chatCompletion(messages, {
      model: modelName,
      effort: effortLevel,
      maxTokens: 20000,
    });

    res.json({
      analysis: r.content,
      extractedLength: text.length,
      truncated: false,
      chunked: false,
      chunks: 1,
      preview: text.slice(0, 800),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
