#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { compile, __unstable__loadDesignSystem } from "tailwindcss";

const root = process.cwd();
const cssPath = path.join(root, "src/app/globals.css");
const source = fs.readFileSync(cssPath, "utf8");
const require = createRequire(import.meta.url);

function resolveStylesheet(id, base) {
  if (id === "tailwindcss") {
    return require.resolve("tailwindcss/index.css", { paths: [root] });
  }

  if (id.startsWith(".") || id.startsWith("/")) {
    const resolved = path.resolve(base, id);
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(`${resolved}.css`)) return `${resolved}.css`;
    throw new Error(`Unable to resolve stylesheet ${JSON.stringify(id)} from ${base}`);
  }

  // CSS-only packages can expose their entry point exclusively through the
  // package.json "style" export condition. Node's CommonJS resolver does not
  // select that condition, so resolve it explicitly before the JS fallback.
  for (const searchRoot of [base, root]) {
    const packagePath = path.join(searchRoot, "node_modules", id, "package.json");
    if (!fs.existsSync(packagePath)) continue;
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const styleEntry =
      packageJson.exports?.["."]?.style ||
      packageJson.style ||
      (String(packageJson.main || "").endsWith(".css")
        ? packageJson.main
        : "");
    if (styleEntry) return path.resolve(path.dirname(packagePath), styleEntry);
  }

  return require.resolve(id, { paths: [base, root] });
}

async function loadStylesheet(id, base) {
  const resolved = resolveStylesheet(id, base);
  return {
    path: resolved,
    base: path.dirname(resolved),
    content: fs.readFileSync(resolved, "utf8"),
  };
}

const options = {
  base: path.dirname(cssPath),
  from: cssPath,
  loadStylesheet,
};

const criticalCandidates = [
  "h-dvh",
  "w-dvw",
  "min-w-0",
  "max-w-full",
  "whitespace-normal",
  "[overflow-wrap:anywhere]",
  "sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]",
  "max-h-[min(var(--radix-select-content-available-height),calc(100dvh-1rem))]",
  "min-w-[min(var(--radix-select-trigger-width),calc(100dvw-1rem))]",
  "max-w-[calc(100dvw-1rem)]",
  "*:data-[slot=select-value]:[overflow-wrap:anywhere]",
  "[&>[data-slot=dialog-header]]:sticky",
  "[&>[data-slot=dialog-footer]]:sticky",
  "sm:[&>[data-slot=button]]:w-auto",
  "top-[max(0.75rem,env(safe-area-inset-top))]",
  "pt-[max(1rem,env(safe-area-inset-top))]",
  "w-[min(19rem,calc(100dvw-0.75rem))]",
  "min-[360px]:grid-cols-3",
  "max-h-[min(26rem,55dvh)]",
  "overscroll-x-contain",
  "touch-manipulation",
  "size-11",
  "min-h-11",
];

const compiler = await compile(source, options);
const designSystem = await __unstable__loadDesignSystem(source, options);
const invalidCandidates = criticalCandidates.filter(
  (candidate) => designSystem.parseCandidate(candidate).length === 0,
);

if (invalidCandidates.length > 0) {
  console.error("Responsive Tailwind validation found invalid candidates:");
  invalidCandidates.forEach((candidate) => console.error(`- ${candidate}`));
  process.exit(1);
}

const output = compiler.build(criticalCandidates);
if (!output || output.length < 1_000) {
  console.error("Responsive Tailwind validation produced unexpectedly little CSS output.");
  process.exit(1);
}

console.log(
  `Responsive Tailwind compile passed (${criticalCandidates.length} critical candidates, ${output.length} CSS bytes).`,
);
