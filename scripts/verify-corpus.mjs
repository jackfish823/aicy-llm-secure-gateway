#!/usr/bin/env node
/**
 * Verifies the adversarial corpus is complete and well-formed WITHOUT printing any
 * payload text. Safe to run inside an AI coding session.
 *
 *   node scripts/verify-corpus.mjs
 *
 * Checks: every manifest entry has a file, files are non-empty, no leaked labels or
 * "Expected:" lines from the PDF, and flags common PDF-extraction artifacts.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test/fixtures/corpus');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

const ARTIFACTS = [
  [/[\u2018\u2019]/, 'smart single quote'],
  [/[\u201C\u201D]/, 'smart double quote'],
  [/[\u2013\u2014]/, 'en/em dash'],
  [/\u00A0/, 'non-breaking space'],
  [/\u00AD/, 'soft hyphen'],
  [/\uFB00-\uFB06/, 'ligature'],
  [/[ \t]+$/m, 'trailing whitespace'],
];

const LEAKED_METADATA = [
  [/^\s*(INJ|PII)-[A-E]\d\b/m, 'entry label left in payload'],
  [/^\s*Expected:/m, '"Expected:" line left in payload'],
  [/OWASP LLM\d/, 'OWASP label left in payload'],
];

let failures = 0;
const warn = (id, msg) => { console.log(`  ⚠  ${id}: ${msg}`); };
const fail = (id, msg) => { console.log(`  ✗  ${id}: ${msg}`); failures++; };

console.log(`\ncorpus: ${manifest.entries.length} entries expected\n`);

for (const e of manifest.entries) {
  const path = join(dir, e.file);
  if (!existsSync(path)) { fail(e.id, `missing file ${e.file}`); continue; }

  const raw = readFileSync(path, 'utf8');
  if (raw.trim().length === 0) { fail(e.id, 'file is empty'); continue; }

  for (const [re, label] of LEAKED_METADATA) if (re.test(raw)) fail(e.id, label);
  for (const [re, label] of ARTIFACTS) if (re.test(raw)) warn(e.id, `contains ${label}`);

  const sha = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  const lines = raw.split('\n').length;
  console.log(
    `  ✓  ${e.id.padEnd(7)} ${String(raw.length).padStart(4)}b  ${String(lines).padStart(2)}L  sha:${sha}  ${e.kind}`
  );
}

// Structural spot-checks that do not reveal content.
const need = (id, re, what) => {
  const e = manifest.entries.find((x) => x.id === id);
  if (!e || !existsSync(join(dir, e.file))) return;
  if (!re.test(readFileSync(join(dir, e.file), 'utf8'))) fail(id, `expected to contain ${what}`);
};
need('INJ-A2', /<\|im_start\|>/, 'the <|im_start|> delimiter token');
need('INJ-A2', /<\|im_end\|>/, 'the <|im_end|> delimiter token');
need('INJ-E2', /<!--/, 'an HTML comment opener');
need('INJ-E2', /-->/, 'an HTML comment closer');
need('INJ-E1', /\[SYSTEM\]/, 'the forged [SYSTEM] marker');
need('INJ-A3', /\[ADMIN\]/, 'the forged [ADMIN] marker');

const d3 = manifest.entries.find((x) => x.id === 'PII-D3');
if (d3 && existsSync(join(dir, d3.file))) {
  try { JSON.parse(readFileSync(join(dir, d3.file), 'utf8')); }
  catch { fail('PII-D3', 'payload is not valid JSON — extraction likely mangled it'); }
}

console.log(
  failures === 0
    ? `\n✓ corpus verified — ${manifest.entries.length} entries, 0 failures\n`
    : `\n✗ ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 1 & 0 : 1);
