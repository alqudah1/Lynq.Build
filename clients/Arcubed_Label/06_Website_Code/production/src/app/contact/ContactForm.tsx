"use client";

// Messages are persisted to public.contact_inquiries via a validated server
// action and read in the admin at /admin/inquiries. An email notification is
// attempted after the row commits, but nothing here claims a message was
// emailed — the confirmation says it was received, which is true whether or
// not the notification credential is configured.
// Instagram is the one confirmed contact channel; no phone or email is shown
// because none has been confirmed.

import { useState } from "react";
import { submitInquiry } from "./actions";

const TOPICS = ["Custom order", "Colours & yarns", "Shipping", "Ready for Delivery", "An existing order"];

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await submitInquiry({ name, email, topic, message, website });
      if (!res.ok) {
        setErrors(res.errors);      // values deliberately preserved
        setBusy(false);
        return;
      }
      setSent(true);
      setName(""); setEmail(""); setMessage(""); setTopic(TOPICS[0]);
    } catch {
      setErrors(["We couldn't reach the server. Please try again, or message us on Instagram."]);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="ct-sent" role="status">
        <p className="ct-sent-line">Message received.</p>
        <p className="ct-sent-note">
          We&rsquo;ll come back to you by email. For a faster reply, message{" "}
          <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">@arcubedlabel</a>.
        </p>
      </div>
    );
  }

  return (
    <form className="ct-form" onSubmit={handleSubmit} noValidate>
      {errors.length ? (
        <div className="co-errors" role="alert">
          {errors.map((m) => <p key={m}>{m}</p>)}
        </div>
      ) : null}
      {/* Honeypot — visually hidden, not display:none, so bots still fill it. */}
      <div className="ct-hp" aria-hidden="true">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" tabIndex={-1} autoComplete="off" value={website}
               onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="ct-row">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ct-row">
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="ct-row ct-row-select">
        <label htmlFor="c-topic">Topic</label>
        <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="ct-row">
        <label htmlFor="c-msg">Message</label>
        <textarea id="c-msg" rows={5} required value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <button className="ct-send" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
