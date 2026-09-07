"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function SignInForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="adm-form">
      <label htmlFor="passphrase">Passphrase</label>
      <input id="passphrase" name="passphrase" type="password" autoComplete="current-password" required />
      {state?.error ? <p className="adm-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "Checking…" : "Open orders"}</button>
    </form>
  );
}
