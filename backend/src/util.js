const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

/**
 * Parse extracted note text into a flat list of { label, level } entries.
 * Handles markdown headings, bullets and numbered lists, plus indentation.
 */
function parseExtractedText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const nodes = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let level = 0;
    let label = trimmed;

    const heading = label.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      level = heading[1].length - 1;
      label = heading[2].trim();
    } else if (/^[-*•▪◦▫]\s*/.test(label)) {
      label = label.replace(/^[-*•▪◦▫]\s*/, '').trim();
      level = 1;
    } else if (/^\d{1,2}[.)]\s*/.test(label)) {
      label = label.replace(/^\d{1,2}[.)]\s*/, '').trim();
      level = 1;
    } else {
      const indent = (rawLine.match(/^\s*/) || [''])[0].length;
      level = Math.floor(indent / 2);
    }

    if (!label) continue;
    nodes.push({ label: label.slice(0, 300), level });
  }
  return nodes;
}

module.exports = { uuid, sanitizeFilename, parseExtractedText };
