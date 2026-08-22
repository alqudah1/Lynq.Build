const fs = require('node:fs');
const path = require('node:path');
const { createSessionToken } = require('../api/_admin-auth');
const runPipeline = require('../api/run-pipeline');

const CANADA_MARKETS = [
  'Toronto, Ontario, Canada', 'North York, Ontario, Canada', 'Scarborough, Ontario, Canada',
  'Etobicoke, Ontario, Canada', 'Mississauga, Ontario, Canada', 'Brampton, Ontario, Canada',
  'Vaughan, Ontario, Canada', 'Markham, Ontario, Canada', 'Richmond Hill, Ontario, Canada',
  'Oakville, Ontario, Canada', 'Burlington, Ontario, Canada', 'Hamilton, Ontario, Canada',
  'Kitchener, Ontario, Canada', 'Waterloo, Ontario, Canada', 'London, Ontario, Canada',
  'Ottawa, Ontario, Canada', 'Windsor, Ontario, Canada', 'Oshawa, Ontario, Canada',
  'Ajax, Ontario, Canada', 'Pickering, Ontario, Canada', 'Calgary, Alberta, Canada',
  'Edmonton, Alberta, Canada', 'Vancouver, British Columbia, Canada', 'Surrey, British Columbia, Canada',
  'Halifax, Nova Scotia, Canada',
];

const JORDAN_MARKETS = [
  'Amman, Jordan', 'Irbid, Jordan', 'Zarqa, Jordan', 'Aqaba, Jordan', 'Salt, Jordan', 'Madaba, Jordan',
];

const INDUSTRIES = [
  'restaurants', 'dental clinics', 'real estate agents', 'plumbers', 'hair salons',
  'barbers', 'auto repair shops', 'law firms', 'physiotherapy clinics', 'accounting firms',
  'landscaping companies', 'cleaning services', 'gyms and fitness centers', 'beauty salons',
  'construction companies', 'medical clinics',
];

const target = Math.min(1000, Math.max(1, Number(process.env.DISCOVERY_LIMIT) || 1000));
const concurrency = Math.min(5, Math.max(1, Number(process.env.DISCOVERY_CONCURRENCY) || 3));
const maxRecords = Math.max(1, Number(process.env.DISCOVERY_MAX_RECORDS) || 1500);
const outputDir = process.env.DISCOVERY_OUTPUT_DIR || path.resolve(__dirname, '../../../outputs');
const prospects = new Map();
let scanned = 0;
let completedJobs = 0;
let failedJobs = 0;
let fatalError = '';

function providerFailure(message) {
  return /api key invalid|credits exhausted|missing outscraper_api_key/i.test(String(message || ''));
}

function responseCollector() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function requestFor(job) {
  const token = createSessionToken(process.env.LYNQ_ADMIN_SESSION_SECRET);
  return {
    method: 'POST',
    headers: { cookie: `lynq_admin_session=${token}` },
    body: { ...job, limit: 25 },
  };
}

async function invokePipeline(job) {
  if (process.env.DISCOVERY_API_URL) {
    if (!process.env.LYNQ_ADMIN_SESSION_TOKEN) throw new Error('Missing LYNQ_ADMIN_SESSION_TOKEN');
    const response = await fetch(process.env.DISCOVERY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `lynq_admin_session=${process.env.LYNQ_ADMIN_SESSION_TOKEN}`,
      },
      body: JSON.stringify({ ...job, limit: 25 }),
    });
    const body = await response.json().catch(() => ({ error: `Non-JSON response (${response.status})` }));
    return { statusCode: response.status, body };
  }

  const response = responseCollector();
  await runPipeline(requestFor(job), response);
  return response;
}

function prospectKey(lead) {
  return lead.placeId || `${lead.countryCode}|${String(lead.name).toLowerCase()}|${String(lead.address).toLowerCase()}`;
}

