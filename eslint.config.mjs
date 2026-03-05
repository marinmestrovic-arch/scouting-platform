import js from "@eslint/js";
import { createRequire } from "node:module";
import tseslint from "typescript-eslint";

const require = createRequire(import.meta.url);
const nextPlugin = require(
  require.resolve("@next/eslint-plugin-next", {
    paths: [require.resolve("eslint-config-next/package.json")],
  }),
);
const nextCoreWebVitals = nextPlugin.flatConfig.coreWebVitals;

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Keep plugin registered at config root so Next.js build-time detection can find it.
    plugins: {
      "@next/next": nextPlugin,
    },
  },
  {
    name: nextCoreWebVitals.name,
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    rules: {
      ...nextCoreWebVitals.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      ...(nextCoreWebVitals.settings ?? {}),
      next: {
        ...(nextCoreWebVitals.settings?.next ?? {}),
        rootDir: "apps/web/",
      },
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["apps/web/next-env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
];
