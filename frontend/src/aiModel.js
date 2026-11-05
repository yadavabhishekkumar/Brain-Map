const KEY = 'upsc_ai_model';
const listeners = new Set();

export const AI_MODELS = [
  { id: 'deepseek', label: 'DeepSeek', hint: 'Best all-rounder — Q&A, map building, content and structured output.' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', hint: 'Deep reasoning for hard analytical / essay questions. Not for maps or bulk content.' },
  { id: 'gemini', label: 'Gemini', hint: 'General alternative model for Q&A and map building.' },
];

export function getAiModel() {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  return AI_MODELS.some((m) => m.id === v) ? v : 'deepseek';
}

export function setAiModel(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch (e) {
    // ignore
  }
  listeners.forEach((cb) => {
    try {
      cb(id);
    } catch (e) {
      // ignore listener errors
    }
  });
}

export function subscribeAiModel(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
