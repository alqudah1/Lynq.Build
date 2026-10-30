const { loadSession, saveSession, loadBis } = require('../_lib/tg-session');
const { loadMemory, saveMemory, recordApproval, recordRejection } = require('../_lib/tg-memory');
const { generateQueue } = require('../_lib/gen-queue');
const { loadSchedule, saveSchedule } = require('../schedule');
const { loadMemory: loadContentMemory, saveMemory: saveContentMemory, isDuplicate } = require('../content-memory');
const { isConnected, MATRIX }              = require('../connections');
const { generatePost, timeToISO }           = require('../post-generator');
const { generateLinkedInPost }              = require('../linkedin-generator');

const ALLOWED_ID     = parseInt((process.env.TELEGRAM_ALLOWED_USER_ID || '0').trim());
const WEBHOOK_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN      = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tgCall(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/${method}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return r.json();
}

async function tgSend(chatId, text, opts = {}) {
  return tgCall('sendMessage', {
    chat_id:    chatId,
    text:       String(text).slice(0, 4096),
    parse_mode: 'HTML',
    ...opts,
  });
}

async function tgSendAll(chatId, messages) {
  for (const m of messages) {
    await tgSend(chatId, m.text, m.opts || {});
    await new Promise(r => setTimeout(r, 150));
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── BIS defaults ──────────────────────────────────────────────────────────────

const BIS_DEFAULTS = {
  codeit: {
    description: 'AI-powered platform that lets kids and beginners build real websites instantly.',
    mission:     'Make web development accessible to every kid.',
    audience:    'Parents of kids aged 8–16, school teachers, homeschool families.',
    pillars:     'Kids building real things\nLearning by doing\nNo-code education\nParent pride moments\nBefore & after student projects',
    ctas:        'Try it free at codeitlearn.com\nShow your kid\'s first website\nStart building for free',
    voice:       'Encouraging and real. Never exaggerate results.',
  },
  lynq: {
    description: 'A modern web design agency building high-converting websites for small businesses.',
    mission:     'Build websites that generate real results for real businesses.',
    audience:    'Small business owners, restaurants, local service providers.',
    pillars:     'Client results\nBehind the build\nWebsite tips\nAgency life\nBefore & after',
    ctas:        'Get a free website audit at lynq.build\nBook a call\nDM to get started',
    voice:       'Direct and confident. Show the work.',
  },
  insurance: {
    description: 'Independent insurance advisor helping Canadians find the right coverage.',
    mission:     'Simplify insurance for everyday Canadians.',
    audience:    'Canadians looking for life, health, or disability insurance.',
    pillars:     'Insurance education\nCommon mistakes\nPolicy comparisons\nPeace of mind',
    ctas:        'Book a free review\nDM for a quote\nGet a free consultation',
    voice:       'Educational and trustworthy. No specific premium promises.',
    compliance:  'Never make specific premium promises. Educational only.',
  },
};

// ── Labels & emojis ───────────────────────────────────────────────────────────

const BIZ_EMOJI  = { codeit: '💻', lynq: '🌐', insurance: '🛡️' };
const BIZ_LABEL  = { codeit: 'CodeIt', lynq: 'Lynq.build', insurance: 'Insurance' };
const PLAT_EMOJI = { tiktok: '🎵', reels: '📸', shorts: '▶️', linkedin: '💼', facebook: '👥', instagram: '📸', stories: '📖' };
const VER_LABEL  = { A: 'Viral', B: 'Educational', C: 'Founder' };
const STATUS_EMOJI = { draft: '📝', approved: '✅', scheduled: '📅', ready_to_post: '📤', posted: '✓', rejected: '❌', needs_edit: '✏️', needs_review: '🔍' };

// ── Legacy single-draft generation (for /codeit /lynq /insurance) ─────────────

function pickTodayBiz(drafts) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent  = drafts.filter(d => new Date(d.createdAt).getTime() > weekAgo);
  const total   = recent.length || 1;
  const counts  = { codeit: 0, lynq: 0, insurance: 0 };
  recent.forEach(d => { if (d.business in counts) counts[d.business]++; });
  const targets = { codeit: 0.70, lynq: 0.20, insurance: 0.10 };
  let maxDeficit = -Infinity, pick = 'codeit';
  Object.entries(targets).forEach(([biz, target]) => {
    const deficit = target - counts[biz] / total;
    if (deficit > maxDeficit) { maxDeficit = deficit; pick = biz; }
  });
  return pick;
}

function formatBizBlock(biz, data) {
  if (!data) return '';
  return [biz.toUpperCase(), `Mission: ${data.mission||data.description||'—'}`, `Audience: ${data.audience||'—'}`,
    `Pillars: ${(data.pillars||'').split('\n').filter(Boolean).join(' | ')}`,
    `CTAs: ${(data.ctas||'').split('\n').filter(Boolean).join(' | ')}`,
    `Voice: ${data.voice||'—'}`, data.compliance ? `Compliance: ${data.compliance}` : ''].filter(Boolean).join('\n');
}

async function generateSingleDraft(suggestedBiz, memory, previousScenario, editInstruction) {
  const memBlock = ['codeit','lynq','insurance'].map(k => formatBizBlock(k, memory[k])).filter(Boolean).join('\n\n');
  const avoidLine = previousScenario ? `\nDo NOT repeat this scenario: "${previousScenario}"` : '';
  const editLine  = editInstruction  ? `\nEdit instruction: "${editInstruction}"` : '';
  const prompt = `You are a content strategist. Choose what to create and generate a full content pack.

BUSINESS MEMORY:\n${memBlock}

Suggested business: ${suggestedBiz}${avoidLine}${editLine}

Choose: business, one content pillar, one angle ("I tested this" / "I challenged [X] to..." / "I'm building this" / "Here's what AI can create when..." / "Nobody talks about this, but..." / "The honest truth about..."), specific scenario.

Rules: hooks all different; TikTok/Reels 30-45s spoken; Shorts 15-30s; CTAs from memory exactly; no fake results; Insurance educational only, no premium promises.

Return ONLY valid JSON:
{"chosenBusiness":"...","chosenPillar":"...","chosenAngle":"...","scenario":"...",
"tiktok":{"hook":"...","script":"...","caption":"...","hashtags":"...","cta":"...","imagePrompt":"...","videoPrompt":"..."},
"reels":{"hook":"...","script":"...","caption":"...","hashtags":"...","cta":"...","imagePrompt":"...","videoPrompt":"..."},
"shorts":{"hook":"...","script":"...","caption":"...","hashtags":"...","cta":"...","imagePrompt":"...","videoPrompt":"..."},
"linkedin":{"hook":"...","post":"...","hashtags":"...","cta":"...","imagePrompt":"..."},
"facebook":{"hook":"...","post":"...","hashtags":"...","cta":"...","imagePrompt":"..."},
"stories":[{"text":"...","visual":"...","sticker":"","duration":"5s"}],
"recordingPlan":{"hook":"...","duration":"~45 seconds","scenes":[{"num":1,"action":"...","show":"...","cameraNote":"..."}]}}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Anthropic error');
  return JSON.parse((data.content?.[0]?.text || '').replace(/```json|```/g, '').trim());
}

// ── Format single-draft messages ──────────────────────────────────────────────

function formatDraftMessages(pack, draftId) {
  const biz = pack.chosenBusiness;
  const msgs = [];
  const rp = pack.recordingPlan || {};
  const scenes = (rp.scenes || []).map(s =>
    `<b>${s.num}.</b> ${esc(s.action)}\n   📺 ${esc(s.show)}${s.cameraNote ? `\n   📷 ${esc(s.cameraNote)}` : ''}`
  ).join('\n\n');
  msgs.push({ text:
    `${BIZ_EMOJI[biz]||'🎯'} <b>${esc(BIZ_LABEL[biz]||biz)}</b> · ${esc(pack.chosenPillar||'')}\n📐 <i>${esc(pack.chosenAngle||'')}</i>\n\n💡 ${esc(pack.scenario||'')}\n\n` +
    `━━━━━━━━━━━━━━━━\n🎬 <b>RECORDING PLAN</b>\n━━━━━━━━━━━━━━━━\n<b>Hook:</b> "${esc(rp.hook||'')}"\n⏱ ${esc(rp.duration||'')}\n\n${scenes}` });
  const tt = pack.tiktok||{}, rls = pack.reels||{}, sh = pack.shorts||{};
  msgs.push({ text: `🎵 <b>TIKTOK</b>\n<b>Hook:</b> ${esc(tt.hook||'')}\n\n${esc(tt.script||'')}\n\n<b>Caption:</b> ${esc(tt.caption||'')}\n<b>CTA:</b> ${esc(tt.cta||'')}` });
  msgs.push({ text: `📸 <b>REELS</b>\n<b>Hook:</b> ${esc(rls.hook||'')}\n\n${esc(rls.script||'')}` });
  msgs.push({ text: `▶️ <b>SHORTS</b>\n<b>Hook:</b> ${esc(sh.hook||'')}\n\n${esc(sh.script||'')}` });
  const li = pack.linkedin||{}, fb = pack.facebook||{};
  msgs.push({ text: `💼 <b>LINKEDIN</b>\n${esc(li.post||'')}\n\n👥 <b>FACEBOOK</b>\n${esc(fb.post||'')}` });
  const stories = (pack.stories||[]).map((s,i) =>
    `Frame ${i+1}${s.duration?' · '+s.duration:''}: <b>${esc(s.text)}</b>${s.sticker?' '+s.sticker:''}\n   ${esc(s.visual)}`).join('\n');
  msgs.push({ text: `📖 <b>STORIES</b>\n${stories}\n\n🎨 ${esc(tt.imagePrompt||'')}\n🎥 ${esc(tt.videoPrompt||'')}\n\n🏷 ${esc(tt.hashtags||'')}` });
  msgs.push({ text: `─────────────────\nDraft <code>${draftId}</code>`,
    opts: { reply_markup: { inline_keyboard: [
      [{ text: '✅ Approve', callback_data:`appd:${draftId}` }, { text: '📤 Ready to Post', callback_data:`postd:${draftId}` }],
      [{ text: '🔄 Regenerate', callback_data:`regend:${pack.chosenBusiness||'auto'}` }, { text: '⏭️ Skip', callback_data:`skipd:${draftId}` }],
    ]}}});
  return msgs;
}

// ── Format queue post summary ─────────────────────────────────────────────────

function formatQueueSummary(post, num, total) {
  const { id, product, platform, chosenPillar, recommendedTime, versions } = post;
  const A = versions?.A, B = versions?.B, C = versions?.C;
  return {
    text:
      `Post ${num}/${total} — ${BIZ_EMOJI[product]||'🎯'} <b>${esc(BIZ_LABEL[product]||product)}</b> · ${PLAT_EMOJI[platform]||'📱'} ${esc(platform)} · ⏰ ${esc(recommendedTime)}\n` +
      `📌 ${esc(chosenPillar)}\n\n` +
      `🅐 <b>Viral:</b> "${esc(A?.hook||'')}"\n` +
      `🅑 <b>Educational:</b> "${esc(B?.hook||'')}"\n` +
      `🅒 <b>Founder:</b> "${esc(C?.hook||'')}"\n\n` +
      `<code>${id}</code> — Pick a version:`,
    opts: { reply_markup: { inline_keyboard: [
      [
        { text: 'A — Viral',       callback_data: `pv:${id}:A` },
        { text: 'B — Educational', callback_data: `pv:${id}:B` },
        { text: 'C — Founder',     callback_data: `pv:${id}:C` },
      ],
      [{ text: '⏭️ Skip this post', callback_data: `skipp:${id}` }],
    ]}},
  };
}

function formatVersionDetail(post, version) {
  const v = post.versions?.[version];
  if (!v) return null;
  const { product, platform, recommendedTime, id } = post;
  const text =
    `✅ <b>Version ${version} — ${esc(v.label||VER_LABEL[version])}</b>\n\n` +
    `${BIZ_EMOJI[product]||'🎯'} <b>${esc(BIZ_LABEL[product]||product)}</b> · ${PLAT_EMOJI[platform]||'📱'} ${esc(platform)} · ⏰ ${esc(recommendedTime)}\n\n` +
    `<b>Hook:</b> "${esc(v.hook||'')}"\n\n` +
    `<b>Script:</b>\n${esc(v.script||'')}\n\n` +
    `<b>Caption:</b> ${esc(v.caption||'')}\n` +
    `<b>Text overlay:</b> ${esc(v.textOverlay||'')}\n` +
    `<b>CTA:</b> ${esc(v.cta||'')}\n` +
    `<b>Hashtags:</b> ${esc(v.hashtags||'')}\n\n` +
    `🎬 <b>Recording:</b> ${esc(v.recordingInstructions||'')}\n` +
    `🎨 <b>Image:</b> ${esc(v.imagePrompt||'')}`;
  return {
    text,
    opts: { reply_markup: { inline_keyboard: [
      [{ text: `✅ Approve Version ${version}`, callback_data: `appv:${id}:${version}` }],
      [
        { text: '✏️ Edit',        callback_data: `editp:${id}` },
        { text: '🔄 Regenerate',  callback_data: `regenp:${id}` },
        { text: '❌ Reject',      callback_data: `rejp:${id}` },
      ],
    ]}},
  };
}

// ── Full-pack Telegram formatter (splits into multiple messages) ──────────────

function formatFullPackMessages(pack, postId, connected, business, platform) {
  const bizName  = BIZ_LABEL[business] || business;
  const platIcon = PLAT_EMOJI[platform] || '📱';
  const platCap  = platform.charAt(0).toUpperCase() + platform.slice(1);
  const connLine = connected
    ? `✅ <b>${esc(bizName)}:${platform}</b> connected — queued after approval.`
    : `📋 <b>Manual post required</b> — ${esc(bizName)}:${platform} not connected.`;
  const idea  = pack.idea  || {};
  const rp    = pack.recordingPlan || {};
  const msgs  = [];

  // ─ Message 1: Concept + Caption ─
  msgs.push({ text:
    `${platIcon} <b>${esc(bizName)}</b> · ${esc(platCap)}\n${connLine}\n\n` +
    `💡 <b>CONCEPT:</b> ${esc(idea.concept || '')}\n` +
    `📐 <b>ANGLE:</b> ${esc(idea.angle || '')}\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>Hook:</b> "${esc(pack.hook || '')}"\n\n` +
    `<b>Caption:</b>\n${esc(pack.caption || '')}\n\n` +
    `<b>CTA:</b> ${esc(pack.cta || '')}\n` +
    `<b>Hashtags:</b> ${esc(pack.hashtags || '')}\n` +
    (pack.storyText ? `📖 <b>Story:</b> ${esc(pack.storyText)}\n` : '') +
    `⏰ <b>Best time:</b> ${esc(pack.recommendedTime || '')}\n` +
    `📌 <b>Pillar:</b> ${esc(pack.pillar || '')}` });

  // ─ Message 2: Recording Plan ─
  const scenes = (rp.scenes || []).map(s =>
    `<b>${s.num}.</b> ${esc(s.action || '')}\n   📺 ${esc(s.show || '')}${s.camera ? `\n   📷 ${esc(s.camera)}` : ''}   ⏱ ${esc(s.duration || '')}`
  ).join('\n\n');
  msgs.push({ text:
    `🎬 <b>RECORDING PLAN</b> · ${esc(rp.duration || '')}\n\n` +
    `📷 <b>Setup:</b> ${esc(rp.setup || '')}\n` +
    `⚡ <b>Hook shot:</b> ${esc(rp.hookShot || '')}\n\n` +
    `<b>Scenes:</b>\n${scenes}` });

  // ─ Message 3: Shot List ─
  const shots = (pack.shotList || []).map(s =>
    `<b>${s.num}.</b> <i>${esc(s.shot || '')}</i> | ${esc(s.action || '')} | ${esc(s.duration || '')}\n   📷 ${esc(s.camera || '')}`
  ).join('\n\n');
  if (shots) msgs.push({ text: `📋 <b>SHOT LIST</b>\n${shots}` });

  // ─ Message 4: Voiceover ─
  if (pack.voiceover) {
    msgs.push({ text: `🎙️ <b>VOICEOVER SCRIPT</b>\n\n"${esc(pack.voiceover)}"` });
  }

  // ─ Message 5: Production + Buttons ─
  const canva  = pack.canva  || {};
  const capcut = pack.capcut || {};
  const steps  = (pack.postingSteps || []).map(s => esc(s)).join('\n');
  const overlays = (capcut.textOverlays || []).map(o => `• ${esc(o)}`).join('\n');
  const buttons  = connected
    ? [[{ text: '✅ Approve', callback_data: `app_post:${postId}` }, { text: '❌ Reject', callback_data: `rej_post:${postId}` }],
       [{ text: '✏️ Edit',   callback_data: `edit_post:${postId}` }]]
    : [[{ text: '✓ Mark Posted (manual)', callback_data: `done_post:${postId}` }, { text: '❌ Reject', callback_data: `rej_post:${postId}` }],
       [{ text: '✏️ Edit',               callback_data: `edit_post:${postId}` }]];

  msgs.push({ text:
    `🎨 <b>IMAGE PROMPT (ChatGPT):</b>\n<i>${esc(pack.imagePrompt || '')}</i>\n\n` +
    `🖼️ <b>CANVA:</b> ${esc(canva.template || '')}\n` +
    `Headline: <b>${esc(canva.headline || '')}</b>\n` +
    `Colors: ${esc(canva.colors || '')} · Layout: ${esc(canva.layout || '')}\n\n` +
    `✂️ <b>CAPCUT:</b>\n` +
    `Intro: ${esc(capcut.intro || '')}\n` +
    `Transitions: ${esc(capcut.transitions || '')}\n` +
    `Music: ${esc(capcut.musicMood || '')}\n` +
    (overlays ? `Overlays:\n${overlays}\n` : '') +
    `Export: ${esc(capcut.export || '')}\n\n` +
    `📲 <b>POSTING STEPS:</b>\n${steps}\n\n` +
    `<code>${postId}</code>`,
    opts: { reply_markup: { inline_keyboard: buttons } },
  });

  return msgs;
}

// ── LinkedIn Telegram formatter ───────────────────────────────────────────────

function formatLinkedInMessages(post, postId, business) {
  const bizName = BIZ_LABEL[business] || business;
  const msgs    = [];
  const carousel = post.carouselIdea || {};

  // Message 1: Hook + Short Post
  msgs.push({ text:
    `💼 <b>${esc(bizName)}</b> — LinkedIn\n📋 Manual post required\n\n` +
    `<b>Hook:</b>\n"${esc(post.hook || '')}"\n\n` +
    `<b>Short Post (copy-ready):</b>\n${esc(post.copyReadyText || post.shortPost || '')}\n\n` +
    `<b>CTA:</b> ${esc(post.cta || '')}\n` +
    `<b>Hashtags:</b> ${esc(post.hashtags || '')}\n` +
    `⏰ <b>Best time:</b> ${esc(post.bestPostTime || '')}\n` +
    `📌 <b>Pillar:</b> ${esc(post.pillar || '')}` });

  // Message 2: Long Founder Version
  if (post.longPost) {
    msgs.push({ text: `📝 <b>LONG FOUNDER VERSION:</b>\n\n${esc(post.longPost)}` });
  }

  // Message 3: Carousel Idea
  if (carousel.title) {
    const slides = (carousel.slides || []).map(s =>
      `<b>Slide ${s.num}:</b> ${esc(s.headline || '')}\n${esc(s.body || '')}${s.cta ? `\n→ ${esc(s.cta)}` : ''}`
    ).join('\n\n');
    msgs.push({ text: `📊 <b>CAROUSEL:</b> ${esc(carousel.title)}\n\n${slides}` });
  }

  // Message 4: Image Prompt + Checklist + Buttons
  const checklist = (post.postingChecklist || []).map(s => esc(s)).join('\n');
  msgs.push({ text:
    `🎨 <b>IMAGE PROMPT (ChatGPT):</b>\n<i>${esc(post.imagePrompt || '')}</i>\n\n` +
    `📲 <b>POSTING CHECKLIST:</b>\n${checklist}\n\n` +
    `<code>${postId}</code>`,
    opts: { reply_markup: { inline_keyboard: [
      [{ text: '✓ Mark Posted (manual)', callback_data: `done_post:${postId}` }, { text: '❌ Reject', callback_data: `rej_post:${postId}` }],
      [{ text: '✏️ Edit',               callback_data: `edit_post:${postId}` }],
    ]}},
  });

  return msgs;
}

// ── Post-from-Telegram mode ───────────────────────────────────────────────────

function parsePostId(postId) {
  // Format: post_{timestamp}_{business}_{platform}
  const rest   = postId.replace(/^post_\d+_/, '');
  const lastUs = rest.lastIndexOf('_');
  return { business: rest.slice(0, lastUs), platform: rest.slice(lastUs + 1) };
}

async function generateAndSendPost(chatId, business, platform, timeStr, instruction) {
  const bizName  = BIZ_LABEL[business] || business;
  const platIcon = PLAT_EMOJI[platform] || '📱';
  try {
    await tgSend(chatId, `⏳ Generating ${bizName} × ${platIcon} ${platform} full pack…`);
    const post      = await generatePost({ business, platform, timeStr, instruction });
    const connected = await isConnected(business, platform);
    const postId    = `post_${Date.now()}_${business}_${platform}`;

    // Save draft to schedule
    const sched = await loadSchedule();
    sched.push({
      id: postId, business, platform,
      scheduledTime: timeToISO(timeStr), status: 'draft',
      caption: post.caption, hashtags: post.hashtags,
      imageUrl: null, videoUrl: null, audioUrl: null,
      content: { ...post, connected, manualPost: !connected },
      createdAt: new Date().toISOString(), publishedAt: null, error: null,
    });
    await saveSchedule(sched);

    // Send full production pack as multiple messages
    const msgs = formatFullPackMessages(post, postId, connected, business, platform);
    for (const m of msgs) {
      await tgSend(chatId, m.text, m.opts || {});
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    await tgSend(chatId, `❌ Failed: ${esc(bizName)} × ${platform} — ${esc(e.message)}`);
  }
}

async function generateAndSendLinkedIn(chatId, business, timeStr, instruction) {
  const bizName = BIZ_LABEL[business] || business;
  try {
    await tgSend(chatId, `⏳ Generating LinkedIn post for ${bizName}…`);
    const post   = await generateLinkedInPost({ business, timeStr, instruction });
    const postId = `post_${Date.now()}_${business}_linkedin`;

    // Save draft to schedule
    const sched = await loadSchedule();
    sched.push({
      id: postId, business, platform: 'linkedin',
      scheduledTime: timeToISO(timeStr), status: 'draft',
      caption: post.shortPost || '', hashtags: post.hashtags || '',
      imageUrl: null, videoUrl: null, audioUrl: null,
      content: { ...post, connected: false, manualPost: true },
      createdAt: new Date().toISOString(), publishedAt: null, error: null,
    });
    await saveSchedule(sched);

    const msgs = formatLinkedInMessages(post, postId, business);
    for (const m of msgs) {
      await tgSend(chatId, m.text, m.opts || {});
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    await tgSend(chatId, `❌ Failed LinkedIn for ${esc(bizName)}: ${esc(e.message)}`);
  }
}

async function handlePostCommand(chatId, args) {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    await tgSend(chatId,
      `Usage:\n/post lynq linkedin today\n/post codeit instagram tomorrow\n/post insurance facebook today\n/post all today`
    );
    return;
  }

  if (parts[0] === 'all') {
    const timeStr = parts.slice(1).join(' ') || 'today';
    await tgSend(chatId, `⏳ Generating all platforms for ${timeStr}…`);
    for (const [biz, platforms] of Object.entries(MATRIX)) {
      for (const plat of platforms) {
        await generateAndSendPost(chatId, biz, plat, timeStr, '');
        await new Promise(r => setTimeout(r, 400));
      }
    }
    return;
  }

  const [business, platform, ...timeParts] = parts;
  const timeStr = timeParts.join(' ') || 'today';

  if (!MATRIX[business]) {
    await tgSend(chatId, `❌ Unknown business "${esc(business)}". Use: ${Object.keys(MATRIX).join(', ')}`);
    return;
  }
  if (!MATRIX[business].includes(platform)) {
    await tgSend(chatId, `❌ ${esc(business)} doesn't support "${esc(platform)}". Use: ${MATRIX[business].join(', ')}`);
    return;
  }

  await generateAndSendPost(chatId, business, platform, timeStr, '');
}

