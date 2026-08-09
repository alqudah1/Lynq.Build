import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom/vitest";

expect.extend(toHaveNoViolations);
afterEach(() => cleanup());
