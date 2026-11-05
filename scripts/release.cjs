const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = 'widgets/version.json';
const SCRIPTS = ['telcel', 'bait'].flatMap(carrier =>
  ['solid', 'image'].map(design => `widgets/${carrier}/${design}.js`));
const VERSION_PATTERN = /^const WIDGET_VERSION = "([^"]+)";$/gm;

function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version components must be safe integers.');
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

function scriptVersion(source, filename) {
  const matches = [...source.matchAll(VERSION_PATTERN)];
  if (matches.length !== 1) throw new Error(`Expected one WIDGET_VERSION in ${filename}.`);
  versionParts(matches[0][1]);
  return matches[0][1];
}

function readRelease(root = ROOT) {
  const manifestText = fs.readFileSync(path.join(root, MANIFEST), 'utf8');
  const manifest = JSON.parse(manifestText);
  versionParts(manifest.version);
  const sources = new Map();
  for (const filename of SCRIPTS) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    if (scriptVersion(source, filename) !== manifest.version) {
      throw new Error(`${filename} does not match ${MANIFEST} (${manifest.version}).`);
    }
    sources.set(filename, source);
  }
  return { version: manifest.version, manifest, manifestText, sources };
}

function nextPatch(version) {
  const parts = versionParts(version);
  if (!Number.isSafeInteger(parts[2] + 1)) throw new Error('Patch version is too large.');
  parts[2]++;
  return parts.join('.');
}

function prepare(version, root = ROOT) {
  versionParts(version);
  const current = readRelease(root);
  if (compareVersions(version, current.version) <= 0) throw new Error('The new version must be higher than the current version.');
  const changes = new Map([[MANIFEST, `${JSON.stringify({ ...current.manifest, version }, null, 2)}\n`]]);
  for (const [filename, source] of current.sources) {
    changes.set(filename, source.replace(VERSION_PATTERN, `const WIDGET_VERSION = "${version}";`));
  }
  // Validate everything before writing; roll back if a filesystem write fails.
  const originals = new Map([[MANIFEST, current.manifestText], ...current.sources]);
  const written = [];
  try {
    for (const [filename, source] of changes) {
      written.push(filename);
      fs.writeFileSync(path.join(root, filename), source);
    }
  } catch (error) {
    for (const filename of written.reverse()) fs.writeFileSync(path.join(root, filename), originals.get(filename));
    throw error;
  }
  return version;
}

if (require.main === module) {
  try {
    const [command, value, ...extra] = process.argv.slice(2);
    if (extra.length || (command !== 'prepare' && value !== undefined)) throw new Error('Unexpected arguments.');
    if (command === 'check') console.log(readRelease().version);
    else if (command === 'next') console.log(nextPatch(readRelease().version));
    else if (command === 'prepare' && value) console.log(prepare(value));
    else throw new Error('Usage: node scripts/release.cjs check | next | prepare VERSION');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ROOT, MANIFEST, SCRIPTS, versionParts, compareVersions, scriptVersion, readRelease, nextPatch, prepare };
