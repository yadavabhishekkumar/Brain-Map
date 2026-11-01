import { useEffect, useState } from 'react';
import { api } from '../api';

export default function FocusSearch({ canvasId, onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      const query = q.trim();
      if (!query) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const r = await api.search(query, canvasId);
        setResults(r.hits || []);
        setOpen(true);
      } catch (e) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, canvasId]);

  const choose = (id) => {
    onSelect(id);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="focus-search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search topics to focus…"
        onFocus={() => q.trim() && setOpen(true)}
      />
      {open && (
        <div className="focus-search-dropdown">
          {loading && <div className="focus-search-empty">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="focus-search-empty">No matching topics</div>
          )}
          {results.map((r) => (
            <div key={r.id} className="focus-search-result" onClick={() => choose(r.id)}>
              <div className="focus-search-label">{r.label}</div>
              {r.content ? <div className="focus-search-snippet">{r.content.slice(0, 80)}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
