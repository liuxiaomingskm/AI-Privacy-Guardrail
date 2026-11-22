/*
 * AI Privacy Guardrail — redaction engine
 * Pure functions, no DOM access. Works in the browser (window.Guardrail)
 * and in Node (require('./guardrail.js')).
 *
 * Copyright (c) 2026 liuxiaomingskm — MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Guardrail = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Luhn checksum, used to tell real card numbers from random digit runs. */
  function luhn(digits) {
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  const onlyDigits = (s) => s.replace(/\D/g, '');

  /**
   * Detectors run in this order. An earlier detector "claims" its characters,
   * so later detectors can never split or partially overlap its match.
   *
   * pattern fields:
   *   re     – global RegExp
   *   group  – optional capture group to redact instead of the whole match
   *            (the group must sit at the END of the match)
   *   check  – optional validator (value) => boolean
   */
  const DETECTORS = [
    {
      id: 'secret',
      label: 'API key / secret',
      prefix: 'SECRET',
      patterns: [
        { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g },
        { re: /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{20,}/g }, // OpenAI / Anthropic / OpenRouter style
        { re: /\bAKIA[0-9A-Z]{16}\b/g }, // AWS access key id
        { re: /\bAIza[0-9A-Za-z_-]{35}\b/g }, // Google API key
        { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g }, // GitHub tokens
        { re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
        { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g }, // GitLab
        { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g }, // Slack
        { re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g }, // Stripe
        { re: /\bhf_[A-Za-z0-9]{30,}\b/g }, // Hugging Face
        { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g }, // JWT
        { re: /\bBearer\s+([A-Za-z0-9._~+\/-]{16,}=*)/g, group: 1 },
        {
          // NAME_WITH_SECRET=value  /  "api_key": "value"
          re: /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([^\s"',;]{8,})/gi,
          group: 1,
        },
      ],
    },
    {
      id: 'email',
      label: 'Email',
      prefix: 'EMAIL',
      normalize: (v) => v.toLowerCase(),
      patterns: [{ re: /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g }],
    },
    {
      id: 'card',
      label: 'Credit card',
      prefix: 'CARD',
      normalize: onlyDigits,
      patterns: [
        {
          re: /\b(?:\d[ -]?){12,18}\d\b/g,
          check: (v) => {
            const d = onlyDigits(v);
            return d.length >= 13 && d.length <= 19 && luhn(d);
          },
        },
      ],
    },
    {
      id: 'ssn',
      label: 'US SSN',
      prefix: 'SSN',
      patterns: [{ re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g }],
    },
    {
      id: 'ip',
      label: 'IP address',
      prefix: 'IP',
      patterns: [
        {
          re: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\w|\.\d)/g,
        },
      ],
    },
    {
      id: 'phone',
      label: 'Phone number',
      prefix: 'PHONE',
      normalize: onlyDigits,
      patterns: [
        {
          re: /(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]?\d{3,4}(?!\w)/g,
          check: (v) => {
            const n = onlyDigits(v).length;
            return v.startsWith('+') ? n >= 8 && n <= 15 : n >= 10 && n <= 11;
          },
        },
      ],
    },
  ];

  const TERM = { id: 'term', label: 'Custom term', prefix: 'TERM' };

  // Only the characters that are syntax in a unicode-mode RegExp.
  const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');

  function termRegex(terms, caseSensitive, wholeWord) {
    const list = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
      (a, b) => b.length - a.length
    );
    if (!list.length) return null;
    const body = '(?:' + list.map(escapeRe).join('|') + ')';
    const src = wholeWord ? '(?<![\\p{L}\\p{N}_])' + body + '(?![\\p{L}\\p{N}_])' : body;
    return new RegExp(src, caseSensitive ? 'gu' : 'giu');
  }

  /**
   * Redact sensitive values from `text`.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {Object<string, boolean>} [options.enabled] detector id -> on/off (default: all on)
   * @param {string[]} [options.terms] custom words/phrases to redact
   * @param {boolean} [options.caseSensitive=false] match terms case-sensitively
   * @param {boolean} [options.wholeWord=true] match terms only as whole words
   * @returns {{text: string, items: object[], mapping: Object<string,string>, counts: Object<string,number>}}
   */
  function redact(text, options) {
    const opts = options || {};
    const enabled = opts.enabled || {};
    const isOn = (id) => enabled[id] !== false;
    const taken = new Uint8Array(text.length);
    const spans = [];

    function claim(det, start, end) {
      if (end <= start) return;
      for (let i = start; i < end; i++) if (taken[i]) return;
      taken.fill(1, start, end);
      spans.push({ det, start, end, value: text.slice(start, end) });
    }

    function scan(det, pattern) {
      const re = new RegExp(pattern.re.source, pattern.re.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        let start = m.index;
        let value = m[0];
        if (pattern.group) {
          value = m[pattern.group];
          if (!value) continue;
          start = m.index + m[0].length - value.length;
        }
        if (pattern.check && !pattern.check(value)) continue;
        claim(det, start, start + value.length);
      }
    }

    for (const det of DETECTORS) {
      if (!isOn(det.id)) continue;
      for (const p of det.patterns) scan(det, p);
    }

    const caseSensitive = !!opts.caseSensitive;
    if (isOn('term')) {
      const re = termRegex(opts.terms || [], caseSensitive, opts.wholeWord !== false);
      if (re) {
        const det = Object.assign({}, TERM, {
          normalize: caseSensitive ? (v) => v : (v) => v.toLowerCase(),
        });
        scan(det, { re });
      }
    }

    spans.sort((a, b) => a.start - b.start);

    // Same value -> same placeholder, so the AI can still tell entities apart.
    const seen = new Map();
    const counters = {};
    const counts = {};
    const mapping = {};
    const items = [];
    let out = '';
    let cursor = 0;

    for (const s of spans) {
      const key = s.det.prefix + '\u0000' + (s.det.normalize ? s.det.normalize(s.value) : s.value);
      let placeholder = seen.get(key);
      if (!placeholder) {
        counters[s.det.prefix] = (counters[s.det.prefix] || 0) + 1;
        placeholder = '[' + s.det.prefix + '_' + counters[s.det.prefix] + ']';
        seen.set(key, placeholder);
        mapping[placeholder] = s.value;
      }
      counts[s.det.id] = (counts[s.det.id] || 0) + 1;
      items.push({
        type: s.det.id,
        label: s.det.label,
        value: s.value,
        placeholder,
        start: s.start,
        end: s.end,
      });
      out += text.slice(cursor, s.start) + placeholder;
      cursor = s.end;
    }
    out += text.slice(cursor);

    return { text: out, items, mapping, counts };
  }

  const PLACEHOLDER_RE = /\[(?:SECRET|EMAIL|CARD|SSN|IP|PHONE|TERM)_\d+\]/g;

  /** Put original values back into text (e.g. an AI reply) using a mapping from redact(). */
  function restore(text, mapping) {
    const map = mapping || {};
    return text.replace(PLACEHOLDER_RE, (ph) =>
      Object.prototype.hasOwnProperty.call(map, ph) ? map[ph] : ph
    );
  }

  /** Rough token estimate: ~4 chars per token for Latin text, ~1 per CJK character. */
  function estimateTokens(text) {
    const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    return Math.ceil(cjk + (text.length - cjk) / 4);
  }

  const DETECTOR_INFO = DETECTORS.map(({ id, label, prefix }) => ({ id, label, prefix })).concat([
    { id: TERM.id, label: TERM.label, prefix: TERM.prefix },
  ]);

  return { redact, restore, estimateTokens, luhn, DETECTORS: DETECTOR_INFO, PLACEHOLDER_RE };
});
