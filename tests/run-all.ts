// Runs every manual/dev-DB test script in tests/ (this file excluded) in one
// pass and aggregates their results. There's still no unit-test runner wired
// up (see tests/README.md) — this just sequences the existing standalone
// scripts and sums up each one's own `=== N passed, M failed ===` line,
// since that's the only structured signal they print.
//
// Run with `npx tsx tests/run-all.ts` (dev server + dev DB must be up, same
// prerequisite as running any individual script).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const testsDir = __dirname;
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith(".ts") && f !== "run-all.ts")
  .sort();

type FileResult = { file: string; passed: number; failed: number; crashed: boolean };

const results: FileResult[] = [];

for (const file of files) {
  const filePath = path.join(testsDir, file);
  console.log(`\n${"=".repeat(70)}\nRunning ${file}\n${"=".repeat(70)}`);

  // Filenames come from readdirSync on this trusted tests/ directory, not
  // external input — safe to interpolate into one shell string, which also
  // sidesteps Node's shell:true + args-array deprecation warning.
  const proc = spawnSync(`npx tsx "${filePath}"`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: true,
  });

  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (proc.error) {
    console.error(`spawn error for ${file}:`, proc.error);
  }

  const summaryMatch = /=== (\d+) passed, (\d+) failed ===/.exec(stdout);
  if (summaryMatch) {
    results.push({ file, passed: Number(summaryMatch[1]), failed: Number(summaryMatch[2]), crashed: false });
  } else {
    results.push({ file, passed: 0, failed: 0, crashed: true });
  }
}

console.log(`\n${"=".repeat(70)}\nRegression suite summary\n${"=".repeat(70)}`);

let totalPassed = 0;
let totalFailed = 0;
let crashedFiles = 0;

for (const r of results) {
  if (r.crashed) {
    crashedFiles++;
    console.log(`CRASHED - ${r.file} (no summary line found — see output above)`);
  } else {
    totalPassed += r.passed;
    totalFailed += r.failed;
    console.log(`${r.failed > 0 ? "FAIL" : "PASS"} - ${r.file}: ${r.passed} passed, ${r.failed} failed`);
  }
}

const totalAssertions = totalPassed + totalFailed;
console.log(
  `\n=== ${files.length} files, ${totalAssertions} assertions: ${totalPassed} passed, ${totalFailed} failed, ${crashedFiles} file(s) crashed ===`
);

if (totalFailed > 0 || crashedFiles > 0) {
  process.exitCode = 1;
}
