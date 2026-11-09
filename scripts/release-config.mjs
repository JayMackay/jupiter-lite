// Writes src-tauri/release-config.json for one release: the version from the tag and, when update
// signing is set up (UPDATER_SIGNING=true and the TAURI_UPDATER_PUBKEY variable), the updater.
import { writeFileSync } from 'node:fs';

const tag = process.argv[2] || '';
const version = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Release tag ${tag} is not a version like v1.2.3.`);
const config = { version };
const pubkey = process.env.TAURI_UPDATER_PUBKEY?.trim();
const repository = process.env.GITHUB_REPOSITORY;
if (pubkey && process.env.UPDATER_SIGNING === 'true' && repository) {
  config.bundle = { createUpdaterArtifacts: true };
  config.plugins = { updater: { pubkey, endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`], windows: { installMode: 'passive' } } };
} else {
  console.warn('::warning::Update signing is not set up, so installed apps will not update to this release automatically.');
}
writeFileSync('src-tauri/release-config.json', JSON.stringify(config, null, 2) + '\n');
