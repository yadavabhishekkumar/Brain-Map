const axios = require('axios');
const config = require('./config');

const VISION_PROMPT =
  'You are an OCR and note-extraction assistant for UPSC exam preparation. ' +
  'Extract ALL text from the given handwritten or printed note/screenshot exactly as written. ' +
  'Preserve the logical structure: use markdown headings (#, ##) for section titles, ' +
  'bullet points (-) for list items, and keep paragraphs on their own lines. ' +
  'Do not summarize or add commentary. Return only the extracted text.';

async function extractWithVision(buffer, mimeType) {
  const b64 = buffer.toString('base64');
  const url = `${config.ai.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model: config.ai.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0,
  };
  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${config.ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });
  const text = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
  return (text && text.content ? text.content : '').trim();
}

async function extractWithTesseract(buffer) {
  // Lazy require so the heavy OCR engine is only loaded when needed.
  const Tesseract = require('tesseract.js');
  const result = await Tesseract.recognize(buffer, 'eng');
  return (result && result.data && result.data.text ? result.data.text : '').trim();
}

async function extractText(buffer, mimeType, mode = 'auto') {
  if (mode === 'ocr') return extractWithTesseract(buffer);

  if (mode === 'ai') {
    if (!config.ai.apiKey) {
      throw new Error('No OPENAI_API_KEY configured. Set it in your .env to use the AI vision model.');
    }
    return extractWithVision(buffer, mimeType);
  }

  // auto: prefer the AI vision model, fall back to local OCR
  if (config.ai.apiKey) {
    try {
      return await extractWithVision(buffer, mimeType);
    } catch (e) {
      console.warn('[ai] vision failed, falling back to OCR:', e.message);
    }
  }
  return extractWithTesseract(buffer);
}

// Resolve a chat provider from the user-selected model id.
function resolveChatProvider(provider) {
  switch (provider) {
    case 'gemini':
      return {
        name: 'gemini',
        key: config.gemini.apiKey,
        baseUrl: config.gemini.baseUrl,
        model: config.gemini.model,
        supportsEffort: false,
        // Gemini 2.5/3.x are "thinking" models and reject `temperature` (400).
        supportsTemperature: false,
      };
    case 'deepseek-reasoner':
      return {
        name: 'deepseek-reasoner',
        key: config.deepseek.apiKey,
        baseUrl: config.deepseek.baseUrl,
        model: 'deepseek-reasoner',
        supportsEffort: false,
        supportsTemperature: false,
      };
    case 'deepseek':
    default:
      return {
        name: 'deepseek',
        key: config.deepseek.apiKey,
        baseUrl: config.deepseek.baseUrl,
        model: config.deepseek.model,
        supportsEffort: true,
        supportsTemperature: true,
      };
  }
}

async function chatCompletion(messages, options = {}) {
  const provider = resolveChatProvider(options.provider);
  if (!provider.key) {
    throw new Error(`No API key configured for "${provider.name}". Add it to backend/.env.`);
  }
  const model = options.model || provider.model;
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model,
    messages,
    max_tokens: options.maxTokens || 2000,
  };
  // DeepSeek V4 models accept an "effort" level (low / high / max).
  if (provider.supportsEffort && options.effort) payload.effort = options.effort;
  // Reasoner models don't accept temperature; the others do.
  if (provider.supportsTemperature && !options.effort) {
    payload.temperature = options.temperature !== undefined ? options.temperature : 0.2;
  }
  if (options.json) payload.response_format = { type: 'json_object' };

  try {
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
      timeout: 180000,
    });

    const content =
      resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
        ? resp.data.choices[0].message.content
        : '';
    return { content: String(content || '').trim(), raw: resp.data };
  } catch (e) {
    if (e.response && e.response.data) {
      console.error('[ai] provider error:', JSON.stringify(e.response.data).slice(0, 1000));
    }
    throw e;
  }
}

module.exports = { extractText, extractWithVision, extractWithTesseract, chatCompletion };
