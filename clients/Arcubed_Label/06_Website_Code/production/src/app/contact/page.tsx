"use client";

// UI only — no backend wired yet (no Supabase, per project scope). Submitting
// shows a confirmation toast and resets the form; nothing is actually sent
// anywhere yet, and nothing here claims otherwise. No phone/email is shown
// since none has been confirmed by the client — only the Instagram handle
// already established in the approved design direction.

import { useState } from "react";
import { showToast } from "@/lib/toast";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    showToast("Thank you. We'll be in touch shortly.");
    setName("");
    setEmail("");
    setMessage("");
  }

  return (
    <section className="section">
      <div className="page-head">
        <p className="eyebrow">Contact</p>
        <h1>Say hello.</h1>
      </div>
      <p className="page-copy" style={{ marginBottom: 32 }}>
        Questions about a custom order, or something else on your mind? Send a
        message below, or find us on Instagram{" "}
        <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">
          @arcubedlabel
        </a>
        .
      </p>
      <form className="contact-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="message">Message</label>
          <textarea id="message" required value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit">
          Send Message
        </button>
      </form>
    </section>
  );
}
