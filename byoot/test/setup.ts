import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmounts every component rendered by a test after that test finishes —
// without this, successive `render()` calls in the same test file leave
// prior output in `document.body`, and a later `getByTestId` can match
// more than one element (exactly the failure this file exists to prevent).
afterEach(() => {
  cleanup();
});
