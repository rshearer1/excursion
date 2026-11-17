// Syntax check for every Node script outside grid-tool (grid-tool has its own typecheck).
//
//   node scripts/check-syntax.mjs        (or: npm run check, from the repo root)
//
// Runs `node --check` on each .mjs file under blender/ and scripts/. Nothing is executed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mjsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "jobs" && entry.name !== "scenes") out.push(...mjsFiles(full));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

const files = ["blender", "scripts"].flatMap((d) => mjsFiles(path.join(ROOT, d)));
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(ROOT, file)}\n${r.stderr}`);
  }
}
console.log(`check-syntax: ${files.length - failed}/${files.length} .mjs files OK`);
process.exit(failed ? 1 : 0);
