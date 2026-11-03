#!/usr/bin/env node
// Static build for GitHub Pages: `npm run build:pages` → ./out
// PAGES_BASE_PATH defaults to /<repository name> (project pages); use PAGES_BASE_PATH= for a root site.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'trova_voli';
const basePath = process.env.PAGES_BASE_PATH ?? `/${repo}`;
const env = { ...process.env, STATIC_EXPORT: '1', PAGES_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: '1' };
const result = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
// Not needed for Actions-based Pages deployments, harmless otherwise: keeps `_next/` from Jekyll.
writeFileSync(path.join('out', '.nojekyll'), '');
console.log(`\nStatic site ready in ./out (base path "${basePath || '/'}").`);
