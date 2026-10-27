// Runs every test in package.json once: each `test:*` script is split at `&&`,
// `npm run test:*` steps are expanded, and repeated commands run only once.
// Every command runs even after a failure; the summary lists the failures and
// the slowest commands, and the exit code is 1 when any command failed.
//   node scripts/run-all-tests.mjs [--jobs N]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;

const jobsFlag = process.argv.indexOf("--jobs");
const jobs = jobsFlag > -1 ? Math.max(1, Number(process.argv[jobsFlag + 1]) || 1) : Math.max(1, availableParallelism() - 1);

function leafCommands(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const script = scripts[name];
  if (!script) throw new Error(`package.json has no script "${name}"`);
  return script.split("&&").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const nested = part.match(/^npm run ([\w:-]+)$/);
    return nested ? leafCommands(nested[1], seen) : [part];
  });
}

const commands = [...new Set(
  Object.keys(scripts).filter((name) => name.startsWith("test:")).flatMap((name) => leafCommands(name)),
)];

function run(command) {
  return new Promise((resolve) => {
    const started = performance.now();
    // Each test runs on the same Node as this runner, not whichever `node` is on PATH.
    const resolved = command.replace(/^node /, `"${process.execPath}" `);
    const child = spawn(resolved, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolve({ command, code, output, seconds: (performance.now() - started) / 1000 }));
  });
}

const started = performance.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, commands.length) }, async () => {
  while (next < commands.length) {
    const result = await run(commands[next++]);
    results.push(result);
    console.log(`${result.code === 0 ? "PASS" : "FAIL"}  ${result.seconds.toFixed(1).padStart(5)}s  ${result.command}`);
  }
}));

const failed = results.filter((result) => result.code !== 0);
for (const result of failed) {
  console.log(`\n──── FAIL: ${result.command}\n${result.output.trim().split("\n").slice(-40).join("\n")}`);
}
console.log("\nSlowest:");
for (const result of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 8)) {
  console.log(`  ${result.seconds.toFixed(1).padStart(5)}s  ${result.command}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((performance.now() - started) / 1000).toFixed(1)}s (${jobs} at a time).`);
process.exit(failed.length ? 1 : 0);
