// Lightweight, dependency-free LaTeX -> HTML renderer.
//
// AI answers (DeepSeek etc.) frequently return math in LaTeX form, e.g.
//   $v_1 = \begin{bmatrix} 3 \\ 0 \\ 0 \end{bmatrix}$
//   $$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$
//
// This module converts those dollar-sign / backslash / brace-laden strings into
// readable, styled HTML + Unicode so they display as real formulas. It only
// depends on the browser (no KaTeX/MathJax), matching the project's tiny custom
// markdown renderer.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SYMBOLS = {
  // Greek lowercase
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Greek uppercase (only where different from Latin)
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // operators / relations
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈',
  sim: '∼', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', nexists: '∄',
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  wp: '℘', aleph: 'ℵ',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', mapsto: '↦',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺',
  uparrow: '↑', downarrow: '↓', updownarrow: '↕', Uparrow: '⇑', Downarrow: '⇓',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…',
  circ: '∘', bullet: '•', degree: '°', prime: '′',
  angle: '∠', parallel: '∥', perp: '⊥', bot: '⊥', top: '⊤',
  therefore: '∴', because: '∵', square: '□', triangle: '△',
  land: '∧', lor: '∨', lnot: '¬', neg: '¬', wedge: '∧', vee: '∨',
  oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  mid: '|', colon: ':', '|': '‖',
};

// Commands that render as upright words (functions / operators).
const FUNCTIONS = {
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', coth: 'coth',
  log: 'log', ln: 'ln', lg: 'lg', exp: 'exp',
  lim: 'lim', limsup: 'lim sup', liminf: 'lim inf', sup: 'sup', inf: 'inf',
  min: 'min', max: 'max', det: 'det', dim: 'dim', ker: 'ker', gcd: 'gcd',
  hom: 'hom', arg: 'arg', deg: 'deg', Pr: 'Pr', mod: 'mod',
};

// Accents -> combining Unicode character.
const ACCENTS = {
  hat: '\u0302', widehat: '\u0302', tilde: '\u0303', widetilde: '\u0303',
  bar: '\u0304', vec: '\u20D7', dot: '\u0307', ddot: '\u0308',
  check: '\u030C', breve: '\u0306', acute: '\u0301', grave: '\u0300',
};
// Spacing commands -> rendered width.
const SPACES = {
  ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: '  ', qquad: '    ',
  enskip: ' ', enspace: ' ', thinspace: ' ', smallskip: ' ', medskip: ' ',
};

// Math-alphabet commands -> CSS class applied to their argument.
const MATH_ALPHABET = {
  mathbf: 'mbold', boldsymbol: 'mbold', bm: 'mbold', mathrm: 'mrm',
  mathit: 'mit', mathsf: 'msf', mathtt: 'mtt', mathbb: 'mbb',
  mathcal: 'mcal', mathfrak: 'mfrak',
};

// Matrix / aligned environments -> CSS bracket class.
const BRACKET = {
  matrix: 'mtx-none', smallmatrix: 'mtx-none', array: 'mtx-none', aligned: 'mtx-none',
  pmatrix: 'mtx-paren', bmatrix: 'mtx-square', Bmatrix: 'mtx-curly',
  vmatrix: 'mtx-bar', Vmatrix: 'mtx-doublebar', cases: 'mtx-cases',
};

// Escaped literal characters: \{ \} \% \$ \& \# \_ \^ \~ and backslash-space.
const ESC_CHARS = {
  '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '{': '{', '}': '}',
  '^': '^', '~': '~', ' ': ' ',
};

