// Builds latest.json, the file installed apps read to find an update, from a release's signed assets.
// Usage: node scripts/updater-manifest.mjs <assets folder> <tag> <owner/repo>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [folder, tag, repository] = process.argv.slice(2);
if (!folder || !tag || !repository) throw new Error('Usage: node scripts/updater-manifest.mjs <assets folder> <tag> <owner/repo>');
const files = readdirSync(folder);
const targets = [['windows-x86_64', /-windows-x64-setup\.exe$/], ['darwin-aarch64', /-macos\.app\.tar\.gz$/], ['linux-x86_64', /-x86_64\.AppImage$/]];
const platforms = {};
for (const [platform, pattern] of targets) {
  const file = files.find(name => pattern.test(name));
  // The updater rejects the whole file if any entry is incomplete, so only signed assets are listed.
  if (!file || !files.includes(`${file}.sig`)) continue;
  platforms[platform] = { signature: readFileSync(path.join(folder, `${file}.sig`), 'utf8').trim(), url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(file)}` };
}
if (!Object.keys(platforms).length) {
  console.log('No signed update assets, so no latest.json was written.');
  process.exit(0);
}
const manifest = { version: tag.replace(/^v/, ''), notes: `https://github.com/${repository}/releases/tag/${tag}`, pub_date: new Date().toISOString(), platforms };
writeFileSync(path.join(folder, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json lists ${Object.keys(platforms).join(', ')}.`);
