const { put, list } = require('@vercel/blob');

const MEMORY_PATH = 'lynq-tg/memory.json';

async function loadMemory() {
  try {
    const { blobs } = await list({ prefix: 'lynq-tg/memory' });
    if (!blobs.length) return defaultMemory();
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return defaultMemory();
    return await res.json();
  } catch {
    return defaultMemory();
  }
}

function defaultMemory() {
  return {
    recentTopics:     [],   // "product: pillar" strings to avoid repeating
    recentHooks:      [],   // recently used hook opening lines
    rejectedAngles:   [],   // { product, pillar, hook, reason }
    approvedAngles:   [],   // { key, product, pillar, count }
    successfulPillars:{},   // { product: { pillar: count } }
    updatedAt: new Date().toISOString(),
  };
}

async function saveMemory(data) {
  data.updatedAt = new Date().toISOString();
  return put(MEMORY_PATH, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

function recordApproval(memory, post, version) {
  const v = post.versions?.[version];
  if (!v) return memory;
  if (v.hook) memory.recentHooks = [v.hook, ...memory.recentHooks].slice(0, 30);
  const key = `${post.product}:${post.chosenPillar}`;
  const existing = memory.approvedAngles.find(a => a.key === key);
  if (existing) existing.count = (existing.count || 0) + 1;
  else memory.approvedAngles.push({ key, product: post.product, pillar: post.chosenPillar, version, count: 1 });
  if (!memory.successfulPillars[post.product]) memory.successfulPillars[post.product] = {};
  memory.successfulPillars[post.product][post.chosenPillar] =
    (memory.successfulPillars[post.product][post.chosenPillar] || 0) + 1;
  return memory;
}

function recordRejection(memory, post, reason) {
  const hook = post.versions?.A?.hook || '';
  memory.rejectedAngles = [
    { product: post.product, pillar: post.chosenPillar, hook, reason: reason || '' },
    ...memory.rejectedAngles,
  ].slice(0, 30);
  if (post.chosenPillar) {
    const topic = `${post.product}: ${post.chosenPillar}`;
    if (!memory.recentTopics.includes(topic))
      memory.recentTopics = [topic, ...memory.recentTopics].slice(0, 15);
  }
  return memory;
}

module.exports = { loadMemory, saveMemory, recordApproval, recordRejection };
