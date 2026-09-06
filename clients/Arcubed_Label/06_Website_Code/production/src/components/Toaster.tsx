"use client";

import { useEffect, useState } from "react";

export default function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    let clearTimer: ReturnType<typeof setTimeout>;
    function onToast(e: Event) {
      clearTimeout(hideTimer);
      clearTimeout(clearTimer);
      const detail = (e as CustomEvent<string>).detail;
      setMessage(detail);
      setShow(false);
      requestAnimationFrame(() => setShow(true));
      hideTimer = setTimeout(() => {
        setShow(false);
        clearTimer = setTimeout(() => setMessage(null), 300);
      }, 1800);
    }
    window.addEventListener("arcubed:toast", onToast);
    return () => {
      window.removeEventListener("arcubed:toast", onToast);
      clearTimeout(hideTimer);
      clearTimeout(clearTimer);
    };
  }, []);

  if (!message) return null;
  return <div className={`toast${show ? " show" : ""}`}>{message}</div>;
}
