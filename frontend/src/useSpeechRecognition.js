import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper around the browser's built-in Web Speech API (SpeechRecognition).
 * Free — no API key, no server, no usage limits. Supported in Chrome, Edge and
 * Safari. Returns { supported, listening, toggle }.
 */
export function useSpeechRecognition({ onResult, lang = 'en-IN' } = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);
  const langRef = useRef(lang);

  useEffect(() => {
    onResultRef.current = onResult;
    langRef.current = lang;
  });

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);

    const rec = new SR();
    rec.lang = langRef.current || 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) text += result[0].transcript;
      }
      if (text && onResultRef.current) onResultRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    recognitionRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch (e) {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      try {
        rec.start();
        setListening(true);
      } catch (e) {
        setListening(false);
      }
    }
  }, [listening]);

  return { supported, listening, toggle };
}
