const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadWidget, KEY, CACHE, CREDENTIALS, BAIT_KEY, BAIT_CACHE, BAIT_CREDENTIALS, NOW } = require('./scriptable-mock.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const response = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/bait_consumption.json'), 'utf8'));
const loadBait = (design, options = {}) => loadWidget(design, { ...options, carrier: 'bait' });

for (const design of ['solid', 'image']) {
  test(`${design} Bait: one direct consumption request returns high-speed usage`, async () => {
    const { hooks, state } = await loadBait(design, { queue: [{ body: response(), advance: 1200 }] });
    const data = await hooks.fetchUsage(BAIT_CREDENTIALS);
    assert.deepEqual(plain(data), {
      plan_name: 'Paquete 3 meses Ilimitado', expiration_date: '2026-11-10', days_until: 21,
      last_updated: new Date(NOW + 1200).toISOString(), total_gb: 20495 / 1024,
      used_gb: 6690 / 1024, remaining_gb: 13805 / 1024,
      used_percentage: 32.64, remaining_percentage: 67.36, data_tier: 'high_speed',
    });
    assert.equal(state.requests.length, 1);
    const request = state.requests[0];
    assert.equal(request.url, `https://mibait.com/api/core/q/dn/${BAIT_CREDENTIALS.phone}/get/consumption`);
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.Accept, 'application/json');
    assert.equal(request.headers['x-ord-service'], 'test-client-auth');
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.body, undefined);
  });

  test(`${design} Bait: falls back to throttled balance without combining tiers`, async () => {
    const body = response(); body.data[0].resume.unused = 0;
    const { hooks } = await loadBait(design);
    const data = hooks.parseUsage(body);
    assert.equal(data.data_tier, 'throttled');
    assert.equal(data.total_gb, 105);
    assert.equal(data.remaining_gb, 105);
    assert.equal(data.used_gb, 0);
    assert.equal(data.used_percentage, 0);
  });

  test(`${design} Bait: both exhausted retains high-speed; a missing tier is allowed`, async () => {
    const body = response(); body.data[0].resume.unused = 0; body.data[1].resume.unused = 0;
    const { hooks } = await loadBait(design);
    assert.equal(hooks.parseUsage(body).data_tier, 'high_speed');
    body.data.splice(0, 1);
    const data = hooks.parseUsage(body);
    assert.equal(data.data_tier, 'throttled');
    assert.equal(data.remaining_gb, 0);
    body.data.splice(0, 1);
    assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data');
  });

  test(`${design} Bait: zero total permits null percentages`, async () => {
    const body = response(); body.data = body.data.slice(0, 1);
    Object.assign(body.data[0].resume, { total: 0, unused: 0 });
    const { hooks } = await loadBait(design);
    const data = hooks.parseUsage(body);
    assert.equal(data.used_percentage, null);
    assert.equal(data.remaining_percentage, null);
    assert.equal(hooks.isUsageData(data), true);
  });

  test(`${design} Bait: expiration uses summary dates in UTC, not offer dates`, async () => {
    const body = response(); body.data[0].resume.expire_date = '2026-10-20T23:00:00-06:00';
    const { hooks } = await loadBait(design);
    const data = hooks.parseUsage(body, new Date('2026-10-21T05:30:00Z'));
    assert.equal(data.expiration_date, '2026-10-21');
    assert.equal(data.days_until, 0);
    body.data[0].resume.expire_date = '2026-10-19T00:00:00Z';
    assert.equal(hooks.parseUsage(body).days_until, 0);
  });

  test(`${design} Bait: offer names deduplicate without adding offer balances`, async () => {
    const body = response(); body.data[0].offers_detail.push({ offer_name: 'Bono adicional', total: 100000 });
    const { hooks } = await loadBait(design);
    const data = hooks.parseUsage(body);
    assert.equal(data.plan_name, 'Paquete 3 meses Ilimitado, Bono adicional');
    assert.equal(data.total_gb, 20495 / 1024);
  });

  for (const [field, value] of [['total', -1], ['unused', -1], ['unused', 20496], ['unused', true], ['total', '20495'], ['total', null], ['unused', Infinity], ['total', NaN]]) {
    test(`${design} Bait: invalid ${field} balance ${String(value)} does not trigger fallback`, async () => {
      const body = response(); body.data[0].resume[field] = value;
      const { hooks } = await loadBait(design);
      assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data');
    });
  }

  for (const expiration of [null, 'invalid', '2026-11-10', '2026-11-10T00:00:00', '2026-02-30T00:00:00Z', '2026-11-10T24:00:00Z']) {
    test(`${design} Bait: rejects invalid expiration ${expiration}`, async () => {
      const body = response(); body.data[0].resume.expire_date = expiration;
      const { hooks } = await loadBait(design);
      assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data');
    });
  }

  test(`${design} Bait: rejects ambiguous summaries and missing metadata`, async () => {
    const { hooks } = await loadBait(design);
    const duplicate = response(); duplicate.data.push(plain(duplicate.data[0]));
    assert.throws(() => hooks.parseUsage(duplicate), error => error.code === 'usage_data');
    for (const value of [null, [], [{}], [{ offer_name: ' ' }]]) {
      const body = response(); body.data[0].offers_detail = value;
      assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data');
    }
    const body = response(); delete body.data[0].resume;
    assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data');
  });

  for (const body of [null, [], {}, { success: false, error: 'private-response' }, { success: 'true', data: [] }, { success: true, data: [] }, { success: true, data: [null] }]) {
    test(`${design} Bait: malformed response is rejected safely`, async () => {
      const { hooks } = await loadBait(design);
      assert.throws(() => hooks.parseUsage(body), error => error.code === 'usage_data' && !error.message.includes('private-response'));
    });
  }

  test(`${design} Bait: first run asks only for a phone and stores it in Keychain`, async () => {
    const { hooks, state } = await loadBait(design, { runsInWidget: false,
      alerts: [{ action: 0, fields: ['55 9876 5432'] }], queue: [{ body: response() }],
      settings: { backgroundImageUrl: '' } });
    await hooks.main();
    assert.equal(state.prompts.length, 1);
    assert.equal(state.prompts[0].fields.length, 1);
    assert.equal(state.previews, 1);
    assert.equal(state.requests.length, 1);
    assert.equal(state.completed, 1);
    const saved = JSON.parse(state.keys.get(BAIT_KEY));
    assert.equal(saved.phone, BAIT_CREDENTIALS.phone);
    assert.equal(saved.password, undefined);
    assert.equal(saved.serviceKey, undefined);
    assert.equal(state.keys.has(KEY), false);
    assert.ok(state.texts.some(value => value.startsWith('Última ejecución · ')));
  });

  test(`${design} Bait: cancellation and invalid phone never query the carrier`, async () => {
    for (const replies of [[{ action: -1 }], [{ action: 0, fields: ['123'] }, { action: 0 }]]) {
      const { hooks, state } = await loadBait(design, { runsInWidget: false, alerts: replies });
      await hooks.main();
      assert.equal(state.requests.length, 0);
      assert.equal(state.keys.size, 0);
    }
  });

  test(`${design} Bait: home-screen setup never prompts or requests`, async () => {
    const { hooks, state } = await loadBait(design);
    await hooks.main();
    assert.equal(state.prompts.length, 0);
    assert.equal(state.requests.length, 0);
    assert.ok(state.texts.includes('Abre Scriptable para configurar'));
  });

  test(`${design} Bait: stored credentials and a fresh cache work on the home screen`, async () => {
    const { hooks, state } = await loadBait(design, { credentials: BAIT_CREDENTIALS, settings: { backgroundImageUrl: '' } });
    hooks.writeCache(BAIT_CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    await hooks.main();
    assert.equal(state.requests.length, 0);
    assert.equal(state.prompts.length, 0);
    assert.ok(state.texts.includes('13.5'));
    assert.equal(state.widget.refreshAfterDate.getTime(), NOW + 30 * 60000);
  });

  test(`${design} Bait: cache and diagnostic logs omit phone, key, and raw response`, async () => {
    const { hooks, state } = await loadBait(design, { queue: [{ body: response() }], settings: { debug: true } });
    await hooks.loadUsage(BAIT_CREDENTIALS);
    const output = state.logs.join('\n') + state.files.get(BAIT_CACHE);
    for (const value of [BAIT_CREDENTIALS.phone, 'test-client-auth', 'https://mibait.com', 'offers_detail', 'offering_id']) assert.equal(output.includes(value), false);
    assert.equal(hooks.readCache({ ...BAIT_CREDENTIALS, profileId: 'new-profile' }), null);
  });

  test(`${design} Bait: stale data survives error and retry deadline stops requests`, async () => {
    const { hooks, state } = await loadBait(design, { queue: [{ error: new Error('private-error') }] });
    const fetchedAt = NOW - 31 * 60000;
    hooks.writeCache(BAIT_CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt, retryAt: 0 });
    const result = await hooks.loadUsage(BAIT_CREDENTIALS);
    assert.equal(result.data.remaining_gb, 13805 / 1024);
    assert.equal(result.updateFailed, true);
    assert.equal(result.refreshAt, NOW + 15 * 60000);
    assert.equal(hooks.readCache(BAIT_CREDENTIALS).fetchedAt, fetchedAt);
    await hooks.loadUsage(BAIT_CREDENTIALS);
    assert.equal(state.requests.length, 1);
  });

  test(`${design} Bait: rate limit respects Retry-After and errors never leak bodies`, async () => {
    const { hooks, state } = await loadBait(design, { queue: [{ status: 429, headers: { 'Retry-After': '1200' }, text: 'private-body' }] });
    const result = await hooks.loadUsage(BAIT_CREDENTIALS);
    assert.equal(result.data, null);
    assert.equal(result.refreshAt, NOW + 1200000);
    assert.equal(state.files.get(BAIT_CACHE).includes('private-body'), false);
    assert.equal(state.logs.join('\n').includes('private-body'), false);
  });

  for (const reply of [{ status: 403, text: 'private-body' }, { text: 'invalid-json-with-private-body' }, { error: new Error('private-error') }]) {
    test(`${design} Bait: upstream failure is sanitized`, async () => {
      const { hooks } = await loadBait(design, { queue: [reply] });
      await assert.rejects(hooks.fetchUsage(BAIT_CREDENTIALS), error => {
        assert.ok(['usage_http_403', 'usage_json', 'usage_network'].includes(error.code));
        return !error.message.includes('private');
      });
    });
  }

  test(`${design} Bait: changing the phone invalidates only Bait's cache`, async () => {
    const { hooks, state } = await loadBait(design, { credentials: BAIT_CREDENTIALS, runsInWidget: false,
      alerts: [{ action: 1 }, { action: 0, fields: ['5511112222'] }] });
    hooks.writeCache(BAIT_CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    state.files.set(CACHE, 'untouched-telcel-cache');
    const result = await hooks.credentialsForRun();
    assert.equal(result.credentials.phone, '5511112222');
    assert.equal(state.files.has(BAIT_CACHE), false);
    assert.equal(state.files.get(CACHE), 'untouched-telcel-cache');
  });

  for (const sampleState of ['success', 'stale', 'error', 'setup', 'throttled']) {
    test(`${design} Bait: ${sampleState} sample renders without requests`, async () => {
      const { hooks, state } = await loadBait(design, { settings: { useSampleData: true, sampleState, backgroundImageUrl: '' } });
      await hooks.main();
      assert.equal(state.requests.length, 0);
      assert.equal(state.prompts.length, 0);
      assert.equal(state.completed, 1);
      assert.equal(state.texts.filter(value => /^(Última ejecución|Actualizado|Consultado|Ejecutado) · /.test(value)).length, 1);
      assert.ok(state.texts.some(value => value.startsWith('Última ejecución · ')));
      if (sampleState === 'throttled') {
        assert.ok(state.texts.some(value => value.startsWith('Velocidad reducida')));
        assert.ok(state.texts.includes('105.0'));
      }
      if (sampleState === 'stale') assert.ok(state.texts.includes('No se pudo actualizar'));
    });
  }
}

