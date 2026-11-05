import { useSpeechRecognition } from '../useSpeechRecognition';

export default function MicButton({ onText, label = 'Speak to type' }) {
  const { supported, listening, toggle } = useSpeechRecognition({
    onResult: (text) => {
      if (onText) onText(text);
    },
  });

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`mic-btn${listening ? ' mic-btn-listening' : ''}`}
      title={listening ? 'Listening… click to stop' : label}
      aria-label={label}
      onClick={toggle}
    >
      {listening ? '🔴' : '🎤'}
    </button>
  );
}
