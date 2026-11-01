import { Fragment } from 'react';

function inline(text) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return <em key={i}>{p.slice(1, -1)}</em>;
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i}>{p.slice(1, -1)}</code>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

// Light markdown renderer: headings, horizontal rules, bullets, numbered lists, bold/italic/code.
export function renderMarkdown(text) {
  const lines = String(text || '').split('\n');
  return lines.map((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      return (
        <div key={i} className={`md-heading md-h${h[1].length}`}>
          {inline(h[2])}
        </div>
      );
    }
    if (/^---+$/.test(line.trim())) {
      return <hr key={i} className="md-hr" />;
    }
    if (/^[-*•▪◦]\s+/.test(line)) {
      return (
        <div key={i} className="md-li">
          <span className="md-bullet">•</span>
          {inline(line.replace(/^[-*•▪◦]\s+/, ''))}
        </div>
      );
    }
    if (/^\d{1,2}[.)]\s+/.test(line)) {
      return (
        <div key={i} className="md-li md-num">
          {inline(line)}
        </div>
      );
    }
    if (line.trim() === '') {
      return <div key={i} className="md-space" />;
    }
    return (
      <div key={i} className="md-p">
        {inline(line)}
      </div>
    );
  });
}
