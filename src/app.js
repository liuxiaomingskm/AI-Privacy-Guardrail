/* AI Privacy Guardrail — UI layer. Copyright (c) 2026 liuxiaomingskm — MIT License */
(function () {
  'use strict';
  const G = window.Guardrail;
  const $ = (id) => document.getElementById(id);

  const el = {
    detectors: $('detectors'),
    terms: $('terms'),
    wholeWord: $('wholeWord'),
    caseSensitive: $('caseSensitive'),
    input: $('input'),
    output: $('output'),
    inputMeta: $('inputMeta'),
    outputMeta: $('outputMeta'),
    copyBtn: $('copyBtn'),
    sampleBtn: $('sampleBtn'),
    clearBtn: $('clearBtn'),
    findings: $('findings'),
    reveal: $('reveal'),
    reply: $('reply'),
    restored: $('restored'),
    copyRestoredBtn: $('copyRestoredBtn'),
    toast: $('toast'),
  };

  const SETTINGS_KEY = 'ai-privacy-guardrail:settings';
  const state = { enabled: {}, last: null };

  // Only detector toggles and term options are remembered — never text or terms.
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.enabled = s.enabled || {};
      if (typeof s.wholeWord === 'boolean') el.wholeWord.checked = s.wholeWord;
      if (typeof s.caseSensitive === 'boolean') el.caseSensitive.checked = s.caseSensitive;
    } catch (_) { /* storage unavailable: use defaults */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        enabled: state.enabled,
        wholeWord: el.wholeWord.checked,
        caseSensitive: el.caseSensitive.checked,
      }));
    } catch (_) { /* ignore */ }
  }

  function buildDetectorChips() {
    for (const d of G.DETECTORS) {
      const label = document.createElement('label');
      label.className = 'chip';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.enabled[d.id] !== false;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `var(--t-${d.id})`;
      label.append(box, dot, document.createTextNode(d.label));
      label.classList.toggle('off', !box.checked);
      box.addEventListener('change', () => {
        state.enabled[d.id] = box.checked;
        label.classList.toggle('off', !box.checked);
        saveSettings();
        render();
      });
      el.detectors.append(label);
    }
  }

  const typeByPrefix = Object.fromEntries(G.DETECTORS.map((d) => [d.prefix, d.id]));

  /** Render text into a container, wrapping placeholders in colored spans. */
  function renderWithPlaceholders(container, text) {
    container.textContent = '';
    const frag = document.createDocumentFragment();
    const re = new RegExp(G.PLACEHOLDER_RE.source, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const span = document.createElement('span');
      const prefix = m[0].slice(1, m[0].lastIndexOf('_'));
      span.className = 'ph ph-' + (typeByPrefix[prefix] || 'term');
      span.textContent = m[0];
      frag.append(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    container.append(frag);
  }

  const fmt = (n) => n.toLocaleString();
  const parseTerms = (s) => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);

  function render() {
    const text = el.input.value;
    const res = G.redact(text, {
      enabled: state.enabled,
      terms: parseTerms(el.terms.value),
      wholeWord: el.wholeWord.checked,
      caseSensitive: el.caseSensitive.checked,
    });
    state.last = res;

    renderWithPlaceholders(el.output, res.text);
    el.copyBtn.disabled = !text;
    el.inputMeta.textContent = `${fmt(text.length)} chars · ≈${fmt(G.estimateTokens(text))} tokens`;

    const n = res.items.length;
    const unique = Object.keys(res.mapping).length;
    el.outputMeta.textContent = n
      ? `${n} item${n === 1 ? '' : 's'} redacted (${unique} unique) · ≈${fmt(G.estimateTokens(res.text))} tokens`
      : text ? 'No sensitive data found' : 'Nothing redacted yet';

    renderFindings(res);
    renderRestore();
  }

  function renderFindings(res) {
    el.findings.textContent = '';
    const rows = Object.entries(res.mapping);
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Redacted items will be listed here.';
      el.findings.append(p);
      return;
    }
    const occurrences = {};
    const labels = {};
    for (const it of res.items) {
      occurrences[it.placeholder] = (occurrences[it.placeholder] || 0) + 1;
      labels[it.placeholder] = it;
    }
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const h of ['Placeholder', 'Type', 'Original', 'Times']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.append(th);
    }
    const body = table.createTBody();
    for (const [ph, value] of rows) {
      const tr = body.insertRow();
      const c1 = tr.insertCell();
      const tag = document.createElement('span');
      tag.className = 'ph ph-' + labels[ph].type;
      tag.textContent = ph;
      c1.append(tag);
      tr.insertCell().textContent = labels[ph].label;
      const c3 = tr.insertCell();
      c3.className = 'mono';
      c3.textContent = el.reveal.checked ? value : mask(value);
      tr.insertCell().textContent = occurrences[ph];
    }
    el.findings.append(table);
  }

  function mask(v) {
    if (v.length <= 4) return '•'.repeat(v.length);
    return v.slice(0, 2) + '•'.repeat(Math.min(v.length - 4, 12)) + v.slice(-2);
  }

  function renderRestore() {
    const reply = el.reply.value;
    const mapping = state.last ? state.last.mapping : {};
    el.restored.textContent = '';
    el.copyRestoredBtn.disabled = !reply;
    if (!reply) return;
    const re = new RegExp(G.PLACEHOLDER_RE.source, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(reply)) !== null) {
      if (m.index > last) el.restored.append(reply.slice(last, m.index));
      if (Object.prototype.hasOwnProperty.call(mapping, m[0])) {
        const span = document.createElement('span');
        span.className = 'restored-val';
        span.title = m[0];
        span.textContent = mapping[m[0]];
        el.restored.append(span);
      } else {
        el.restored.append(m[0]);
      }
      last = m.index + m[0].length;
    }
    if (last < reply.length) el.restored.append(reply.slice(last));
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copied');
  }

  const SAMPLE = [
    'Incident #4821 — checkout errors since 2026-11-20 09:15 UTC',
    '',
    'Reported by: Dana Whitfield <dana.whitfield@northwind.example>',
    'Callback: +1 (415) 555-0132',
    'Affected node: 10.24.8.17 (version 3.14.2)',
    '',
    'Config snippet:',
    '  STRIPE_SECRET_KEY=demo-not-a-real-key-7f3a9c',
    '  OPENAI_API_KEY=sk-proj-ExampleKeyDoNotUse1234567890',
    '',
    'Customer card on file: 4111 1111 1111 1111',
    'Dana asked to loop in dana.whitfield@northwind.example on the fix for Project Bluebird.',
  ].join('\n');

  // --- wiring ---
  loadSettings();
  buildDetectorChips();
  el.output.dataset.empty = 'Redacted text appears here.';
  el.restored.dataset.empty = 'Restored reply appears here.';

  let pending = 0;
  const schedule = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(render);
  };
  el.input.addEventListener('input', schedule);
  el.terms.addEventListener('input', schedule);
  el.wholeWord.addEventListener('change', () => { saveSettings(); render(); });
  el.caseSensitive.addEventListener('change', () => { saveSettings(); render(); });
  el.reveal.addEventListener('change', () => state.last && renderFindings(state.last));
  el.reply.addEventListener('input', renderRestore);

  el.sampleBtn.addEventListener('click', () => {
    el.input.value = SAMPLE;
    if (!el.terms.value.trim()) el.terms.value = 'Dana Whitfield, Project Bluebird';
    render();
  });
  el.clearBtn.addEventListener('click', () => {
    el.input.value = '';
    el.reply.value = '';
    render();
    el.input.focus();
  });
  el.copyBtn.addEventListener('click', () => state.last && copy(state.last.text));
  el.copyRestoredBtn.addEventListener('click', () => copy(G.restore(el.reply.value, state.last ? state.last.mapping : {})));

  render();
})();
