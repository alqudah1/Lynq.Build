const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const handler = require('../clients/Kingsbridge_Group/06_Website_Code/api/contact.js');
const { buildMimeMessage, smtpSend, gmailConfigured } = handler._internal;

// Fake TLS socket that plays the server side of an SMTP conversation.
function fakeSmtp(replies, log) {
  return () => {
    const s = new EventEmitter();
    s.setEncoding = () => {};
    s.destroy = () => {};
    s.end = () => {};
    let i = 0;
    const next = () => { if (i < replies.length) setImmediate(() => s.emit('data', replies[i++])); };
    s.write = (line) => { log.push(line); next(); };
    next(); // greeting
    return s;
  };
}

test('gmailConfigured needs both variables', () => {
  assert.equal(gmailConfigured({ GMAIL_USER: 'a@b.ca' }), false);
  assert.equal(gmailConfigured({ GMAIL_USER: 'a@b.ca', GMAIL_APP_PASSWORD: 'x' }), true);
});

test('MIME message has headers, reply-to and base64 body', () => {
  const msg = buildMimeMessage({ from: 'admin@kingsbridgegroup.ca', to: 'admin@kingsbridgegroup.ca', replyTo: 'v@x.com', subject: 'Inquiry — Zoë', html: '<p>hi</p>' });
  assert.match(msg, /^From: "Kingsbridge Website" <admin@kingsbridgegroup\.ca>\r\n/);
  assert.match(msg, /\r\nReply-To: <v@x\.com>\r\n/);
  assert.match(msg, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.ok(msg.includes(Buffer.from('<p>hi</p>').toString('base64')));
});

test('smtpSend completes a full SMTP exchange', async () => {
  const log = [];
  const replies = ['220 smtp.gmail.com ready\r\n', '250-smtp.gmail.com\r\n250 AUTH PLAIN\r\n', '235 Accepted\r\n', '250 OK\r\n', '250 OK\r\n', '354 Go ahead\r\n', '250 OK queued\r\n', '221 bye\r\n'];
  await smtpSend({ host: 'h', port: 465, user: 'u@x.ca', pass: 'p', from: 'u@x.ca', to: 'r@x.ca', data: 'Subject: t\r\n\r\n.dot line', connect: fakeSmtp(replies, log) });
  assert.equal(log[0], 'EHLO kingsbridgegroup.ca\r\n');
  assert.match(log[1], /^AUTH PLAIN /);
  assert.equal(log[2], 'MAIL FROM:<u@x.ca>\r\n');
  assert.equal(log[3], 'RCPT TO:<r@x.ca>\r\n');
  assert.equal(log[4], 'DATA\r\n');
  assert.ok(log[5].includes('\r\n..dot line\r\n.\r\n'), 'dot-stuffed and terminated');
  assert.equal(log[6], 'QUIT\r\n');
});

test('smtpSend rejects on bad credentials without leaking the password', async () => {
  const replies = ['220 ready\r\n', '250 ok\r\n', '535 5.7.8 Username and Password not accepted\r\n'];
  await assert.rejects(
    smtpSend({ host: 'h', port: 465, user: 'u@x.ca', pass: 'secretpw', from: 'u@x.ca', to: 'r@x.ca', data: 'x', connect: fakeSmtp(replies, []) }),
    (err) => err.message === 'gmail_send_failed' && err.detail.startsWith('535') && !err.detail.includes('secretpw')
  );
});

test('handler without any provider configured returns 503 and no delivered flag', async () => {
  for (const k of ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_UPN']) delete process.env[k];
  let status, json;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { json = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: {}, socket: {}, body: { name: 'Test Person', email: 't@example.com', message: 'Hello there, testing.', inquiryType: 'General Inquiry' } }, res);
  assert.equal(status, 503);
  assert.equal(json.delivered, undefined);
});

test('handler sends through Gmail when configured and returns delivered:true (GA4 lead contract)', async () => {
  const tls = require('node:tls');
  const original = tls.connect;
  const log = [];
  const replies = ['220 ready\r\n', '250 ok\r\n', '235 ok\r\n', '250 ok\r\n', '250 ok\r\n', '354 go\r\n', '250 queued\r\n', '221 bye\r\n'];
  tls.connect = fakeSmtp(replies, log);
  process.env.GMAIL_USER = 'admin@kingsbridgegroup.ca';
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
  try {
    let status, json;
    const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { json = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' }, socket: {}, body: { name: 'Lead Person', email: 'lead@example.com', message: 'I want a custom home quote.', inquiryType: 'Custom Home Inquiry', 'ch-location': 'Oakville' } }, res);
    assert.equal(status, 200);
    assert.equal(json.delivered, true);
    assert.equal(log[3], 'RCPT TO:<admin@kingsbridgegroup.ca>\r\n');
    const auth = Buffer.from(log[1].replace('AUTH PLAIN ', '').trim(), 'base64').toString();
    assert.equal(auth, '\u0000admin@kingsbridgegroup.ca\u0000abcdefghijklmnop', 'spaces stripped from app password');
    assert.match(log[5], /Reply-To: <lead@example\.com>/);
  } finally {
    tls.connect = original;
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  }
});
