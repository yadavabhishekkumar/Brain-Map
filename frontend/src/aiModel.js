const KEY = 'upsc_ai_model';
const listeners = new Set();

export const AI_MODELS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  { id: 'gemini', label: 'Gemini' },
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
