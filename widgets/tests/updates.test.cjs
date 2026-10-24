const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadWidget, CREDENTIALS, BAIT_CREDENTIALS, NOW } = require('./scriptable-mock.cjs');

const HOUR = 3600000;
const root = path.join(__dirname, '..');
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
const nextVersion = `${Number(currentVersion.split('.')[0]) + 1}.0.0`;

test('release manifest and all standalone scripts publish the same valid version', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  for (const carrier of ['telcel', 'bait']) {
    for (const design of ['solid', 'image']) {
      const { hooks } = await loadWidget(design, { carrier });
      assert.equal(hooks.WIDGET_VERSION, manifest.version);
    }
  }
});

for (const carrier of ['telcel', 'bait']) {
  for (const design of ['solid', 'image']) {
    const label = `${carrier}/${design}`;
    const credentials = carrier === 'telcel' ? CREDENTIALS : BAIT_CREDENTIALS;

    test(`${label}: numeric versions notify only for a newer release`, async () => {
      const { hooks } = await loadWidget(design, { carrier });
      for (const [latest, installed, expected] of [
        ['1.0.0', '1.0.0', false], ['1.0.1', '1.0.0', true],
        ['1.10.0', '1.9.0', true], ['2.0.0', '1.99.99', true],
        ['0.9.9', '1.0.0', false], ['1.9.9', '1.10.0', false],
        ['1.0', '1.0.0', false], ['1.0.1-beta', '1.0.0', false],
        ['01.2.3', '1.0.0', false], ['999999999999999999.0.0', '1.0.0', false],
        [null, '1.0.0', false], [42, '1.0.0', false], ['1.0.1', 'bad', false],
      ]) assert.equal(hooks.newerVersion(latest, installed), expected);
    });

    test(`${label}: successful checks last 24 hours and send no account information`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, versionQueue: [
        { body: { version: nextVersion } }, { body: { version: currentVersion } },
      ] });
      assert.equal(await hooks.checkForUpdate(), true);
      assert.equal(state.versionRequests[0].timeout, 3);
      assert.equal(state.versionRequests[0].body, undefined);
      assert.equal(state.versionRequests[0].headers.Authorization, undefined);
      state.now = NOW + 24 * HOUR - 1;
      assert.equal(await hooks.checkForUpdate(), true);
      assert.equal(state.versionRequests.length, 1);
      state.now++;
      assert.equal(await hooks.checkForUpdate(), false);
      assert.equal(state.versionRequests.length, 2);
      assert.equal(state.requests.length, 0);
      assert.equal(state.keys.size, 0);
    });

    test(`${label}: failures preserve a known update and retry after one hour`, async () => {
      for (const failure of [
        { error: new Error('offline private-response') }, { status: 503 },
        { text: '<html>unavailable</html>' }, { body: { version: 'bad' } },
        { body: null }, { body: { version: 2 } },
      ]) {
        const { hooks, state } = await loadWidget(design, { carrier, versionQueue: [
          { body: { version: nextVersion } }, failure, { body: { version: nextVersion } },
        ], settings: { debug: true } });
        await hooks.checkForUpdate();
        state.now += 24 * HOUR;
        assert.equal(await hooks.checkForUpdate(), true);
        state.now += HOUR - 1;
        assert.equal(await hooks.checkForUpdate(), true);
        assert.equal(state.versionRequests.length, 2);
        state.now++;
        assert.equal(await hooks.checkForUpdate(), true);
        assert.equal(state.versionRequests.length, 3);
        assert.deepEqual(state.logs, []);
      }
    });

    test(`${label}: initial failure and corrupt or unavailable storage are harmless`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, versionQueue: [{ status: 404 }] });
      assert.equal(await hooks.checkForUpdate(), false);
      assert.equal(await hooks.checkForUpdate(), false);
      assert.equal(state.versionRequests.length, 1);
      const file = `/library/${hooks.VERSION_CACHE_FILE}`;
      for (const corrupt of ['invalid JSON', 'null', JSON.stringify({ latestVersion: 'bad', checkedAt: NOW, nextCheckAt: NOW + HOUR }),
        JSON.stringify({ latestVersion: '1.0.1', checkedAt: NOW + HOUR, nextCheckAt: NOW + 2 * HOUR })]) {
        state.files.set(file, corrupt);
        await hooks.checkForUpdate();
      }
      state.writeError = true;
      state.files.delete(file);
      state.versionQueue.push({ body: { version: nextVersion } });
      assert.equal(await hooks.checkForUpdate(), true);
    });

    test(`${label}: update footer and destination work across data and error states`, async () => {
      for (const chartStyle of ['bar', 'arc', 'none']) {
        const { hooks, state } = await loadWidget(design, { carrier, settings: { chartStyle } });
        for (const data of [hooks.SAMPLE_DATA, null]) {
          for (const updateFailed of [false, true]) {
            for (const updateAvailable of [false, true]) {
              state.texts.length = 0;
              const widget = hooks.createWidget({ data, updateFailed, updateAvailable, setupRequired: data === null });
              assert.equal(widget.url, updateAvailable ? hooks.updateURL() : undefined);
              const message = updateAvailable ? (updateFailed ? 'Error · Nueva versión' : 'Nueva versión disponible')
                : updateFailed ? 'No se pudo actualizar' : null;
              if (message) assert.equal(state.texts.filter(value => value === message).length, 1);
              assert.equal(state.texts.filter(value => value.startsWith('Última ejecución · ')).length, 1);
            }
          }
        }
      }
    });

    test(`${label}: main checks releases without changing saved usage or retry deadlines`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, credentials, settings: { backgroundImageUrl: '' },
        versionQueue: [{ body: { version: nextVersion } }] });
      hooks.writeCache(credentials, { data: hooks.SAMPLE_DATA, fetchedAt: NOW - HOUR, retryAt: NOW + HOUR });
      const before = JSON.stringify(hooks.readCache(credentials));
      await hooks.main();
      assert.equal(state.widget.url, hooks.updateURL());
      assert.ok(state.texts.includes('Error · Nueva versión'));
      assert.equal(JSON.stringify(hooks.readCache(credentials)), before);
      assert.equal(state.requests.length, 0);
      assert.equal(state.versionRequests.length, 1);
    });

    test(`${label}: manual update menu opens the matching generator without a request`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, credentials, runsInWidget: false, alerts: [{ action: 2 }] });
      await hooks.main();
      assert.deepEqual(state.openedURLs, [hooks.updateURL()]);
      assert.equal(state.requests.length, 0);
      assert.equal(state.versionRequests.length, 0);
      assert.equal(state.completed, 1);
    });

    test(`${label}: offline version check leaves a successful saved reading unchanged`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, credentials,
        settings: { backgroundImageUrl: '' }, versionQueue: [{ error: new Error('offline') }] });
      hooks.writeCache(credentials, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
      await hooks.main();
      assert.equal(state.widget.url, undefined);
      assert.equal(state.widget.refreshAfterDate.getTime(), NOW + 30 * 60000);
      assert.equal(state.texts.includes('No se pudo actualizar'), false);
      assert.equal(state.texts.includes('Nueva versión disponible'), false);
      assert.equal(state.requests.length, 0);
      assert.equal(hooks.readCache(credentials).fetchedAt, NOW);
    });

    test(`${label}: cancellation and sample mode skip release checks`, async () => {
      const cancelled = await loadWidget(design, { carrier, runsInWidget: false, alerts: [{ action: -1 }] });
      await cancelled.hooks.main();
      assert.equal(cancelled.state.versionRequests.length, 0);
      const sample = await loadWidget(design, { carrier, settings: { useSampleData: true, sampleState: 'update' } });
      await sample.hooks.main();
      assert.equal(sample.state.versionRequests.length, 0);
      assert.ok(sample.state.requests.every(request => request.kind === 'image'));
      assert.ok(sample.state.texts.includes('Nueva versión disponible'));
    });
  }
}

test('all four scripts share version metadata cache but retain their own update link', async () => {
  const files = new Map();
  const first = await loadWidget('solid', { files, versionQueue: [{ body: { version: nextVersion } }] });
  assert.equal(await first.hooks.checkForUpdate(), true);
  const second = await loadWidget('image', { carrier: 'bait', files });
  assert.equal(await second.hooks.checkForUpdate(), true);
  assert.equal(second.state.versionRequests.length, 0);
  assert.equal(new URL(second.hooks.updateURL()).search, '?carrier=bait&design=image&update=1');
});
