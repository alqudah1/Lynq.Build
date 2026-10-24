const { put, list } = require('@vercel/blob');

const SESSION_PATH = 'lynq-tg/session.json';
const BIS_PATH     = 'lynq-tg/bis.json';

async function readBlob(prefix) {
  try {
    const { blobs } = await list({ prefix });
    if (!blobs.length) return null;
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function writeBlob(path, data) {
  return put(path, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

async function loadSession() {
  return (await readBlob('lynq-tg/session')) || {
    drafts:      [],    // legacy single-version drafts
    posts:       [],    // multi-version queue posts
    lastDraftId: null,
    lastPostId:  null,
    state:       'idle',
    stateData:   null,
  };
}

async function saveSession(data) {
  // Cap history to avoid large blobs
  if (data.drafts?.length > 60) data.drafts = data.drafts.slice(0, 60);
  if (data.posts?.length  > 90) data.posts  = data.posts.slice(0, 90);
  return writeBlob(SESSION_PATH, data);
}

async function loadBis() {
  return readBlob('lynq-tg/bis');
}

async function saveBis(data) {
  return writeBlob(BIS_PATH, data);
}

module.exports = { loadSession, saveSession, loadBis, saveBis };
