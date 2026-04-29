module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Search queries targeting people who need life insurance
  const QUERIES = [
    'need life insurance',
    'life insurance advice',
    'term life insurance',
    'buying life insurance',
    'life insurance quote',
    'mortgage protection insurance',
    'family life insurance',
  ];

  // Ontario-wide subreddits
  const SUBREDDITS = [
    'PersonalFinanceCanada',
    'ontario',
    'toronto',
    'brampton',
    'mississauga',
    'ottawa',
    'Hamilton',
    'londonontario',
    'KitchenerWaterloo',
    'windsorontario',
    'barrie',
    'canadafinance',
    'FirstTimeHomeBuyerCanada',
  ];

  // Words suggesting someone is SEEKING advice (not an agent selling)
  const SEEKING = ['need', 'help', 'advice', 'looking', 'recommend', 'should i', 'best',
    'affordable', 'cheap', 'quote', 'buying', 'getting', 'wondering', 'confused',
    'not sure', 'unsure', 'how much', 'how do', 'where can', 'anyone know', '?'];

  // Words that suggest this is an agent / spam post
  const AGENT_SPAM = ['i sell', 'i am an agent', 'i\'m an agent', 'dm me', 'contact me for',
    'i offer', 'message me for', 'reach out to me', 'my services'];

  const results = [];
  const seen = new Set(); // dedupe by username

  for (const sub of SUBREDDITS) {
    for (const q of QUERIES.slice(0, 4)) { // limit to 4 queries × 6 subreddits = 24 requests
      try {
        const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&sort=new&restrict_sr=on&t=year&limit=8`;
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'lynq-lead-research/1.0',
            'Accept': 'application/json',
          },
        });
        if (!r.ok) continue;
        const data = await r.json();
        const posts = data?.data?.children || [];

        for (const post of posts) {
          const p = post.data;
          if (!p.author || p.author === '[deleted]' || p.author === 'AutoModerator') continue;
          if (seen.has(p.author)) continue;

          const fullText = (p.title + ' ' + (p.selftext || '')).toLowerCase();

          const isSeeking = SEEKING.some(w => fullText.includes(w));
          const isSpam    = AGENT_SPAM.some(w => fullText.includes(w));

          if (!isSeeking || isSpam) continue;

          // Skip purely informational/news posts (no personal context)
          if (!p.is_self && !fullText.includes('?') && !fullText.includes('help')) continue;

          seen.add(p.author);
          results.push({
            username:  p.author,
            subreddit: p.subreddit,
            title:     p.title,
            snippet:   (p.selftext || '').trim().slice(0, 300) || p.title,
            url:       `https://www.reddit.com${p.permalink}`,
            created:   p.created_utc,
            score:     p.score,
            num_comments: p.num_comments,
          });
        }
      } catch {
        // Skip failed requests silently
      }
    }
  }

  // Sort by most recent
  results.sort((a, b) => b.created - a.created);

  return res.status(200).json({ leads: results.slice(0, 25), total: results.length });
};
