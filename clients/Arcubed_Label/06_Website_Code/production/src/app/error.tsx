"use client";

// Root error boundary — catches CatalogUnavailableError (or anything else
// thrown) from the Home page's Server Component data fetch. The failure
// itself was already logged server-side (lib/logger.ts) before this
// rendered; this is just the calm, on-brand thing the customer sees.

import { useEffect } from "react";
import CatalogErrorState from "@/components/CatalogErrorState";

export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
     
    console.error(error);
  }, [error]);

  return <CatalogErrorState reset={reset} />;
}
