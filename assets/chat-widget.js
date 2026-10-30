/* LYNQ AI assistant widget — self-contained, streams from /api/chat */
(function () {
  const API_URL = '/api/chat';

  const style = document.createElement('style');
  style.textContent = `
    #lynq-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 58px; height: 58px; border-radius: 50%;
      background: #c8ff5a; color: #080808;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45);
      transition: transform 0.2s ease;
      font-family: 'Outfit', sans-serif;
    }
    #lynq-chat-btn:hover { transform: scale(1.06); }
    #lynq-chat-btn svg { width: 24px; height: 24px; }
    #lynq-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 500px; max-height: calc(100vh - 140px);
      background: #0e0e0e; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; display: none; flex-direction: column;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      font-family: 'Outfit', sans-serif;
    }
    #lynq-chat-panel.open { display: flex; }
    #lynq-chat-header {
      padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: space-between;
    }
    #lynq-chat-header-title { color: #fff; font-size: 0.85rem; font-weight: 500; letter-spacing: 0.04em; }
    #lynq-chat-header-sub { color: rgba(255,255,255,0.35); font-size: 0.68rem; margin-top: 2px; }
    #lynq-chat-close { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 4px; }
    #lynq-chat-close:hover { color: #fff; }
    #lynq-chat-msgs { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .lynq-msg { font-size: 0.84rem; line-height: 1.55; max-width: 88%; padding: 10px 13px; border-radius: 12px; white-space: pre-wrap; }
    .lynq-msg.user { align-self: flex-end; background: #fff; color: #080808; border-bottom-right-radius: 3px; }
    .lynq-msg.assistant { align-self: flex-start; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.88); border-bottom-left-radius: 3px; }
    .lynq-msg.assistant.pending::after { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.4); margin-left: 4px; animation: lynq-pulse 1s ease-in-out infinite; }
    @keyframes lynq-pulse { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
    #lynq-chat-form { display: flex; gap: 8px; padding: 14px; border-top: 1px solid rgba(255,255,255,0.08); }
    #lynq-chat-input {
      flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px; padding: 9px 14px; color: #fff; font-family: inherit; font-size: 0.82rem; outline: none;
    }
    #lynq-chat-input:focus { border-color: rgba(255,255,255,0.3); }
    #lynq-chat-send {
      background: #fff; color: #080808; border: none; border-radius: 20px;
      padding: 9px 16px; font-size: 0.78rem; font-weight: 600; cursor: pointer; flex-shrink: 0;
    }
    #lynq-chat-send:disabled { opacity: 0.4; cursor: default; }
    @media (max-width: 480px) {
      #lynq-chat-panel { right: 16px; bottom: 88px; }
      #lynq-chat-btn { right: 16px; bottom: 16px; }
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'lynq-chat-btn';
  btn.setAttribute('aria-label', 'Chat with LYNQ');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

  const panel = document.createElement('div');
  panel.id = 'lynq-chat-panel';
  panel.innerHTML = `
    <div id="lynq-chat-header">
      <div>
        <div id="lynq-chat-header-title">LYNQ Assistant</div>
        <div id="lynq-chat-header-sub">Find a service, explore the Office, or ask for help</div>
      </div>
      <button id="lynq-chat-close" aria-label="Close chat">&times;</button>
    </div>
    <div id="lynq-chat-msgs"></div>
    <form id="lynq-chat-form">
      <input id="lynq-chat-input" type="text" placeholder="What are you looking for?" autocomplete="off">
      <button id="lynq-chat-send" type="submit">Send</button>
    </form>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const msgsEl = panel.querySelector('#lynq-chat-msgs');
  const formEl = panel.querySelector('#lynq-chat-form');
  const inputEl = panel.querySelector('#lynq-chat-input');
  const sendEl = panel.querySelector('#lynq-chat-send');
  const closeEl = panel.querySelector('#lynq-chat-close');

  let history = [];
  let opened = false;

  function addMsg(role, text) {
    const el = document.createElement('div');
    el.className = `lynq-msg ${role}`;
    el.textContent = text;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  function openPanel() {
    panel.classList.add('open');
    if (!opened) {
      opened = true;
      addMsg('assistant', "Welcome to LYNQ. Are you looking for a website, digital transformation, the LYNQ Office, or help signing in?");
    }
    inputEl.focus();
  }
  function closePanel() { panel.classList.remove('open'); }

  btn.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());

  // Exposed so other elements on the page (e.g. a "Try it live" button) can open the widget.
  window.LynqChat = { open: openPanel, close: closePanel };
  closeEl.addEventListener('click', closePanel);

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    sendEl.disabled = true;

    addMsg('user', text);
    history.push({ role: 'user', content: text });

    const replyEl = addMsg('assistant', '');
    replyEl.classList.add('pending');
    let full = '';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        replyEl.classList.remove('pending');
        replyEl.textContent = body.error === 'Too many messages right now — try again in a bit.'
          ? body.error
          : "Sorry, something went wrong — try again in a moment.";
        sendEl.disabled = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6).trim());
            if (parsed.text) {
              full += parsed.text;
              replyEl.classList.remove('pending');
              replyEl.textContent = full;
              msgsEl.scrollTop = msgsEl.scrollHeight;
            } else if (parsed.error && !full) {
              replyEl.classList.remove('pending');
              replyEl.textContent = "I couldn't reach the live assistant just now. I can still help you choose between websites, digital transformation, the LYNQ Office, and AI automation—please try once more.";
            }
          } catch {}
        }
      }
      if (!full && !replyEl.textContent) {
        replyEl.classList.remove('pending');
        replyEl.textContent = "I couldn't reach the live assistant just now. Please try again, or use Start a Project and the LYNQ team will respond directly.";
      }
      history.push({ role: 'assistant', content: full || replyEl.textContent });
    } catch (err) {
      replyEl.classList.remove('pending');
      replyEl.textContent = "Sorry, something went wrong — try again in a moment.";
    }

    sendEl.disabled = false;
  });
})();
