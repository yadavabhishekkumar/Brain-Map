import { Fragment } from 'react';
import { renderLatexHtml, splitDisplayMath, splitInlineMath } from './latex';

// Render one line of text, handling **bold**, *italic*, `code` and $inline math$.
function inline(text) {
  const out = [];
  let key = 0;
  for (const seg of splitInlineMath(text)) {
    if (seg.type === 'inline') {
      out.push(
        <span
          key={key++}
          className="math-inline"
          dangerouslySetInnerHTML={{ __html: renderLatexHtml(seg.value) }}
        />
      );
      continue;
    }
    const parts = String(seg.value || '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    for (const p of parts) {
      if (p.startsWith('**') && p.endsWith('**')) {
        out.push(<strong key={key++}>{p.slice(2, -2)}</strong>);
      } else if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
        out.push(<em key={key++}>{p.slice(1, -1)}</em>);
      } else if (p.startsWith('`') && p.endsWith('`')) {
        out.push(<code key={key++}>{p.slice(1, -1)}</code>);
      } else {
        out.push(<Fragment key={key++}>{p}</Fragment>);
      }
    }
  }
  return out;
}

// Light markdown renderer: headings, rules, bullets, numbered lists, bold/italic/code,
// plus LaTeX math ($$...$$ display blocks and $...$ inline math).
export function renderMarkdown(text) {
  const blocks = splitDisplayMath(String(text || ''));
  const elements = [];
  let key = 0;

  const pushLine = (line) => {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      elements.push(
        <div key={key++} className={`md-heading md-h${h[1].length}`}>
          {inline(h[2])}
        </div>
      );
      return;
    }
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="md-hr" />);
      return;
    }
    if (/^[-*•▪◦]\s+/.test(line)) {
      elements.push(
        <div key={key++} className="md-li">
          <span className="md-bullet">•</span>
          {inline(line.replace(/^[-*•▪◦]\s+/, ''))}
        </div>
      );
      return;
    }
    if (/^\d{1,2}[.)]\s+/.test(line)) {
      elements.push(
        <div key={key++} className="md-li md-num">
          {inline(line)}
        </div>
      );
      return;
    }
    if (line.trim() === '') {
      elements.push(<div key={key++} className="md-space" />);
      return;
    }
    elements.push(
      <div key={key++} className="md-p">
        {inline(line)}
      </div>
    );
  };

  for (const block of blocks) {
    if (block.type === 'display') {
      elements.push(
        <div
          key={key++}
          className="math-display"
          dangerouslySetInnerHTML={{ __html: renderLatexHtml(block.value) }}
        />
      );
      continue;
    }
    block.value.split('\n').forEach(pushLine);
  }
  return elements;
}
