#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') return {};

  const endIdx = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (endIdx === -1) return {};

  const metadata = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.substring(0, colonIdx).trim();
    let value = line.substring(colonIdx + 1).trim();

    // Handle quoted strings
    value = value.replace(/^["']|["']$/g, '');

    // Handle arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    }

    metadata[key] = value;
  }
  return metadata;
}

function findSkills(dir) {
  const skills = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === 'SKILL.md') {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const meta = parseFrontmatter(content);
          if (typeof meta.name === 'string' && typeof meta.description === 'string') {
            const item = { name: meta.name, description: meta.description, path: fullPath };
            if (meta['allowed-tools']) item['allowed-tools'] = meta['allowed-tools'];
            skills.push(item);
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  walk(dir);
  return skills;
}

if (process.argv.length < 3) {
  console.error('Usage: list-skills <skills-directory>');
  process.exit(1);
}

const root = process.argv[2].replace(/^~/, process.env.HOME);
if (!fs.existsSync(root)) {
  console.error(`missing skills dir: ${root}`);
  process.exit(1);
}

const skills = findSkills(root);
skills.sort((a, b) => a.name.localeCompare(b.name));
console.log(JSON.stringify(skills, null, 2));