// ── Record + LinkedIn command handlers ───────────────────────────────────────

async function handleRecordCommand(chatId, args) {
  const parts   = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const business = parts[0];
  const timeStr  = parts.slice(1).join(' ') || 'today';
  if (!MATRIX[business]) {
    await tgSend(chatId, `❌ Unknown business "${esc(business)}". Use: ${Object.keys(MATRIX).join(', ')}`);
    return;
  }
  // Generate full pack with recording focus — use first supported platform for video
  const videoPlatforms = ['tiktok', 'reels', 'shorts', 'instagram'];
  const platform = MATRIX[business].find(p => videoPlatforms.includes(p)) || MATRIX[business][0];
  await generateAndSendPost(chatId, business, platform, timeStr,
    'RECORDING FOCUS: Solo phone recording. Generate detailed video recording plan that works for TikTok, Instagram Reels, and YouTube Shorts simultaneously.'
  );
}

async function handleLinkedInCommand(chatId, args) {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    await tgSend(chatId, `Usage:\n/linkedin lynq today\n/linkedin codeit tomorrow\n/linkedin insurance today\n/linkedin all today`);
    return;
  }
  if (parts[0] === 'all') {
    const timeStr = parts.slice(1).join(' ') || 'today';
    await tgSend(chatId, `⏳ Generating LinkedIn posts for all businesses…`);
    for (const biz of Object.keys(MATRIX)) {
      await generateAndSendLinkedIn(chatId, biz, timeStr, '');
      await new Promise(r => setTimeout(r, 400));
    }
    return;
  }
  const [business, ...timeParts] = parts;
  const timeStr = timeParts.join(' ') || 'today';
  if (!MATRIX[business]) {
    await tgSend(chatId, `❌ Unknown business "${esc(business)}". Use: ${Object.keys(MATRIX).join(', ')}`);
    return;
  }
  await generateAndSendLinkedIn(chatId, business, timeStr, '');
}