const SIZING = /^(big|Big|bigg|Bigg|Biggl|Biggr|bigl|bigr|bigm)(l|r|m)?$/;
const TEXT_CMDS = new Set([
  'text', 'textbf', 'textrm', 'textnormal', 'textit', 'textsf', 'texttt', 'operatorname',
]);
const IGNORED = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'not',
  'nonumber', 'label', 'tag', 'hfill', 'phantom', 'hphantom', 'vphantom',
]);
// Read a {braced group} starting at pos; returns inner text and index after '}'.
function readGroupAt(str, pos) {
  let depth = 0;
  let j = pos;
  const m = str.length;
  while (j < m) {
    if (str[j] === '{') depth++;
    else if (str[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
    j++;
  }
  return { inner: str.slice(pos + 1, j), next: Math.min(j + 1, m) };
}

// Split a matrix/array body on top-level '\\' (row) or '&' (col), respecting
// brace groups and nested \begin/\end environments.
function splitTopLevel(str, sep) {
  const parts = [];
  let braceDepth = 0;
  let matDepth = 0;
  let cur = '';
  let k = 0;
  const m = str.length;
  while (k < m) {
    const c = str[k];
    if (c === '\\') {
      if (str.startsWith('\\begin{', k) || str.startsWith('\\end{', k)) {
        const close = str.indexOf('}', k);
        if (str.startsWith('\\begin{', k)) matDepth++;
        else matDepth--;
        if (close !== -1) {
          cur += str.slice(k, close + 1);
          k = close + 1;
        } else {
          cur += str.slice(k);
          k = m;
        }
        continue;
      }
      if (sep === 'row' && matDepth === 0 && braceDepth === 0 && str.startsWith('\\\\', k)) {
        parts.push(cur);
        cur = '';
        k += 2;
        continue;
      }
      cur += c;
      k++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    if (sep === 'col' && matDepth === 0 && braceDepth === 0 && c === '&') {
      parts.push(cur);
      cur = '';
      k++;
      continue;
    }
    cur += c;
    k++;
  }
  parts.push(cur);
  return parts;
}
// Convert a single math-mode string (no surrounding $) into an HTML string.
export function renderLatexHtml(math) {
  const src = String(math == null ? '' : math);

  function parseSeq(str) {
    let k = 0;
    const n = str.length;
    let out = '';

    function readCommand() {
      // str[k] === '\\'
      let j = k + 1;
      let name = '';
      if (j < n && /[a-zA-Z]/.test(str[j])) {
        while (j < n && /[a-zA-Z]/.test(str[j])) {
          name += str[j];
          j++;
        }
      } else if (j < n) {
        name = str[j];
        j++;
      }
      k = j;
      return name;
    }

    // Parse one argument: a braced group, a command, or a single character.
    function parseArg() {
      if (str[k] === '{') {
        const { inner, next } = readGroupAt(str, k);
        k = next;
        return parseSeq(inner);
      }
      if (str[k] === '\\') {
        const name = readCommand();
        return handleCommand(name);
      }
      const c = str[k] == null ? '' : str[k];
      k++;
      return esc(c);
    }

    // Raw braced argument for \text{...} (content NOT parsed as math).
    function rawBraced() {
      if (str[k] === '{') {
        const { inner, next } = readGroupAt(str, k);
        k = next;
        return esc(inner);
      }
      const c = str[k] == null ? '' : str[k];
      k++;
      return esc(c);
    }

    function findMatchingEnd(env) {
      const beginMarker = '\\begin{' + env + '}';
      const endMarker = '\\end{' + env + '}';
      let depth = 1;
      let p = k;
      while (p < n) {
        const beginIdx = str.indexOf(beginMarker, p);
        const endIdx = str.indexOf(endMarker, p);
        if (endIdx === -1) return n;
        if (beginIdx !== -1 && beginIdx < endIdx) {
          depth++;
          p = beginIdx + 1;
          continue;
        }
        depth--;
        if (depth === 0) return endIdx;
        p = endIdx + 1;
      }
      return n;
    }

    function parseMatrix() {
      const { inner: env, next } = readGroupAt(str, k);
      k = next;
      const endIdx = findMatchingEnd(env);
      const content = str.slice(k, endIdx);
      k = endIdx === n ? n : endIdx + ('\\end{' + env + '}').length;

      const cls = BRACKET[env] || 'mtx-square';
      const rowHtml = splitTopLevel(content, 'row')
        .map((row) => {
          const tds = splitTopLevel(row, 'col')
            .map((cell) => `<td>${parseSeq(cell.trim())}</td>`)
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      return `<span class="mtx ${cls}"><table class="mtx-table">${rowHtml}</table></span>`;
    }

    function handleCommand(name) {
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = parseArg();
        const den = parseArg();
        return `<span class="mfrac"><span class="mfrac-top">${num}</span><span class="mfrac-bot">${den}</span></span>`;
      }
      if (name === 'sqrt') {
        let idxHtml = '';
        if (str[k] === '[') {
          const close = str.indexOf(']', k + 1);
          idxHtml = parseSeq(str.slice(k + 1, close === -1 ? n : close));
          k = close === -1 ? n : close + 1;
        }
        const body = parseArg();
        return (
          `<span class="msqrt">` +
          (idxHtml ? `<sup class="msqrt-idx">${idxHtml}</sup>` : '') +
          `<span class="msqrt-sign">√</span>` +
          `<span class="msqrt-over">${body}</span></span>`
        );
      }
      if (name === 'begin') return parseMatrix();
      if (name === 'end') {
        if (str[k] === '{') {
          const { next } = readGroupAt(str, k);
          k = next;
        }
        return '';
      }
      if (TEXT_CMDS.has(name)) {
        const bold = name === 'textbf';
        return `<span class="${bold ? 'mtext mtext-bf' : 'mtext'}">${rawBraced()}</span>`;
      }
      if (MATH_ALPHABET[name]) {
        return `<span class="${MATH_ALPHABET[name]}">${parseArg()}</span>`;
      }
      if (ACCENTS[name]) {
        return parseArg() + ACCENTS[name];
      }
      if (name === 'overline' || name === 'underline') {
        return `<span class="${name}">${parseArg()}</span>`;
      }
      if (name in SPACES) return SPACES[name];
      if (name === '\\') return ' ';
      if (SIZING.test(name)) {
        if (str[k] === '.') k++;
        return '';
      }
      if (name in ESC_CHARS) return ESC_CHARS[name];
      if (name in FUNCTIONS) return `<span class="mrm">${FUNCTIONS[name]}</span> `;
      if (name in SYMBOLS) return SYMBOLS[name];
      if (IGNORED.has(name)) return '';
      return `<span class="munknown">${esc(name)}</span>`;
    }

    while (k < n) {
      const ch = str[k];
      if (ch === '~') {
        out += ' ';
        k++;
        continue;
      }
      if (ch === '&' || ch === '}') {
        k++;
        continue;
      }

      let atom;
      if (ch === '{') {
        const { inner, next } = readGroupAt(str, k);
        k = next;
        atom = parseSeq(inner);
      } else if (ch === '\\') {
        atom = handleCommand(readCommand());
      } else {
        atom = esc(ch);
        k++;
      }

      if (atom === '') continue;

      // Apply trailing sub/superscripts to the atom just parsed.
      while (k < n && (str[k] === '_' || str[k] === '^')) {
        const isSub = str[k] === '_';
        k++;
        const arg = parseArg();
        atom += isSub ? `<sub>${arg}</sub>` : `<sup>${arg}</sup>`;
      }

      out += atom;
    }
    return out;
  }

  return parseSeq(src);
}
// Split text into display-math ($$...$$) and text segments (newlines preserved).
export function splitDisplayMath(text) {
  const s = String(text || '');
  const out = [];
  let i = 0;
  let buf = '';
  const n = s.length;
  while (i < n) {
    if (s[i] === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end !== -1) {
        if (buf) {
          out.push({ type: 'text', value: buf });
          buf = '';
        }
        out.push({ type: 'display', value: s.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  if (buf) out.push({ type: 'text', value: buf });
  return out;
}

// Split a single line into inline-math ($...$) and text segments.
export function splitInlineMath(line) {
  const s = String(line || '');
  const out = [];
  let i = 0;
  let buf = '';
  const n = s.length;
  while (i < n) {
    if (s[i] === '$' && s[i + 1] !== '$') {
      const end = s.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1) {
        if (buf) {
          out.push({ type: 'text', value: buf });
          buf = '';
        }
        out.push({ type: 'inline', value: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  if (buf) out.push({ type: 'text', value: buf });
  return out;
}






