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

function prospectKey(lead) {
  return lead.placeId || `${lead.countryCode}|${String(lead.name).toLowerCase()}|${String(lead.address).toLowerCase()}`;
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
    const summary = {
      completedAt: new Date().toISOString(),
      target,
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
      blockingReason: 'A valid LYNQ business mailing address is required before compliant Canadian commercial email can be sent; Jordan electronic follow-up requires prior consent.',
    };
    fs.writeFileSync(path.join(outputDir, 'lynq-prospects-summary.json'), JSON.stringify(summary, null, 2));
  }
}

function buildJobs() {
  const jobs = [];
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
  const res = responseCollector();
  await runPipeline(requestFor(job), res);
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
  for (const lead of res.body.leads || []) {
    if (!lead.qualified) continue;
    const key = prospectKey(lead);
    const existing = prospects.get(key);
    if (!existing || lead.opportunityScore > existing.opportunityScore) prospects.set(key, lead);
  }
  if (completedJobs % 5 === 0) writeOutputs();
  process.stdout.write(`job ${completedJobs}: scanned ${scanned}, qualified unique ${prospects.size}/${target}\n`);
}

async function main() {
  for (const required of ['OUTSCRAPER_API_KEY', 'LYNQ_ADMIN_SESSION_SECRET']) {
    if (!process.env[required]) throw new Error(`Missing ${required}`);
  }

  const jobs = buildJobs();
  let nextJob = 0;
  async function worker() {
    while (!fatalError && nextJob < jobs.length && prospects.size < target) {
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
