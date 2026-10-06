// Kingsbridge Group — GA4 click events.
//
// The Google tag itself (gtag.js, G-JWFYMEP5VK) is installed inline at the top of <head> on
// every public page, exactly as Google supplied it. This file only adds site events on top.
// generate_lead lives in the contact form's own submit handler (contact/index.html), because
// only that handler knows whether a submission genuinely succeeded.
//
// PRIVACY: never send the visitor's name, email, phone, message or any form contents, and
// never the Kingsbridge number itself — only where on the site the click happened.

(function () {
  // Guard against this file ever being included twice, which would double every event.
  if (window.__kbAnalyticsBound) return;
  window.__kbAnalyticsBound = true;

  function send(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  }

  // phone_click — one delegated listener on the document, because the footer number is
  // injected after load (partials/footer.html) and would miss a directly-bound listener.
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (!link) return;
    send('phone_click', {
      click_location: link.closest('.site-footer') ? 'footer' : (document.body.getAttribute('data-page') || 'page')
    });
  }, true);
})();