function normalizeLead(lead, job = {}) {
  const city = lead.city || job.city || '';
  const countryCode = lead.countryCode || job.countryCode || (city.includes('Jordan') ? 'JO' : 'CA');
  const rating = Number(lead.rating) || 0;
  const reviews = Number(lead.reviews) || 0;
  const websiteScore = Number(lead.websiteScore) || 0;
  const reputationScore = (rating >= 4.7 ? 25 : rating >= 4.4 ? 20 : rating >= 4 ? 10 : 0)
    + (reviews >= 100 ? 15 : reviews >= 30 ? 10 : reviews >= 10 ? 5 : 0);
  const digitalNeedScore = !lead.website ? 50 : Math.round(Math.max(0, (55 - websiteScore) / 55 * 50));
  const contactabilityScore = (lead.email ? 5 : 0) + (lead.phone ? 5 : 0);
  const reason = lead.reason || (!lead.website ? 'No website' : 'Weak website');

  return {
    ...lead,
    placeId: lead.placeId || '',
    countryCode,
    city,
    industry: lead.industry || job.industry || '',
    language: lead.language || job.language || (countryCode === 'JO' ? 'ar' : 'en'),
    rating: rating || null,
    reviews,
    websiteScore,
    reason,
    opportunityScore: Number.isFinite(Number(lead.opportunityScore))
      ? Number(lead.opportunityScore)
      : Math.min(100, reputationScore + digitalNeedScore + contactabilityScore),
    qualificationReasons: lead.qualificationReasons || [
      reason,
      rating ? `${rating}★ from ${reviews} reviews` : 'No review signal',
      lead.email || lead.phone ? 'Direct contact channel found' : 'No direct contact channel found',
    ],
  };
}

