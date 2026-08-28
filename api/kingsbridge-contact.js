const nodemailer = require('nodemailer');

const TARGET_EMAIL = 'admin@kingsbridgegroup.ca';
const ALLOWED_INQUIRIES = new Set([
  'Custom Home Inquiry',
  'Commercial Property Management Inquiry',
  'General Inquiry',
]);

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = async function kingsbridgeContact(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, emailConfigured: Boolean(process.env.ZOHO_APP_PASSWORD) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let input;
  try {
    input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  if (clean(input.website, 200)) return res.status(200).json({ ok: true });

  const name = clean(input.name, 120);
  const email = clean(input.email, 180);
  const phone = clean(input.phone, 60);
  const message = clean(input.message, 5000);
  const inquiryType = clean(input.inquiryType, 100);

  if (!name || !isEmail(email) || !message || !ALLOWED_INQUIRIES.has(inquiryType)) {
    return res.status(400).json({ error: 'Please complete your name, email, inquiry type and message.' });
  }
  if (!process.env.ZOHO_APP_PASSWORD) {
    return res.status(503).json({ error: 'Email delivery is temporarily unavailable. Please try again shortly.' });
  }

  const detailLabels = {
    'cm-company': 'Company',
    'ch-location': 'Project Location',
    'ch-type': 'Project Type',
    'ch-timing': 'Timeline',
    'cm-location': 'Property Location',
    'cm-type': 'Property Type',
    'cm-size': 'Approximate Size / Units',
    'cm-needs': 'Support Needed',
  };
  const details = Object.entries(detailLabels)
    .map(([key, label]) => [label, clean(input[key], 500)])
    .filter(([, value]) => value);
  const text = [
    `Inquiry type: ${inquiryType}`,
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    message,
  ].filter(Boolean).join('\n');

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zohocloud.ca',
      port: 465,
      secure: true,
      auth: { user: 'hello@lynq.build', pass: process.env.ZOHO_APP_PASSWORD },
    });
    const info = await transporter.sendMail({
      from: '"Kingsbridge Website" <hello@lynq.build>',
      replyTo: `"${name.replace(/["<>]/g, '')}" <${email}>`,
      to: TARGET_EMAIL,
      subject: `${inquiryType} — ${name.replace(/[\r\n]/g, ' ')}`,
      text,
    });
    return res.status(200).json({ ok: true, delivered: true, messageId: info.messageId });
  } catch (error) {
    console.error('Kingsbridge contact delivery failed:', error.message);
    return res.status(500).json({ error: 'Unable to send your inquiry right now. Please try again.' });
  }
};
