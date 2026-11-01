const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const router = express.Router();

const BASE = 'https://epaper.thehindu.com/ccidist-ws/th/th_international';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://epaper.thehindu.com/',
};
const CHROME = process.env.EPAPER_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = process.env.EPAPER_PROFILE_DIR || path.join(__dirname, '..', '..', '.epaper-profile');

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

async function downloadPdf(issue, folder) {
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
    args: ['--no-sandbox'],
  });
  try {
    const page = context.pages()[0] || await context.newPage();
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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
    await ensureLoginClosed();
    loginBrowser = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath: CHROME,
      headless: false,
      acceptDownloads: true,
    });
    const page = loginBrowser.pages()[0] || await loginBrowser.newPage();
    await page.goto('https://epaper.thehindu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    res.json({
      ok: true,
      message: 'A browser window opened — log in to The Hindu, then close the window and retry the download.',
    });
  } catch (e) {
    next(e);
  }
});

// Download e-paper(s) for a single date or a range
router.post('/download', async (req, res, next) => {
  try {
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

module.exports = router;
