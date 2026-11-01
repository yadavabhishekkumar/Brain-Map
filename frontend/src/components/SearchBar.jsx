import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export default function SearchBar({ canvasId, onFocus, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      const query = q.trim();
      if (!query) {
        setResults([]);
        setSearched(false);
        return;
      }
      setLoading(true);
      setSearched(true);
      try {
        const r = await api.search(query, canvasId);
        setResults(r.hits || []);
      } catch (e) {
        console.error(e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, canvasId]);

  return (
    <div className="search-overlay">
      <div className="search-box">
        <div className="search-input-row">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search topics, notes & extracted text…"
          />
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="search-results">
          {loading && <div className="muted">Searching…</div>}
          {!loading && searched && results.length === 0 && (
            <div className="muted">No matching topics.</div>
          )}
          {results.map((r) => (
            <div key={r.id} className="search-result" onClick={() => onFocus(r.id)}>
              <div
                className="search-result-label"
                dangerouslySetInnerHTML={{
                  __html: r.highlight && r.highlight.label ? r.highlight.label[0] : escapeHtml(r.label),
                }}
              />
              {(r.highlight && r.highlight.content && r.highlight.content[0]) && (
                <div
                  className="search-result-snippet"
                  dangerouslySetInnerHTML={{ __html: r.highlight.content[0] }}
                />
              )}
              {(r.highlight && r.highlight.extracted && r.highlight.extracted[0]) && (
                <div
                  className="search-result-snippet search-result-extracted"
                  dangerouslySetInnerHTML={{ __html: r.highlight.extracted[0] }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
