import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const platform = process.argv[2];
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
if (version !== config.version) throw new Error('Package and installer versions must match');

const formats = {
  linux: [
    ['deb', '.deb', `Trace-${version}-ubuntu-24.04-amd64.deb`],
    ['appimage', '.AppImage', `Trace-${version}-linux-x86_64.AppImage`],
  ],
  windows: [['nsis', '.exe', `Trace-${version}-windows-x64-setup.exe`]],
}[platform];
if (!formats) throw new Error('Usage: node scripts/collect-installers.mjs linux|windows');

const destination = 'release/installers';
await mkdir(destination, { recursive: true });
const checksums = [];
for (const [format, extension, name] of formats) {
  const folder = path.join('src-tauri/target/release/bundle', format);
  const matches = (await readdir(folder)).filter(file => file.endsWith(extension));
  if (matches.length !== 1) throw new Error(`Expected one ${format} installer; found ${matches.length}`);
  const source = path.join(folder, matches[0]);
  const bytes = await readFile(source);
  if (!bytes.length) throw new Error(`Empty installer: ${source}`);
  await copyFile(source, path.join(destination, name));
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  console.log(`Prepared ${name} (${bytes.length} bytes)`);
}
await copyFile('INSTALL.md', path.join(destination, 'INSTALL.md'));
await writeFile(path.join(destination, `SHA256SUMS-${platform}.txt`), checksums.join('\n') + '\n');
