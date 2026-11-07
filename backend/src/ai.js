const axios = require('axios');
const config = require('./config');
const { pool } = require('./db');
const { uuid } = require('./util');

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
        supportsResponseFormat: true,
      };
    case 'deepseek-reasoner':
      return {
        name: 'deepseek-reasoner',
        key: config.deepseek.apiKey,
        baseUrl: config.deepseek.baseUrl,
        model: 'deepseek-reasoner',
        supportsEffort: false,
        supportsTemperature: false,
        // Reasoner does not support structured JSON output, and caps output lower.
        supportsResponseFormat: false,
        maxTokensCap: 8000,
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
        supportsResponseFormat: true,
      };
  }
}

// Record per-user AI token usage (fire-and-forget; never blocks a response).
function recordUsage(userId, provider, model, promptTokens, completionTokens, totalTokens) {
  if (!userId) return;
  try {
    pool
      .query(
        'INSERT INTO ai_usage (id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [uuid(), userId, provider, model, promptTokens || 0, completionTokens || 0, totalTokens || 0]
      )
      .catch(() => {});
  } catch (e) {
    // ignore
  }
}

async function chatCompletion(messages, options = {}) {
  const provider = resolveChatProvider(options.provider);
  if (!provider.key) {
    throw new Error(`No API key configured for "${provider.name}". Add it to backend/.env.`);
  }
  const model = options.model || provider.model;
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let maxTokens = options.maxTokens || 2000;
  if (provider.maxTokensCap) maxTokens = Math.min(maxTokens, provider.maxTokensCap);
  const payload = {
    model,
    messages,
    max_tokens: maxTokens,
  };
  // DeepSeek V4 models accept an "effort" level (low / high / max).
  if (provider.supportsEffort && options.effort) payload.effort = options.effort;
  // Reasoner models don't accept temperature; the others do.
  if (provider.supportsTemperature && !options.effort) {
    payload.temperature = options.temperature !== undefined ? options.temperature : 0.2;
  }
  if (options.json && provider.supportsResponseFormat) {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
      timeout: 180000,
    });

    const content =
      resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
        ? resp.data.choices[0].message.content
        : '';
    if (options.userId && resp.data && resp.data.usage) {
      recordUsage(
        options.userId,
        provider.name,
        model,
        resp.data.usage.prompt_tokens,
        resp.data.usage.completion_tokens,
        resp.data.usage.total_tokens
      );
    }
    return { content: String(content || '').trim(), raw: resp.data };
  } catch (e) {
    if (e.response && e.response.data) {
      console.error('[ai] provider error:', JSON.stringify(e.response.data).slice(0, 1000));
    }
    throw e;
  }
}

module.exports = { extractText, extractWithVision, extractWithTesseract, chatCompletion };