test('Bait designs share identical data logic and are independent of server and Telcel', () => {
  const get = design => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'bait', `${design}.js`), 'utf8');
    assert.equal(/importModule|healthUrl|apiKey|checkServerReady|Telcel|telcel|SSO|password/.test(source), false);
    return source.slice(source.indexOf('const KEYCHAIN_KEY'), source.indexOf(design === 'image' ? 'async function loadBackgroundImage' : 'function formatGB')).trim();
  };
  assert.equal(get('solid'), get('image'));
});

test('Bait solid and image share their own cache without reusing Telcel data', async () => {
  const keys = new Map([[KEY, JSON.stringify(CREDENTIALS)], [BAIT_KEY, JSON.stringify(BAIT_CREDENTIALS)]]);
  const files = new Map();
  const telcel = await loadWidget('solid', { keys, files });
  telcel.hooks.writeCache(CREDENTIALS, { data: telcel.hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
  const first = await loadBait('solid', { keys, files, queue: [{ body: response() }] });
  await first.hooks.loadUsage(first.hooks.readCredentials());
  const second = await loadBait('image', { keys, files });
  assert.equal((await second.hooks.loadUsage(second.hooks.readCredentials())).data.data_tier, 'high_speed');
  assert.equal(second.state.requests.length, 0);
  assert.equal(telcel.hooks.readCache(CREDENTIALS).data.remaining_data, 1.6);
});

test('Bait image retains an old background when refreshing fails', async () => {
  const { hooks, state } = await loadBait('image', { queue: [
    { image: { size: { width: 800, height: 600 } } }, { error: new Error('offline') },
  ] });
  assert.ok(await hooks.loadBackgroundImage());
  state.now += 25 * 3600000;
  assert.ok(await hooks.loadBackgroundImage());
  assert.equal(state.files.has('/library/mobile-data-bait-background.png'), true);
  assert.equal(state.files.has('/library/mobile-data-telcel-background.png'), false);
});
