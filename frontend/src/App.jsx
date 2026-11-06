import { useCallback, useEffect, useState } from 'react';
import CanvasList from './components/CanvasList';
import BrainMapCanvas from './components/BrainMapCanvas';
import Epaper from './components/Epaper';
import AuthPage from './components/AuthPage';
import { api } from './api';
import { getUser, setAuth, clearAuth, getToken } from './auth';

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

// Parse the URL hash into a view. Routes:
//   #/                       -> list
//   #/epaper                 -> epaper
//   #/canvas/<id>/<name>     -> canvas
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('canvas/')) {
    const rest = raw.slice('canvas/'.length);
    const slash = rest.indexOf('/');
    const id = slash === -1 ? rest : rest.slice(0, slash);
    const name = slash === -1 ? '' : safeDecode(rest.slice(slash + 1));
    if (id) return { type: 'canvas', id, name };
    return { type: 'list' };
  }
  if (raw.startsWith('epaper')) return { type: 'epaper' };
  return { type: 'list' };
}

export default function App() {
  const [view, setView] = useState(parseHash);
  const [user, setUser] = useState(getUser());
  const [showAuth, setShowAuth] = useState(false);

  // Validate any stored token on load.
  useEffect(() => {
    if (getToken()) {
      api.me().then((r) => setUser(r.user)).catch(() => { clearAuth(); setUser(null); });
    }
  }, []);

  // Keep state in sync with the URL (browser back/forward, manual hash edits).
  useEffect(() => {
    const onHashChange = () => setView(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next) => {
    if (next.type === 'canvas') {
      window.location.hash = `#/canvas/${next.id}/${encodeURIComponent(next.name || '')}`;
    } else if (next.type === 'epaper') {
      window.location.hash = '#/epaper';
    } else {
      window.location.hash = '#/';
    }
    setView(next);
  };

  const handleAuthed = useCallback((token, authedUser) => {
    setAuth(token, authedUser);
    setUser(authedUser);
    setShowAuth(false);
  }, []);

  const handleSignOut = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  if (showAuth) {
    return <AuthPage onAuthed={handleAuthed} onClose={() => setShowAuth(false)} />;
  }

  if (view.type === 'canvas') {
    return (
      <BrainMapCanvas
        canvasId={view.id}
        canvasName={view.name}
        onBack={() => navigate({ type: 'list' })}
        onOpenCanvas={(id, name) => navigate({ type: 'canvas', id, name })}
      />
    );
  }

  if (view.type === 'epaper') {
    return (
      <Epaper
        onBack={() => navigate({ type: 'list' })}
        onOpenCanvas={(id, name) => navigate({ type: 'canvas', id, name })}
      />
    );
  }

  return (
    <CanvasList
      user={user}
      onOpen={(id, name) => navigate({ type: 'canvas', id, name })}
      onOpenEpaper={() => navigate({ type: 'epaper' })}
      onSignIn={() => setShowAuth(true)}
      onSignOut={handleSignOut}
    />
  );
}
