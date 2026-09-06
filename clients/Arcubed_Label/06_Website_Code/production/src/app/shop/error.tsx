"use client";

import { useEffect } from "react";
import CatalogErrorState from "@/components/CatalogErrorState";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
     
    console.error(error);
  }, [error]);

  return <CatalogErrorState reset={reset} />;
}
