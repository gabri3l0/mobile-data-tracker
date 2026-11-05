const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SCRIPTS, MANIFEST, readRelease } = require('../release.cjs');
const { productionChanged, latestStable, decideVersion, prepareAutomatic, verifyLive, publishRelease } = require('../release-automation.cjs');

const stable = (version = '1.0.0') => ({ tag_name: `v${version}`, draft: false, prerelease: false });

test('automatic preparation commits only versions and returns the commit to deploy', async t => {
  for (const changed of [true, false]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdt-auto-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const filename of [MANIFEST, ...SCRIPTS]) {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
      fs.writeFileSync(path.join(root, filename), filename === MANIFEST
        ? '{"version":"1.0.0"}' : 'const WIDGET_VERSION = "1.0.0";\n');
    }
    const calls = [];
    let committed = false, result;
    const runGit = (...args) => {
      calls.push(args);
      if (args[0] === 'commit') committed = true;
      if (args[0] === 'rev-parse') return args[1] === 'HEAD' && committed ? 'version-commit'
        : args[1].startsWith('refs/tags/') ? 'previous-commit' : 'source-commit';
      if (args[0] === 'merge-base') return 'previous-commit';
      if (args[0] === 'diff') return changed ? 'widgets/telcel/solid.js' : 'widgets/README.md';
      return '';
    };
    await prepareAutomatic({ root, runGit, api: async () => [stable()], emit: value => { result = value; } });
    assert.equal(result.version, changed ? '1.0.1' : '1.0.0');
    assert.equal(result.sha, changed ? 'version-commit' : 'source-commit');
    assert.equal(readRelease(root).version, result.version);
    assert.equal(calls.some(args => args[0] === 'push'), changed);
    if (changed) assert.deepEqual(calls.find(args => args[0] === 'add'), ['add', '--', MANIFEST, ...SCRIPTS]);
    const before = calls.length;
    await assert.rejects(prepareAutomatic({ root, api: async () => [stable()], runGit: (...args) =>
      args[0] === 'rev-parse' && args[1] === 'origin/main' ? 'newer-main' : runGit(...args), emit: () => {} }), /Main advanced/);
    assert.equal(calls.slice(before).some(args => args[0] === 'push'), false);
  }
});

test('only production widget changes automatically bump the patch', () => {
  for (const filename of ['widgets/telcel/solid.js', 'widgets/bait/image.js', 'widgets/previews/index.html']) {
    assert.equal(productionChanged([filename]), true);
  }
  assert.equal(productionChanged(['widgets/README.md', 'widgets/tests/updates.test.cjs', MANIFEST, 'scripts/release.cjs', '.github/workflows/widget-release.yml']), false);
  assert.deepEqual(decideVersion('1.0.0', [stable()], true), { version: '1.0.1', previousTag: 'v1.0.0', publish: true });
  assert.equal(decideVersion('1.0.0', [stable()], false).publish, false);
  assert.equal(decideVersion('1.0.1', [stable()], true).version, '1.0.1', 'retry a prepared version without incrementing twice');
  assert.throws(() => decideVersion('0.9.0', [stable()], true), /older/);
  assert.throws(() => decideVersion('1.0.0', [], false), /initial/);
});

test('latest stable ignores drafts and prereleases and compares numeric versions', () => {
  assert.equal(latestStable([stable('1.9.0'), { ...stable('2.0.0'), draft: true },
    { ...stable('3.0.0'), prerelease: true }, { tag_name: 'unrelated' }, stable('1.10.0')]).tag_name, 'v1.10.0');
});

test('Pages verification checks the manifest and all four scripts', async () => {
  const requested = [];
  await verifyLive('https://example.com/mobile-data-tracker/', '1.0.1', { request: async url => {
    requested.push(url);
    return { ok: true, text: async () => url.pathname.endsWith('/version.json')
      ? '{"version":"1.0.1"}' : 'const WIDGET_VERSION = "1.0.1";\n' };
  } });
  assert.equal(requested.length, 5);
  assert.deepEqual(requested.map(url => url.pathname), [MANIFEST, ...SCRIPTS].map(name => `/mobile-data-tracker/${name}`));
  assert.ok(requested.every(url => url.searchParams.get('version') === '1.0.1'));
});

test('Pages verification retries stale deployment and fails boundedly when unavailable', async () => {
  let requests = 0, waits = 0;
  await assert.rejects(verifyLive('https://example.com/', '1.0.1', { attempts: 3,
    sleep: async () => { waits++; }, request: async () => {
      requests++;
      return { ok: true, text: async () => '{"version":"1.0.0"}' };
    },
  }), /not yet at version/);
  assert.equal(requests, 3);
  assert.equal(waits, 2);
  await assert.rejects(verifyLive('http://example.com/', '1.0.1'), /HTTPS/);
});

function publication(overrides = {}) {
  const calls = [];
  const options = {
    version: '1.0.1', sha: 'tested-commit', baseURL: 'https://example.com/project/',
    runGit: (...args) => {
      if (args[0] === 'tag') return '';
      return 'previous-commit';
    },
    verify: async () => { calls.push('verify'); },
    api: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (endpoint.startsWith('releases?')) return [stable()];
      if (endpoint === 'releases/generate-notes') return { body: "## What's Changed\n* Updated widget #16\n## New Contributors\n* @example" };
      return { html_url: 'https://example.com/release' };
    },
    ...overrides,
  };
  return { calls, options };
}

test('publish verifies deployment before creating a stable release at the tested commit', async () => {
  const { calls, options } = publication();
  await publishRelease(options);
  const request = calls.find(call => call.endpoint === 'releases');
  assert.ok(calls.indexOf('verify') < calls.indexOf(request));
  assert.equal(request.options.data.target_commitish, 'tested-commit');
  assert.equal(request.options.data.tag_name, 'v1.0.1');
  assert.equal(request.options.data.make_latest, 'true');
  assert.equal(request.options.data.draft, false);
  assert.match(request.options.data.body, /## Cambios/);
  assert.match(request.options.data.body, /## Cómo actualizar/);
  assert.equal(calls.find(call => call.endpoint === 'releases/generate-notes').options.data.previous_tag_name, 'v1.0.0');
});

test('failed deployment verification prevents publishing', async () => {
  const { calls, options } = publication({ verify: async () => { throw new Error('deployment failed'); } });
  await assert.rejects(publishRelease(options), /deployment failed/);
  assert.equal(calls.some(call => call.endpoint === 'releases'), false);
});

test('reruns verify deployment without changing a published release', async () => {
  const calls = [];
  await publishRelease({
    version: '1.0.1', sha: 'tested-commit', baseURL: 'https://example.com/',
    api: async (endpoint, options) => { calls.push({ endpoint, options }); return [stable('1.0.1')]; },
    runGit: (...args) => args[0] === 'tag' ? 'v1.0.1' : 'previous-commit',
    verify: async () => { calls.push('verified'); },
  });
  assert.ok(calls.includes('verified'));
  assert.equal(calls.some(call => call.options?.method === 'POST'), false);
});

test('conflicting tags, incomplete releases and older versions cannot publish', async () => {
  const cases = [
    { runGit: (...args) => args[0] === 'tag' ? 'v1.0.1' : 'wrong-commit' },
    { api: async () => [{ ...stable('1.0.1'), draft: true }] },
    { version: '0.9.0' },
  ];
  for (const override of cases) {
    const { options } = publication(override);
    await assert.rejects(publishRelease(options));
  }
});
