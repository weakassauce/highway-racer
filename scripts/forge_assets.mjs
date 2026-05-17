// Enqueue AssetForge generation jobs and download GLBs into public/assets/.
// Usage: node scripts/forge_assets.mjs
// Requires AssetForge running on http://127.0.0.1:8000

import fs from 'node:fs/promises';
import path from 'node:path';

const FORGE = 'http://127.0.0.1:8000/api/v1';
const OUT = path.resolve('public', 'assets');

const JOBS = [
  { name: 'player_car', prompt: 'sleek modern Japanese sports car, low-slung silhouette, aggressive front bumper with sharp angular headlights, side profile orthographic view, game-ready low-poly, glossy midnight blue paint with chrome trim and tinted windows, isolated on plain white background' },
  { name: 'traffic_car', prompt: 'generic modern sedan, four-door family car, plain silver paint, side profile orthographic view, game-ready low-poly, isolated on plain white background' },
];

async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
async function getJSON(url, { retries = 6 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 2000 + i * 1000));
    }
  }
  throw lastErr;
}
async function downloadGLB(url, dst) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await fs.writeFile(dst, Buffer.from(await r.arrayBuffer()));
}
async function waitForJob(jobId) {
  let last = '', lastProgress = -1;
  while (true) {
    const s = await getJSON(`${FORGE}/generate/${jobId}`);
    const p = s.progress ?? 0;
    if (s.status !== last || Math.abs(p - lastProgress) >= 0.1) {
      console.log(`  [${jobId}] ${s.status} ${(p * 100).toFixed(0)}% ${s.message || ''}`);
      last = s.status; lastProgress = p;
    }
    if (s.status === 'completed' || s.status === 'failed') return s;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function adoptOrStart(job) {
  const envKey = `${job.name.toUpperCase()}_JOB_ID`;
  if (process.env[envKey]) {
    console.log(`  adopting existing job ${process.env[envKey]}`);
    return process.env[envKey];
  }
  const start = await postJSON(`${FORGE}/generate`, { prompt: job.prompt, grid_size: 2, animate: false });
  return start.job_id || start.id || start.jobId;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  for (const job of JOBS) {
    const dst = path.join(OUT, `${job.name}.glb`);
    try { await fs.access(dst); console.log(`✓ ${job.name} already exists, skipping`); continue; } catch {}

    console.log(`→ ${job.name}: "${job.prompt.slice(0, 60)}..."`);
    const id = await adoptOrStart(job);
    const final = await waitForJob(id);
    if (final.status !== 'completed') { console.error('  failed', final); continue; }
    const assetId = final.asset_id || final.assetId || (final.result && final.result.asset_id) || id;
    await downloadGLB(`${FORGE}/assets/${assetId}/file`, dst);
    console.log(`  saved ${dst}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
