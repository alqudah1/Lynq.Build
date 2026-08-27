// Kingsbridge Group — single source of truth for contact details that are
// not yet confirmed. Every value below is null until Chris supplies it.
// Nothing on the public site should ever hardcode a phone number, email
// address, or office location directly — read it from KB_CONFIG instead, so
// the real details can be dropped in here once, in one place, when they
// arrive (see 07_Feedback/Client_Presentation/client-assets-needed.md).
var KB_CONFIG = {
  phone: null, // e.g. "(647) 000-0000" — new business line, not yet issued
  email: "admin@kingsbridgegroup.ca",
  offices: [
    { label: "Mississauga", address: "77 City Centre Dr, Suite 501, Mississauga, ON L5B 1M5" },
    { label: "Vaughan", address: "400 Applewood Crescent, Suite 100, Vaughan, ON L4K 0C3" }
  ],
  social: [
    // { label: "Instagram", url: "https://instagram.com/..." },
    // { label: "LinkedIn", url: "https://linkedin.com/company/..." }
  ]
};