// ── Handle queue generation ───────────────────────────────────────────────────

async function handleQueueGenerate(chatId, session, bisMemory, agentMemory) {
  await tgSend(chatId, '⏳ Generating today\'s content queue (3 posts × 3 versions)…');
  const result = await generateQueue(bisMemory, agentMemory, session.posts || []);
  session.posts = [...result.posts, ...(session.posts || [])];
  session.lastPostId = result.posts[0]?.id || null;
  session.state = 'idle';
  await saveSession(session);
  const total = result.posts.length;
  for (let i = 0; i < result.posts.length; i++) {
    const msg = formatQueueSummary(result.posts[i], i + 1, total);
    await tgSend(chatId, msg.text, msg.opts);
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── Handle single-biz draft ───────────────────────────────────────────────────

async function handleSingleGenerate(chatId, biz, session, bisMemory) {
  const suggestedBiz = biz === 'auto' ? pickTodayBiz(session.drafts || []) : biz;
  await tgSend(chatId, `⏳ Generating ${BIZ_LABEL[suggestedBiz]||suggestedBiz} content…`);
  const lastDraft = session.drafts?.find(d => d.id === session.lastDraftId);
  const pack = await generateSingleDraft(suggestedBiz, bisMemory, lastDraft?.scenario||'', '');
  const draft = {
    id: Date.now().toString(), business: pack.chosenBusiness,
    chosenPillar: pack.chosenPillar, chosenAngle: pack.chosenAngle,
    scenario: pack.scenario, status: 'draft',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: pack,
  };
  session.drafts = [draft, ...(session.drafts||[])];
  session.lastDraftId = draft.id;
  session.state = 'idle';
  await saveSession(session);
  await tgSendAll(chatId, formatDraftMessages(pack, draft.id));
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Api-Secret-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') return res.status(200).json({ ok: true, status: 'active' });
  if (req.method !== 'POST') return res.status(405).end();

  const update        = req.body || {};
  const message       = update.message;
  const cbq           = update.callback_query;
  const msg           = message || cbq?.message;
  const chatId        = msg?.chat?.id;
  const userId        = message?.from?.id || cbq?.from?.id;

  if (!chatId || !userId) return res.status(200).json({ ok: true });
  if (ALLOWED_ID && userId !== ALLOWED_ID) {
    await tgSend(chatId, '⛔ Not authorized.');
    return res.status(200).json({ ok: true });
  }

  try {
    const [session, bisBlob, agentMemory] = await Promise.all([loadSession(), loadBis(), loadMemory()]);
    const bisMemory = bisBlob || BIS_DEFAULTS;

    // ── Callback query (button press) ─────────────────────────────────────────
    if (cbq) {
      await tgCall('answerCallbackQuery', { callback_query_id: cbq.id, text: '' });
      const data  = cbq.data || '';
      const parts = data.split(':');
      const type  = parts[0];
      const id    = parts[1];
      const extra = parts[2];

      // Queue post interactions
      if (type === 'pv') {
        // Show version detail
        const post = session.posts?.find(p => p.id === id);
        if (!post) { await tgSend(chatId, 'Post not found. Use /today to generate a new queue.'); }
        else {
          const detail = formatVersionDetail(post, extra);
          if (detail) await tgSend(chatId, detail.text, detail.opts);
        }

      } else if (type === 'appv') {
        // Approve queue post version
        const post = session.posts?.find(p => p.id === id);
        if (post) {
          post.selectedVersion = extra;
          post.status          = 'approved';
          post.updatedAt       = new Date().toISOString();
          const mem = recordApproval(agentMemory, post, extra);
          await Promise.all([saveSession(session), saveMemory(mem)]);
          await tgSend(chatId,
            `✅ <b>Approved — Version ${extra} (${esc(VER_LABEL[extra]||'')})</b>\n` +
            `${BIZ_EMOJI[post.product]||''} ${esc(BIZ_LABEL[post.product]||post.product)} · ${esc(post.platform)} · ${esc(post.recommendedTime)}\n\n` +
            `"${esc(post.versions?.[extra]?.hook||'')}" — Ready to post.`
          );
        }

      } else if (type === 'rejp') {
        const post = session.posts?.find(p => p.id === id);
        if (post) {
          post.status    = 'rejected';
          post.updatedAt = new Date().toISOString();
          const mem = recordRejection(agentMemory, post, '');
          await Promise.all([saveSession(session), saveMemory(mem)]);
          await tgSend(chatId, '❌ Rejected. Use /today to generate a new queue.');
        }

      } else if (type === 'skipp') {
        const post = session.posts?.find(p => p.id === id);
        if (post) { post.status = 'rejected'; post.updatedAt = new Date().toISOString(); await saveSession(session); }
        await tgSend(chatId, '⏭️ Skipped.');

      } else if (type === 'regenp') {
        const post = session.posts?.find(p => p.id === id);
        const biz  = post?.product || 'auto';
        await handleQueueGenerate(chatId, session, bisMemory, agentMemory);

      } else if (type === 'editp') {
        session.state     = 'awaiting_edit_post';
        session.stateData = { postId: id };
        await saveSession(session);
        await tgSend(chatId, '✏️ Send your edit instruction for this post:');

      // Post-from-Telegram actions
      } else if (type === 'app_post' || type === 'rej_post' || type === 'done_post') {
        const sched  = await loadSchedule();
        const item   = sched.find(s => s.id === id);
        if (!item) { await tgSend(chatId, `Post not found: <code>${esc(id)}</code>`); }
        else {
          if (type === 'app_post')  item.status = 'approved';
          if (type === 'rej_post')  item.status = 'cancelled';
          if (type === 'done_post') { item.status = 'posted'; item.publishedAt = new Date().toISOString(); }
          await saveSchedule(sched);
          const labels   = { app_post: '✅ Approved', rej_post: '❌ Rejected', done_post: '✓ Marked posted' };
          const bizName  = BIZ_LABEL[item.business] || item.business;
          const platIcon = PLAT_EMOJI[item.platform] || '📱';
          await tgSend(chatId, `${labels[type]}: <b>${esc(bizName)}</b> × ${platIcon} ${esc(item.platform)}`);
        }

      } else if (type === 'edit_post') {
        const { business, platform } = parsePostId(id);
        session.state     = 'awaiting_edit_post2';
        session.stateData = { postId: id, business, platform };
        await saveSession(session);
        await tgSend(chatId, `✏️ Send your edit instruction for <b>${esc(BIZ_LABEL[business]||business)}</b> × ${esc(platform)}:`);

      // Legacy draft interactions
      } else if (type === 'appd') {
        const d = session.drafts?.find(x => x.id === id);
        if (d) { d.status = 'approved'; d.updatedAt = new Date().toISOString(); await saveSession(session); await tgSend(chatId, `✅ Approved: <i>${esc(d.scenario?.slice(0,80))}</i>`); }
      } else if (type === 'postd') {
        const d = session.drafts?.find(x => x.id === id);
        if (d) { d.status = 'ready_to_post'; d.updatedAt = new Date().toISOString(); await saveSession(session); await tgSend(chatId, `📤 Ready to post: <i>${esc(d.scenario?.slice(0,80))}</i>`); }
      } else if (type === 'skipd') {
        const d = session.drafts?.find(x => x.id === id);
        if (d) { d.status = 'skipped'; d.updatedAt = new Date().toISOString(); await saveSession(session); await tgSend(chatId, '⏭️ Skipped.'); }
      } else if (type === 'regend') {
        await handleSingleGenerate(chatId, id || 'auto', session, bisMemory);
      }

      return res.status(200).json({ ok: true });
    }

    // ── State machine ────────────────────────────────────────────────────────
    const text = (message?.text || '').trim();
    if (!text) return res.status(200).json({ ok: true });

    if (session.state === 'awaiting_edit') {
      session.state = 'idle';
      const lastDraft = session.drafts?.find(d => d.id === session.lastDraftId);
      if (!lastDraft) { await tgSend(chatId, 'No draft to edit. Use /today for a new queue.'); }
      else { await handleSingleGenerate(chatId, lastDraft.business, { ...session, state:'idle' }, bisMemory); }
      return res.status(200).json({ ok: true });
    }

    if (session.state === 'awaiting_edit_post') {
      const postId = session.stateData?.postId;
      session.state     = 'idle';
      session.stateData = null;
      const post = session.posts?.find(p => p.id === postId);
      if (!post) { await tgSend(chatId, 'Post not found. Use /today to regenerate.'); await saveSession(session); return res.status(200).json({ ok: true }); }
      await tgSend(chatId, '⏳ Revising…');
      // Re-generate queue for same product with edit instruction
      const result = await generateQueue(bisMemory, agentMemory, session.posts || []);
      session.posts = [...result.posts, ...(session.posts || [])];
      session.lastPostId = result.posts[0]?.id || null;
      await saveSession(session);
      const detail = formatVersionDetail(result.posts[0], 'A');
      if (detail) await tgSend(chatId, detail.text, detail.opts);
      return res.status(200).json({ ok: true });
    }

    if (session.state === 'awaiting_edit_post2') {
      const { postId, business, platform } = session.stateData || {};
      session.state     = 'idle';
      session.stateData = null;
      await saveSession(session);
      if (!business || !platform) {
        await tgSend(chatId, 'Session expired. Use /post to generate again.');
        return res.status(200).json({ ok: true });
      }
      await generateAndSendPost(chatId, business, platform, 'today', text);
      return res.status(200).json({ ok: true });
    }

    // ── Commands ──────────────────────────────────────────────────────────────
    const rawCmd  = text.split(' ')[0].toLowerCase();
    const cmdArgs = text.slice(rawCmd.length).trim();

    if (rawCmd === '/today' || rawCmd === '/new') {
      await handleQueueGenerate(chatId, session, bisMemory, agentMemory);

    } else if (rawCmd === '/review') {
      const pending = (session.posts || []).filter(p => p.status === 'draft' || p.status === 'needs_review').slice(0, 5);
      if (!pending.length) {
        await tgSend(chatId, '📋 No posts waiting for review.\n\nUse /today to generate a new queue.');
      } else {
        await tgSend(chatId, `📋 <b>${pending.length} post${pending.length!==1?'s':''} waiting for review:</b>`);
        for (let i = 0; i < pending.length; i++) {
          const msg = formatQueueSummary(pending[i], i + 1, pending.length);
          await tgSend(chatId, msg.text, msg.opts);
          await new Promise(r => setTimeout(r, 200));
        }
      }

    } else if (rawCmd === '/approve') {
      // /approve [id][version]  e.g. /approve 1749385920843-0A
      const match = cmdArgs.match(/^(.+?)([ABC])$/);
      if (match) {
        const [, postId, version] = match;
        const post = session.posts?.find(p => p.id === postId.trim());
        if (!post) { await tgSend(chatId, `Post not found: ${esc(postId.trim())}`); }
        else {
          post.selectedVersion = version;
          post.status          = 'approved';
          post.updatedAt       = new Date().toISOString();
          const mem = recordApproval(agentMemory, post, version);
          await Promise.all([saveSession(session), saveMemory(mem)]);
          await tgSend(chatId, `✅ Approved Version ${version}: "${esc(post.versions?.[version]?.hook||'')}"`);
        }
      } else {
        // Legacy draft approve
        const lastDraft = session.drafts?.find(d => d.id === session.lastDraftId);
        if (!lastDraft) { await tgSend(chatId, 'No draft to approve. Use /today to generate.'); }
        else { lastDraft.status = 'approved'; lastDraft.updatedAt = new Date().toISOString(); await saveSession(session); await tgSend(chatId, `✅ Approved: <i>${esc(lastDraft.scenario?.slice(0,80))}</i>`); }
      }

    } else if (rawCmd === '/reject') {
      const [postId, ...reasonParts] = cmdArgs.split(' ');
      const reason = reasonParts.join(' ');
      const post = postId ? session.posts?.find(p => p.id === postId) : null;
      if (post) {
        post.status          = 'rejected';
        post.rejectionReason = reason;
        post.updatedAt       = new Date().toISOString();
        const mem = recordRejection(agentMemory, post, reason);
        await Promise.all([saveSession(session), saveMemory(mem)]);
        await tgSend(chatId, `❌ Rejected${reason ? ': ' + esc(reason) : ''}. Use /today for a new queue.`);
      } else {
        await tgSend(chatId, 'Usage: /reject [post_id] [optional reason]');
      }

    } else if (rawCmd === '/edit') {
      const spaceIdx = cmdArgs.indexOf(' ');
      if (spaceIdx > -1) {
        const postId      = cmdArgs.slice(0, spaceIdx).trim();
        const instruction = cmdArgs.slice(spaceIdx + 1).trim();
        const post = session.posts?.find(p => p.id === postId);
        if (!post) { await tgSend(chatId, `Post not found: ${esc(postId)}`); }
        else {
          post.status          = 'needs_edit';
          post.editInstruction = instruction;
          post.updatedAt       = new Date().toISOString();
          await saveSession(session);
          await tgSend(chatId, `✏️ Noted: "${esc(instruction)}" — regenerating…`);
          await handleQueueGenerate(chatId, session, bisMemory, agentMemory);
        }
      } else {
        session.state = 'awaiting_edit';
        await saveSession(session);
        await tgSend(chatId, '✏️ Send your edit instruction:');
      }

    } else if (rawCmd === '/schedule') {
      const [postId, ...timeParts] = cmdArgs.split(' ');
      const time = timeParts.join(' ');
      const post = session.posts?.find(p => p.id === postId);
      if (!post || !time) { await tgSend(chatId, 'Usage: /schedule [post_id] [time]\nExample: /schedule 1749385920843-0 4:00 PM'); }
      else {
        post.status           = 'scheduled';
        post.recommendedTime  = time;
        post.updatedAt        = new Date().toISOString();
        await saveSession(session);
        await tgSend(chatId, `📅 Scheduled for ${esc(time)}: "${esc(post.versions?.[post.selectedVersion||'A']?.hook||'')}"`);
      }

    } else if (rawCmd === '/postnow') {
      const postId = cmdArgs.trim();
      const post   = session.posts?.find(p => p.id === postId);
      if (!post) { await tgSend(chatId, 'Usage: /postnow [post_id]'); }
      else {
        post.status    = 'ready_to_post';
        post.updatedAt = new Date().toISOString();
        await saveSession(session);
        await tgSend(chatId, `📤 Ready to post now: "${esc(post.versions?.[post.selectedVersion||'A']?.hook||'')}"`);
      }

    } else if (rawCmd === '/status') {
      const posts   = session.posts   || [];
      const today   = new Date().toISOString().slice(0,10);
      const todayP  = posts.filter(p => p.createdAt?.slice(0,10) === today);
      const pending = posts.filter(p => p.status === 'draft' || p.status === 'needs_review');
      const approved= posts.filter(p => p.status === 'approved' || p.status === 'ready_to_post');
      const scheduled=posts.filter(p => p.status === 'scheduled');
      const posted  = posts.filter(p => p.status === 'posted');
      // Pull from schedule engine
      let scheduleLines = '';
      try {
        const sched = await loadSchedule();
        const upcoming = sched.filter(s => s.status === 'scheduled').slice(0, 3);
        if (upcoming.length) {
          scheduleLines = '\n📅 <b>Upcoming:</b>\n' + upcoming.map(s =>
            `  ${s.platform} • ${new Date(s.scheduledTime).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}`
          ).join('\n');
        }
      } catch {}
      // Content memory count
      let memCount = '';
      try {
        const mem = await loadContentMemory();
        memCount = `\n🧠 Content memory: ${mem.length} entries`;
      } catch {}
      await tgSend(chatId,
        `📊 <b>Pipeline Status</b> — ${today}\n\n` +
        `📝 Generated today: ${todayP.length}\n` +
        `🔍 Pending review: ${pending.length}\n` +
        `✅ Approved: ${approved.length}\n` +
        `📅 Scheduled: ${scheduled.length}\n` +
        `✓ Posted: ${posted.length}` +
        scheduleLines + memCount + `\n\nUse /review to see posts waiting for approval.`
      );

    } else if (rawCmd === '/skip') {
      const lastPost = session.posts?.find(p => p.id === session.lastPostId);
      if (lastPost) { lastPost.status = 'rejected'; lastPost.updatedAt = new Date().toISOString(); await saveSession(session); }
      await tgSend(chatId, '⏭️ Skipped.');

    } else if (rawCmd === '/codeit') {
      await handleSingleGenerate(chatId, 'codeit', session, bisMemory);
    } else if (rawCmd === '/lynq') {
      await handleSingleGenerate(chatId, 'lynq', session, bisMemory);
    } else if (rawCmd === '/insurance') {
      await handleSingleGenerate(chatId, 'insurance', session, bisMemory);
    } else if (rawCmd === '/post') {
      await handlePostCommand(chatId, cmdArgs);
    } else if (rawCmd === '/record') {
      await handleRecordCommand(chatId, cmdArgs);
    } else if (rawCmd === '/linkedin') {
      await handleLinkedInCommand(chatId, cmdArgs);

    } else if (rawCmd === '/regenerate' || rawCmd === '/regen') {
      const last = session.posts?.find(p => p.id === session.lastPostId);
      const biz  = last?.product || 'auto';
      await handleQueueGenerate(chatId, session, bisMemory, agentMemory);

    } else if (rawCmd === '/start' || rawCmd === '/help') {
      await tgSend(chatId,
        `<b>🤖 LYNQ Media Agent</b>\n\n` +
        `<b>Full production pack (11 elements):</b>\n` +
        `/post lynq linkedin today\n` +
        `/post codeit instagram tomorrow\n` +
        `/post insurance facebook today\n` +
        `/post all today — all platforms at once\n` +
        `→ concept, caption, shot list, voiceover, image prompt, Canva, CapCut, posting steps\n` +
        `→ approve/reject buttons included\n\n` +
        `<b>Recording plan (video focus):</b>\n` +
        `/record lynq today\n` +
        `/record codeit tomorrow\n` +
        `/record insurance today\n` +
        `→ solo phone recording plan + full production pack\n\n` +
        `<b>LinkedIn content:</b>\n` +
        `/linkedin lynq today\n` +
        `/linkedin codeit today\n` +
        `/linkedin insurance today\n` +
        `/linkedin all today — all businesses at once\n` +
        `→ hook, short post, long founder version, carousel, image prompt, checklist\n\n` +
        `<b>Queue commands:</b>\n` +
        `/today — Generate 3-post queue (3 versions each)\n` +
        `/review — Posts waiting for approval\n` +
        `/approve [id][A/B/C] — Approve a version\n` +
        `/reject [id] [reason] — Reject\n` +
        `/edit [id] [instruction] — Revise\n` +
        `/schedule [id] [time] — Set time\n` +
        `/status — Pipeline summary\n\n` +
        `<b>Quick generate:</b>\n` +
        `/codeit /lynq /insurance — Single draft\n\n` +
        `Nothing auto-posts without your approval.`
      );
    } else {
      await tgSend(chatId, 'Use /today to generate today\'s content queue, or /help for all commands.');
    }

  } catch (e) {
    console.error('Webhook error:', e);
    try { await tgSend(chatId, `❌ Error: ${esc(e.message)}`); } catch {}
  }

  return res.status(200).json({ ok: true });
};
