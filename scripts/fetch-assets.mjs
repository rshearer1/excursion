// Excursion asset fetcher — Poly Haven + ambientCG, manifest-driven, cached.
//
// usage: node scripts/fetch-assets.mjs blender/scenes/void.manifest.json
//
// Manifest shape:
//   { "assets": [
//       { "id": "polyhaven:studio_small_09", "kind": "hdri", "res": "2k" },
//       { "id": "ambientcg:Plastic006", "res": "2K" },
//       { "id": "url:pmc/PMC6-2.stl", "url": "https://pmc-speakers.com/wp-content/uploads/2024/05/PMC6-2.stl" }
//   ] }
//
// "url:<relative path>" fetches any direct download into assets/cache/<relative path>
// (used for the PMC6-2 CAD model from pmc-speakers.com/3d-cad-downloads).
//
// Files land in assets/cache/<provider>/ (gitignored). Existing files are
// skipped, so scenes rebuild identically on any machine. ambientCG zips are
// extracted next to themselves via the system tar (bsdtar handles zip on
// Windows 10+, macOS and most Linuxes).

import { mkdir, access, readFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileP = promisify(execFile);
const UA = { "User-Agent": "excursion-asset-fetcher/0.1 (personal project)" };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const cacheRoot = path.join(root, "assets", "cache");

const exists = (p) => access(p).then(() => true, () => false);

async function download(url, dest) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchPolyhaven(id, { kind = "hdri", res = "2k" }) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  if (kind === "hdri") {
    const url = files?.hdri?.[res]?.hdr?.url;
    if (!url) throw new Error(`polyhaven:${id} has no ${res} hdr`);
    const dest = path.join(cacheRoot, "polyhaven", `${id}_${res}.hdr`);
    if (await exists(dest)) return { dest, cached: true };
    await download(url, dest);
    return { dest, cached: false };
  }
  throw new Error(`polyhaven kind "${kind}" not supported yet (hdri only)`);
}

async function fetchAmbientcg(id, { res = "2K" }) {
  const attr = `${res}-JPG`;
  const dest = path.join(cacheRoot, "ambientcg", `${id}_${attr}.zip`);
  const extractDir = dest.replace(/\.zip$/, "");
  if ((await exists(extractDir)) && (await readdir(extractDir)).length > 0) {
    return { dest: extractDir, cached: true };
  }

  let url = `https://ambientcg.com/get?file=${id}_${attr}.zip`;
  try {
    const data = await fetchJson(
      `https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`,
    );
    const cats = data?.foundAssets?.[0]?.downloadFolders?.default?.downloadFiletypeCategories;
    const hit = cats?.zip?.downloads?.find((d) => d.attribute === attr);
    if (hit?.downloadLink) url = hit.downloadLink;
  } catch {
    /* API shape drift — the constructed get?file= URL is the documented fallback */
  }
  if (!(await exists(dest))) await download(url, dest);
  await mkdir(extractDir, { recursive: true });
  // Windows' System32 tar is bsdtar, which reads zip; MSYS GNU tar (first on a
  // Git Bash PATH) does not. On mac/linux the PATH tar is bsdtar or the user
  // has unzip-capable tooling.
  const tarBin =
    process.platform === "win32"
      ? path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  await execFileP(tarBin, ["-xf", path.basename(dest), "-C", path.basename(extractDir)], {
    cwd: path.dirname(dest),
  });
  return { dest: extractDir, cached: false };
}

async function fetchUrl(relPath, { url }) {
  if (!url) throw new Error(`url:${relPath} needs a "url" field`);
  const dest = path.join(cacheRoot, ...relPath.split("/"));
  if (await exists(dest)) return { dest, cached: true };
  await download(url, dest);
  return { dest, cached: false };
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: node scripts/fetch-assets.mjs <scene.manifest.json>");
  process.exit(1);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

let failures = 0;
for (const asset of manifest.assets ?? []) {
  const [provider, ...rest] = asset.id.split(":");
  const id = rest.join(":");
  try {
    const fetcher = { polyhaven: fetchPolyhaven, ambientcg: fetchAmbientcg, url: fetchUrl }[provider];
    if (!fetcher) throw new Error(`unknown provider "${provider}"`);
    const { dest, cached } = await fetcher(id, asset);
    console.log(`${cached ? "cached" : "fetched"}  ${asset.id}  ->  ${path.relative(root, dest)}`);
  } catch (e) {
    failures++;
    console.error(`FAILED  ${asset.id}  ${e instanceof Error ? e.message : e}`);
  }
}
// exitCode, not process.exit(): Node 24 on Windows can abort in libuv when exit() races the
// closing download streams ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)").
process.exitCode = failures ? 1 : 0;
