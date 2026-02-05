#!/usr/bin/env npx tsx
/**
 * Script to generate models snapshot from models.dev API
 *
 * This script regenerates the bundled snapshot file (src/models/models-snapshot.ts)
 * which provides offline fallback data when the models.dev API is unavailable.
 *
 * Run with: pnpm run update-models-snapshot
 *
 * The script uses the same API URL as the runtime module (ModelsDev.url()).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { url } from '../src/models/models-dev';

const OUTPUT_PATH = path.join(import.meta.dirname, '../src/models/models-snapshot.ts');

async function main(): Promise<void> {
  const apiUrl = url() + '/api.json';
  console.log('Fetching models from', apiUrl);

  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': 'atomic-cli' },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const timestamp = new Date().toISOString();

  const content = `/**
 * Bundled snapshot of models.dev data.
 * This file is auto-generated and provides offline fallback data.
 * Regenerate by running: pnpm run update-models-snapshot
 *
 * Generated at: ${timestamp}
 */

import type { ModelsDev } from './models-dev';

const snapshot: ModelsDev.Database = ${JSON.stringify(data, null, 2)};

export default snapshot;
`;

  await fs.writeFile(OUTPUT_PATH, content, 'utf-8');
  console.log('Successfully wrote models snapshot to', OUTPUT_PATH);
}

main().catch((error: Error) => {
  console.error('Error generating models snapshot:', error.message);
  process.exit(1);
});
