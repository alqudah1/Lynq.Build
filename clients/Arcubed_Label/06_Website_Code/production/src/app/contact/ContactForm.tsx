"use client";

// UI only — there is no backend for this form yet. It confirms and clears,
// and says so plainly rather than implying a message was delivered.
// Instagram is the one contact channel confirmed for Arcubed; no phone or
// email is shown because none has been confirmed.

import { useState } from "react";
import { showToast } from "@/lib/toast";

const TOPICS = ["Custom order", "Colours & yarns", "Shipping", "Ready for Delivery", "An existing order"];

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    showToast("Thanks — message noted. Reach us on Instagram @arcubedlabel for a faster reply.");
    setName(""); setEmail(""); setMessage(""); setTopic(TOPICS[0]);
  }

  return (
    <>
      <form className="ct-form" onSubmit={handleSubmit}>
        <div className="ct-row">
          <label htmlFor="c-name">Name</label>
          <input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="ct-row">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ct-row">
          <label htmlFor="c-topic">Topic</label>
          <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="ct-row">
          <label htmlFor="c-msg">Message</label>
          <textarea id="c-msg" rows={5} required value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <button className="ct-send" type="submit">Send message</button>
      </form>
      <p className="ct-ig">
        Fastest reply is on Instagram —{" "}
        <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">@arcubedlabel</a>
      </p>
    </>
  );
}
