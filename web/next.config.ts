import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El repo tiene lockfiles en la raíz y en web/: fija cuál es el workspace.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default config;
