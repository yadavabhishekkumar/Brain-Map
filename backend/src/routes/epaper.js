const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

const router = express.Router();

const BASE = 'https://epaper.thehindu.com/ccidist-ws/th/th_international';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://epaper.thehindu.com/',
};

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

async function downloadPdf(issue, folder) {
  const url = `${BASE}/issues/${issue.id}/pagespdffull?download=true`;
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180000,
    headers: HEADERS,
  });
  const buf = Buffer.from(resp.data);
  const head = buf.slice(0, 1024).toString('latin1');
  const isPdf = head.indexOf('%PDF') === 0;
  if (!isPdf) {
    const isHtml = /<html|<!doctype/i.test(head);
    throw new Error(
      isHtml
        ? 'The Hindu returned a web page instead of a PDF. The e-paper download now requires the reader app (and likely a subscription).'
        : 'Downloaded content is not a valid PDF.'
    );
  }
  fs.mkdirSync(folder, { recursive: true });
  const dateStr = (issue.publishedDate || '').slice(0, 10);
  const filename = `TheHindu_${dateStr}.pdf`;
  const filePath = path.join(folder, filename);
  fs.writeFileSync(filePath, buf);
  return { filename, filePath, size: buf.length };
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
