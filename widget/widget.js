(function () {
  'use strict';

  function formatGreeting(config) {
    const name = config.businessName || 'us';
    if (config.isOpenNow === false) {
      return `We're closed right now, but I can still help — ask me a question or leave your info and we'll get back to you.`;
    }
    return `Hi! I'm the virtual assistant for ${name}. Ask me about hours, service area, pricing, or anything else.`;
  }

  function buildQuickReplyAnswer(config, key) {
    if (key === 'hours') {
      const display = config.hours && config.hours.display;
      return display ? `Our hours: ${display}` : `We don't have set hours listed here — please contact us and we'll let you know.`;
    }
    if (key === 'serviceArea') {
      return config.serviceArea
        ? `Here's our service area: ${config.serviceArea}`
        : `Please leave your info and we'll confirm whether we cover your area.`;
    }
    if (key === 'pricing') {
      return config.pricing
        ? `Here's how our pricing works: ${config.pricing}`
        : `Pricing depends on the job — leave your info and we'll follow up with details.`;
    }
    return `Let me get your info so we can help with that.`;
  }

  // --- Browser-only DOM wiring below; skipped entirely under Node (no `document`). ---
  if (typeof document !== 'undefined') {
    (function init() {
      const scriptTag = document.currentScript;
      const apiBase = new URL(scriptTag.src).origin;

      const host = document.createElement('div');
      host.id = 'hvac-chatbot-widget-host';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = `${apiBase}/widget.css`;
      shadow.appendChild(styleLink);

      const bubble = document.createElement('button');
      bubble.className = 'hvac-bubble';
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.textContent = '💬';
      shadow.appendChild(bubble);

      const panel = document.createElement('div');
      panel.className = 'hvac-panel hvac-hidden';
      panel.innerHTML = `
        <div class="hvac-header"><span class="hvac-title"></span><button class="hvac-close" aria-label="Close chat">×</button></div>
        <div class="hvac-messages"></div>
        <div class="hvac-quick-replies">
          <button data-key="hours">Hours</button>
          <button data-key="serviceArea">Service area</button>
          <button data-key="pricing">Pricing</button>
          <button data-key="book">Book a visit</button>
        </div>
        <form class="hvac-input-row">
          <input type="text" placeholder="Type a question..." />
          <button type="submit">Send</button>
        </form>
        <form class="hvac-lead-form hvac-hidden">
          <input type="text" name="name" placeholder="Your name" required />
          <input type="tel" name="phone" placeholder="Phone number" required />
          <textarea name="reason" placeholder="What do you need help with?"></textarea>
          <button type="submit">Send request</button>
        </form>
      `;
      shadow.appendChild(panel);

      let config = null;
      const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      function appendMessage(role, text) {
        const el = document.createElement('div');
        el.className = `hvac-message hvac-message-${role}`;
        el.textContent = text;
        panel.querySelector('.hvac-messages').appendChild(el);
        panel.querySelector('.hvac-messages').scrollTop = panel.querySelector('.hvac-messages').scrollHeight;
      }

      function showLeadForm() {
        panel.querySelector('.hvac-lead-form').classList.remove('hvac-hidden');
      }

      function applyBranding(cfg) {
        // Defensively fall back to default colors if branding is missing or partial
        const DEFAULT_PRIMARY = '#0b1f3a';
        const DEFAULT_ACCENT = '#d9603b';

        const primaryColor = (cfg.branding && typeof cfg.branding.primaryColor === 'string')
          ? cfg.branding.primaryColor
          : DEFAULT_PRIMARY;
        const accentColor = (cfg.branding && typeof cfg.branding.accentColor === 'string')
          ? cfg.branding.accentColor
          : DEFAULT_ACCENT;

        host.style.setProperty('--hvac-primary', primaryColor);
        host.style.setProperty('--hvac-accent', accentColor);
        panel.querySelector('.hvac-title').textContent = cfg.businessName;

        const header = panel.querySelector('.hvac-header');
        const existingLogo = header.querySelector('.hvac-logo');
        if (existingLogo) existingLogo.remove();

        const logoUrl = cfg.branding && typeof cfg.branding.logoUrl === 'string' ? cfg.branding.logoUrl : null;
        if (logoUrl) {
          const logo = document.createElement('img');
          logo.className = 'hvac-logo';
          logo.src = logoUrl;
          logo.alt = '';
          logo.onerror = () => logo.remove();
          header.insertBefore(logo, header.firstChild);
        }
      }

      fetch(`${apiBase}/api/config`)
        .then((r) => r.json())
        .then((cfg) => {
          config = cfg;
          applyBranding(cfg);
          appendMessage('assistant', formatGreeting(cfg));
        })
        .catch(() => {
          appendMessage('assistant', "Hi! I'm having trouble loading right now, but you can still leave your info below.");
          showLeadForm();
        });

      bubble.addEventListener('click', () => {
        panel.classList.toggle('hvac-hidden');
      });
      panel.querySelector('.hvac-close').addEventListener('click', () => {
        panel.classList.add('hvac-hidden');
      });

      panel.querySelector('.hvac-quick-replies').addEventListener('click', (e) => {
        const key = e.target.getAttribute('data-key');
        if (!key || !config) return;
        if (key === 'book') {
          showLeadForm();
          return;
        }
        appendMessage('assistant', buildQuickReplyAnswer(config, key));
      });

      panel.querySelector('.hvac-input-row').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = panel.querySelector('.hvac-input-row input');
        const message = input.value.trim();
        if (!message) return;
        appendMessage('user', message);
        input.value = '';
        try {
          const res = await fetch(`${apiBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, message })
          });
          const body = await res.json();
          appendMessage('assistant', body.answer);
          if (!body.inScope) showLeadForm();
        } catch (err) {
          appendMessage('assistant', "Sorry, I'm having trouble answering right now. Please leave your info below.");
          showLeadForm();
        }
      });

      panel.querySelector('.hvac-lead-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const name = form.name.value.trim();
        const phone = form.phone.value.trim();
        const reason = form.reason.value.trim();
        try {
          const res = await fetch(`${apiBase}/api/lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, name, phone, reason })
          });
          if (res.ok) {
            appendMessage('assistant', `Thanks ${name}! We've got your request and will be in touch shortly.`);
            form.classList.add('hvac-hidden');
          } else {
            appendMessage('assistant', 'Something went wrong saving your request — please call us directly.');
          }
        } catch (err) {
          appendMessage('assistant', 'Something went wrong saving your request — please call us directly.');
        }
      });
    })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatGreeting, buildQuickReplyAnswer };
  }
})();
