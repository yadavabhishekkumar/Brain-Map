import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import MicButton from './MicButton';

export default function AuthPage({ onAuthed, onClose }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const onAuthedRef = useRef(onAuthed);
  onAuthedRef.current = onAuthed;

  const doAuthed = (r) => onAuthedRef.current(r.token, r.user);

  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      const r = mode === 'signup'
        ? await api.signup(email, password, name)
        : await api.login(email, password);
      doAuthed(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (!window.google || !window.google.accounts) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (resp) => {
          if (!resp || !resp.credential) return;
          setBusy(true);
          setError('');
          try {
            const r = await api.googleLogin(resp.credential);
            doAuthed(r);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
      });
      const el = document.getElementById('google-signin-btn');
      if (el) {
        window.google.accounts.id.renderButton(el, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
        });
      }
    };
    document.head.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <button className="btn btn-ghost auth-close" onClick={onClose} title="Close">✕</button>
        <h2>🧠 UPSC Brain Map</h2>
        <p className="muted">{mode === 'signup' ? 'Create your private account' : 'Sign in to access your private maps'}</p>

        <div className="auth-tabs">
          <button className={`btn btn-sm${mode === 'login' ? ' btn-primary' : ''}`} onClick={() => { setMode('login'); setError(''); }}>
            Sign in
          </button>
          <button className={`btn btn-sm${mode === 'signup' ? ' btn-primary' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>
            Sign up
          </button>
        </div>

        {mode === 'signup' && (
          <div className="voice-field">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <MicButton onText={(t) => setName((v) => (v ? v + ' ' + t : t))} />
          </div>
        )}
        <input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input
          className="auth-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" onClick={submit} disabled={busy || !email.trim() || !password}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {googleClientId ? (
          <>
            <div className="auth-divider"><span>or</span></div>
            <div id="google-signin-btn" className="auth-google" />
          </>
        ) : (
          <p className="muted auth-hint">Google sign-in isn't configured yet (set VITE_GOOGLE_CLIENT_ID).</p>
        )}
      </div>
    </div>
  );
}
