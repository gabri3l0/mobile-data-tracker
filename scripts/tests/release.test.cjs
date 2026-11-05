const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SCRIPTS, MANIFEST, prepare, readRelease, nextPatch, compareVersions } = require('../release.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdt-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const filename of [MANIFEST, ...SCRIPTS]) {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), filename === MANIFEST
      ? '{"version":"1.0.0"}\n' : '// fixture\nconst WIDGET_VERSION = "1.0.0";\nconst unchanged = true;\n');
  }
  return root;
}

test('prepare updates all versions and preserves script content', t => {
  const root = fixture(t);
  assert.equal(prepare('1.0.1', root), '1.0.1');
  assert.equal(readRelease(root).version, '1.0.1');
  for (const filename of SCRIPTS) assert.match(fs.readFileSync(path.join(root, filename), 'utf8'), /const unchanged = true;/);
});

test('invalid, equal and lower versions leave every file unchanged', t => {
  const root = fixture(t);
  const before = [MANIFEST, ...SCRIPTS].map(name => fs.readFileSync(path.join(root, name), 'utf8'));
  for (const version of ['1.0.0', '0.9.9', '01.0.1', '1.0', '1.0.1-beta', '999999999999999999.0.0']) {
    assert.throws(() => prepare(version, root));
    assert.deepEqual([MANIFEST, ...SCRIPTS].map(name => fs.readFileSync(path.join(root, name), 'utf8')), before);
  }
});

test('mismatched or duplicated embedded versions fail before modifying files', t => {
  for (const source of ['const WIDGET_VERSION = "2.0.0";\n', 'const WIDGET_VERSION = "1.0.0";\nconst WIDGET_VERSION = "1.0.0";\n']) {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, SCRIPTS[3]), source);
    assert.throws(() => prepare('1.0.1', root));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, MANIFEST))).version, '1.0.0');
    assert.match(fs.readFileSync(path.join(root, SCRIPTS[0]), 'utf8'), /"1.0.0"/);
  }
});

test('patch bumps and comparisons are numeric', () => {
  assert.equal(nextPatch('1.0.0'), '1.0.1');
  assert.equal(nextPatch('1.0.9'), '1.0.10');
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.throws(() => nextPatch('1.0.9007199254740991'));
});
