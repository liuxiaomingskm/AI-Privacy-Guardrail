// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, restore, luhn, estimateTokens } = require('../src/guardrail.js');

const r = (text, opts) => redact(text, opts).text;

test('emails get consistent numbered placeholders', () => {
  const out = r('a@x.com wrote to b@y.org, then A@X.com replied');
  assert.equal(out, '[EMAIL_1] wrote to [EMAIL_2], then [EMAIL_1] replied');
});

test('phone numbers in common formats', () => {
  assert.equal(r('Call +1 (555) 123-4567'), 'Call [PHONE_1]');
  assert.equal(r('Call 555-123-4567.'), 'Call [PHONE_1].');
  assert.equal(r('UK: +44 20 7946 0958'), 'UK: [PHONE_1]');
});

test('IPv4 addresses, but not version numbers', () => {
  assert.equal(r('host 10.0.0.12 is down.'), 'host [IP_1] is down.');
  assert.equal(r('upgrade to 1.2.3.4.5'), 'upgrade to 1.2.3.4.5');
  assert.equal(r('bad 999.1.1.1'), 'bad 999.1.1.1');
});

test('credit cards require a valid Luhn checksum', () => {
  assert.equal(r('card 4111 1111 1111 1111'), 'card [CARD_1]');
  assert.equal(r('order 4111 1111 1111 1112'), 'order 4111 1111 1111 1112');
  assert.ok(luhn('79927398713'));
  assert.ok(!luhn('79927398710'));
});

test('US SSNs', () => {
  assert.equal(r('SSN 123-45-6789'), 'SSN [SSN_1]');
  assert.equal(r('not 000-12-3456'), 'not 000-12-3456');
});

test('API keys and secret assignments', () => {
  assert.equal(r('key sk-proj-abcdefghijklmnopqrstuvwx'), 'key [SECRET_1]');
  assert.equal(r('AWS AKIAABCDEFGHIJKLMNOP'), 'AWS [SECRET_1]');
  assert.equal(r('DB_PASSWORD=hunter2hunter2'), 'DB_PASSWORD=[SECRET_1]');
  assert.equal(r('"api_key": "abc123def456"'), '"api_key": "[SECRET_1]"');
  assert.equal(
    r('Authorization: Bearer abcdefghijklmnop1234'),
    'Authorization: Bearer [SECRET_1]'
  );
});

test('ordinary text is left alone', () => {
  const safe = [
    'Released 2026-10-21 at 14:30',
    '2026-10-21T14:30:00Z',
    'Budget $12,500 for 5000-8000 users',
    'Ticket #48213, version 3.14.2, pi 3.14159',
    'id 550e8400-e29b-41d4-a716-446655440000',
    'use std::io and a[1::2]',
  ];
  for (const s of safe) assert.equal(r(s), s, s);
});

test('custom terms: whole word and case-insensitive by default', () => {
  const opts = { terms: ['Project Phoenix', 'Acme'] };
  assert.equal(
    r('project phoenix ships for ACME, not Acmeville', opts),
    '[TERM_1] ships for [TERM_2], not Acmeville'
  );
  assert.equal(r('Acme acme', { terms: ['Acme'], caseSensitive: true }), '[TERM_1] acme');
  assert.equal(r('a.b+c (x)', { terms: ['a.b+c', '(x)'], wholeWord: false }), '[TERM_1] [TERM_2]');
});

test('a term inside an email does not split the email', () => {
  assert.equal(r('mail jane@acme.com', { terms: ['acme'] }), 'mail [EMAIL_1]');
});

test('detectors can be switched off', () => {
  assert.equal(r('a@x.com 10.0.0.1', { enabled: { email: false } }), 'a@x.com [IP_1]');
});

test('restore puts original values back', () => {
  const input = 'Email jane@acme.com from 10.0.0.1';
  const { text, mapping } = redact(input);
  const reply = `I emailed ${text.match(/\[EMAIL_\d\]/)[0]} and left [IP_9] alone.`;
  assert.equal(restore(text, mapping), input);
  assert.equal(restore(reply, mapping), 'I emailed jane@acme.com and left [IP_9] alone.');
});

test('items and counts describe what was redacted', () => {
  const res = redact('x@y.com x@y.com 10.0.0.1');
  assert.deepEqual(res.counts, { email: 2, ip: 1 });
  assert.equal(res.items.length, 3);
  assert.deepEqual(Object.keys(res.mapping), ['[EMAIL_1]', '[IP_1]']);
});

test('token estimate', () => {
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens('你好'), 2);
});
