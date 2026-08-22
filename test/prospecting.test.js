const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const { createSessionToken } = require('../api/_admin-auth');

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function authenticatedRequest(body) {
  const token = createSessionToken(process.env.LYNQ_ADMIN_SESSION_SECRET);
  return { method: 'POST', body, headers: { cookie: `lynq_admin_session=${token}` } };
}

test('Jordan discovery qualifies only reputable businesses with digital need', async () => {
  process.env.LYNQ_ADMIN_SESSION_SECRET = 'test-session-secret-long-enough';
  process.env.OUTSCRAPER_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [[
        { place_id: 'a', name: 'Strong Business', rating: 4.8, reviews: 120, site: '', phone: '+9621' },
        { place_id: 'b', name: 'Weak Signal', rating: 4.1, reviews: 5, site: '', phone: '+9622' },
      ]] }),
    };
  };

  try {
    const handler = require('../api/run-pipeline');
    const res = response();
    await handler(authenticatedRequest({ city: 'Amman, Jordan', industry: 'restaurants', countryCode: 'JO' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.found, 2);
    assert.equal(res.body.qualified, 1);
    assert.equal(res.body.skipped, 1);
    assert.equal(res.body.leads[0].name, 'Strong Business');
    assert.match(requestedUrl, /region=JO/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('email sending uses the exact reviewed subject and body', async () => {
  process.env.LYNQ_ADMIN_SESSION_SECRET = 'test-session-secret-long-enough';
  process.env.ZOHO_APP_PASSWORD = 'test-password';
  process.env.LYNQ_BUSINESS_ADDRESS = '123 Test Street, Toronto, ON';

  const originalCreateTransport = nodemailer.createTransport;
  let sentMessage;
  nodemailer.createTransport = () => ({
    sendMail: async message => {
      sentMessage = message;
      return { messageId: 'test-message-id' };
    },
  });

  try {
    delete require.cache[require.resolve('../api/outreach')];
    const handler = require('../api/outreach');
    const res = response();
    await handler(authenticatedRequest({
      action: 'send',
      lead: { name: 'Reviewed Business' },
      toEmail: 'owner@example.com',
      approvedSubject: 'Exact approved subject',
      approvedEmail: 'This is the exact approved body and compliance footer.',
      approval: { messageReviewed: true, contactBasisConfirmed: true },
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, true);
    assert.equal(sentMessage.subject, 'Exact approved subject');
    assert.equal(sentMessage.text, 'This is the exact approved body and compliance footer.');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('Jordan electronic outreach fails closed without prior consent confirmation', async () => {
  process.env.LYNQ_ADMIN_SESSION_SECRET = 'test-session-secret-long-enough';
  process.env.ZOHO_APP_PASSWORD = 'test-password';
  process.env.LYNQ_BUSINESS_ADDRESS = '123 Test Street, Toronto, ON';
  const handler = require('../api/outreach');
  const res = response();

  await handler(authenticatedRequest({
    action: 'send',
    lead: { name: 'Jordan Business', countryCode: 'JO' },
    toEmail: 'owner@example.com',
    approvedSubject: 'Reviewed subject',
    approvedEmail: 'This is a reviewed message that must not be sent.',
    approval: { messageReviewed: true, contactBasisConfirmed: true },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Prior consent/);
});
