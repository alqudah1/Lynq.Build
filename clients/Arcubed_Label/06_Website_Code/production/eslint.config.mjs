import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Vendored third-party build output (self-hosted Draco decoder, copied
  // from node_modules/three), not source we own.
  { ignores: ["public/draco/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