function rankedProspects() {
  return [...prospects.values()]
    .sort((left, right) => (right.opportunityScore - left.opportunityScore) || (right.reviews - left.reviews))
    .slice(0, target);
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function writeOutputs(final = false) {
  fs.mkdirSync(outputDir, { recursive: true });
  const leads = rankedProspects();
  const exportObject = { version: 1, exportedAt: new Date().toISOString(), prospects: leads };
  fs.writeFileSync(path.join(outputDir, 'lynq-prospects-latest.json'), JSON.stringify(exportObject, null, 2));

  const columns = ['placeId', 'name', 'countryCode', 'city', 'industry', 'rating', 'reviews', 'opportunityScore', 'websiteScore', 'website', 'email', 'phone', 'address', 'qualificationReasons'];
  const csv = [columns.join(','), ...leads.map(lead => columns.map(column => csvCell(lead[column])).join(','))].join('\n');
  fs.writeFileSync(path.join(outputDir, 'lynq-prospects-latest.csv'), csv);

  for (let index = 0; index < leads.length; index += 100) {
    const batch = { version: 1, exportedAt: exportObject.exportedAt, prospects: leads.slice(index, index + 100) };
    fs.writeFileSync(path.join(outputDir, `lynq-office-import-${String(index / 100 + 1).padStart(2, '0')}.json`), JSON.stringify(batch, null, 2));
  }

  if (final) {
    const blockingReasons = [];
    const businessAddressConfigured = process.env.DISCOVERY_BUSINESS_ADDRESS_CONFIGURED === 'true'
      || Boolean(process.env.LYNQ_BUSINESS_ADDRESS);
    if (!businessAddressConfigured) blockingReasons.push('Configure a valid LYNQ business mailing address before Canadian commercial email');
    if (!leads.some(lead => lead.email)) blockingReasons.push('No qualified prospect published an email address');
    if (leads.some(lead => lead.countryCode === 'JO')) blockingReasons.push('Jordan electronic follow-up requires prior consent');
    const summary = {
      completedAt: new Date().toISOString(),
      target,
      maxRecords,
      scanned,
      qualifiedUnique: leads.length,
      canada: leads.filter(lead => lead.countryCode === 'CA').length,
      jordan: leads.filter(lead => lead.countryCode === 'JO').length,
      withEmail: leads.filter(lead => lead.email).length,
      withPhone: leads.filter(lead => lead.phone).length,
      completedJobs,
      failedJobs,
      fatalError: fatalError || null,
      outreachSent: 0,
      blockingReason: blockingReasons.join('; ') || null,
    };
    fs.writeFileSync(path.join(outputDir, 'lynq-prospects-summary.json'), JSON.stringify(summary, null, 2));
  }
}

function buildJobs() {
  const jobs = [];
  const priorityCountry = String(process.env.DISCOVERY_PRIORITY_COUNTRY || '').toUpperCase();
  if (priorityCountry === 'JO' || priorityCountry === 'CA') {
    const firstMarkets = priorityCountry === 'JO' ? JORDAN_MARKETS : CANADA_MARKETS;
    const secondMarkets = priorityCountry === 'JO' ? CANADA_MARKETS : JORDAN_MARKETS;
    for (const industry of INDUSTRIES) {
      for (const city of firstMarkets) jobs.push({ city, industry, countryCode: priorityCountry, language: priorityCountry === 'JO' ? 'ar' : 'en' });
    }
    const secondCountry = priorityCountry === 'JO' ? 'CA' : 'JO';
    for (const industry of INDUSTRIES) {
      for (const city of secondMarkets) jobs.push({ city, industry, countryCode: secondCountry, language: secondCountry === 'JO' ? 'ar' : 'en' });
    }
    return jobs;
  }

  for (const industry of INDUSTRIES) {
    const maxMarkets = Math.max(CANADA_MARKETS.length, JORDAN_MARKETS.length);
    for (let index = 0; index < maxMarkets; index += 1) {
      if (CANADA_MARKETS[index]) jobs.push({ city: CANADA_MARKETS[index], industry, countryCode: 'CA', language: 'en' });
      if (JORDAN_MARKETS[index]) jobs.push({ city: JORDAN_MARKETS[index], industry, countryCode: 'JO', language: 'en' });
    }
  }
  return jobs;
}

async function processJob(job) {
  const res = await invokePipeline(job);
  completedJobs += 1;
  if (res.statusCode !== 200) {
    failedJobs += 1;
    const message = res.body?.error || String(res.statusCode);
    if (providerFailure(message)) {
      fatalError = message;
      throw new Error(message);
    }
    process.stdout.write(`job ${completedJobs}: ${job.countryCode} ${job.city} / ${job.industry} failed: ${message}\n`);
    return;
  }

  scanned += res.body.found || 0;
  for (const rawLead of res.body.leads || []) {
    if (!rawLead.qualified) continue;
    const lead = normalizeLead(rawLead, job);
    const key = prospectKey(lead);
    const existing = prospects.get(key);
    if (!existing || lead.opportunityScore > existing.opportunityScore) prospects.set(key, lead);
  }
  if (completedJobs % 5 === 0) writeOutputs();
  process.stdout.write(`job ${completedJobs}: scanned ${scanned}, qualified unique ${prospects.size}/${target}\n`);
}

async function main() {
  if (process.env.DISCOVERY_REPAIR_INPUT) {
    const input = JSON.parse(fs.readFileSync(process.env.DISCOVERY_REPAIR_INPUT, 'utf8'));
    for (const rawLead of input.prospects || []) {
      const lead = normalizeLead(rawLead);
      prospects.set(prospectKey(lead), lead);
    }
    scanned = Number(process.env.DISCOVERY_SCANNED) || prospects.size;
    completedJobs = Number(process.env.DISCOVERY_COMPLETED_JOBS) || 0;
    writeOutputs(true);
    process.stdout.write(`repaired: ${prospects.size} prospects\n`);
    return;
  }

  if (process.env.DISCOVERY_SEED_INPUT) {
    const seed = JSON.parse(fs.readFileSync(process.env.DISCOVERY_SEED_INPUT, 'utf8'));
    for (const rawLead of seed.prospects || []) {
      const lead = normalizeLead(rawLead);
      prospects.set(prospectKey(lead), lead);
    }
    process.stdout.write(`seeded: ${prospects.size} existing prospects\n`);
  }

  const requiredVariables = process.env.DISCOVERY_API_URL
    ? ['LYNQ_ADMIN_SESSION_TOKEN']
    : ['OUTSCRAPER_API_KEY', 'LYNQ_ADMIN_SESSION_SECRET'];
  for (const required of requiredVariables) {
    if (!process.env[required]) throw new Error(`Missing ${required}`);
  }

  const jobs = buildJobs();
  let nextJob = 0;
  async function worker() {
    while (!fatalError && nextJob < jobs.length && prospects.size < target && scanned < maxRecords) {
      const job = jobs[nextJob];
      nextJob += 1;
      await processJob(job);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  writeOutputs(true);
  process.stdout.write(`complete: scanned ${scanned}, qualified unique ${rankedProspects().length}, failed jobs ${failedJobs}\n`);
}

main().catch(error => {
  writeOutputs(true);
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
