import { redirect } from "next/navigation";

/**
 * Public-site handoff target. The organisation dashboard applies the real
 * session gate, so this friendly entry route never exposes the Office to
 * visitors who are not signed in.
 */
export default function OfficeEntryPage() {
  redirect("/app/lynq");
}
