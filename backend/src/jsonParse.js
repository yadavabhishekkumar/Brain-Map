'use strict';

// Helpers for turning an LLM response into a JSON tree. Responses can arrive
// wrapped in markdown fences, prefixed/suffixed with prose, or truncated
// mid-object when the model runs out of output tokens. These functions try to
// salvage a usable object in all of those cases.

// Pull the JSON text out of markdown fences and any surrounding prose.
function extractJsonText(text) {
  let t = String(text || '').trim();
  // Prefer content inside a ```json ... ``` fence if present.
  const fence = t.match(/```[a-zA-Z]*[\r\n]*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // Otherwise strip a single leading/trailing fence pair.
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  return t.trim();
}

// Return the first balanced JSON object in the text (respecting strings and
// escapes), or the text from the first '{' onward if no balanced close exists.
function extractJsonObject(text) {
  const t = extractJsonText(text);
  const start = t.indexOf('{');
  if (start === -1) throw new Error('No JSON object found');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return t.slice(start);
}

// Best-effort repair of truncated JSON: drop a trailing partial key/value and
// close any open braces/brackets so JSON.parse can succeed.
function repairTruncatedJson(text) {
  let s = String(text || '').trim();
  const start = s.indexOf('{');
  if (start > 0) s = s.slice(start);

  // Drop a trailing comma or colon (an incomplete key or value separator).
  s = s.replace(/[,:]\s*$/, '');

  // If we ended inside a string value, remove the dangling fragment.
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
  }
  if (inString) {
    const idx = s.lastIndexOf('"');
    s = s.slice(0, idx);
    // Drop the now-dangling `"key":` that pointed at the removed value.
    s = s.replace(/,\s*"[^"]*"\s*:\s*$/, '');
    s = s.replace(/[,:]\s*$/, '');
  }

  // Close any remaining open braces/brackets in reverse order.
  const stack = [];
  inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  while (stack.length) s += stack.pop();
  return s;
}

// Parse a model response into a tree root object, salvaging truncated JSON.
function parseTree(content) {
  let data;
  try {
    data = JSON.parse(extractJsonObject(content));
  } catch (e) {
    data = JSON.parse(repairTruncatedJson(content));
  }
  const root = data && data.root ? data.root : data;
  if (!root || typeof root !== 'object') throw new Error('unexpected structure');
  return root;
}

module.exports = { parseTree, extractJsonText, extractJsonObject, repairTruncatedJson };
