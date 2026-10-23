const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadWidget, homeResponse, fullFlow, CREDENTIALS, KEY, CACHE, NOW } = require('./scriptable-mock.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

const CORPORATE_PLAN = 'TELCEL CORPORATIVO CONTROLADO VPN 6 SR';
function corporateHomeResponse() {
  const home = homeResponse();
  home.id = 'home-corpo';
  home.data.components[0] = { id: 'text-plan-name', config: { value: CORPORATE_PLAN } };
  return home;
}

for (const design of ['solid', 'image']) {
  test(`${design}: plan name matches personal or corporate account type`, async () => {
    const { hooks } = await loadWidget(design);
    for (const corporate of [false, true]) {
      const home = homeResponse();
      home.data.components.push({ id: 'text-plan-name', config: { value: CORPORATE_PLAN } });
      if (corporate) {
        home.id = 'home-corpo';
        home.data.components[0].config.value = 'Datos de mi plan';
      }
      assert.equal(hooks.parseUsage(home).plan_name, corporate ? CORPORATE_PLAN : 'Plan 20 GB');
    }
  });

  test(`${design}: corporate cutoff uses carrier reading date when due date is absent`, async () => {
    const { hooks } = await loadWidget(design);
    for (const [updated, days, expected] of [
      ['22/10/2026', 29, '2026-11-20'], ['30/12/2026', 3, '2027-01-02'],
      ['28/02/2028', 1, '2028-02-29'], ['22/10/2026', 0, '2026-10-22'],
    ]) {
      const components = corporateHomeResponse().data.components;
      components.splice(5, 1);
      components[4].config.value = `Información al ${updated} 20:08 h`;
      components.at(-1).config.segments = [
        { text: days === 1 ? 'Falta ' : 'Faltan ' }, { text: String(days), fontWeight: 500 },
        { text: ' días para el próximo corte' },
      ];
      const result = hooks.parseUsage({ id: 'home-corpo', blocks: { children: components } });
      assert.equal(result.plan_name, CORPORATE_PLAN);
      assert.equal(result.expiration_date, expected);
      assert.equal(result.days_until, days);
      assert.equal(result.remaining_gb, 15);
    }
  });

  test(`${design}: corporate cutoff preserves explicit dates and rejects malformed dates`, async () => {
    const { hooks } = await loadWidget(design);
    const home = corporateHomeResponse();
    home.data.components[5].config.value = '5 de enero';
    assert.equal(hooks.parseUsage(home).expiration_date, '2027-01-05');
    for (const config of [undefined, null, {}, { value: 'invalid' }]) {
      home.data.components[5].config = config;
      assert.throws(() => hooks.parseUsage(home), error => error.code === 'usage_data');
    }
    delete home.id;
    home.data.components[0].id = 'tabs-plans-v2-plan-name-0-0-0';
    home.data.components.splice(5, 1);
    assert.throws(() => hooks.parseUsage(home), error => error.code === 'usage_data');
  });

  test(`${design}: cutoff parser supports singular, plural and split formatted segments`, async () => {
    const { hooks } = await loadWidget(design);
    for (const [prefix, days, suffix] of [['Falta ', 1, 'día'], ['Faltan ', 2, 'días'], ['Faltan ', 0, 'días'], ['FALTA\u00a0', 1, 'día']]) {
      const home = homeResponse();
      home.data.components.at(-1).config.segments = [
        { text: prefix }, { text: `${days} ${suffix}`, fontWeight: 500 },
        { text: ' para que venza tu paquete' },
      ];
      assert.equal(hooks.parseUsage(home).days_until, days);
    }
    const home = homeResponse();
    home.data.components.at(-1).config.segments = [{ text: 'Falta un día' }];
    assert.throws(() => hooks.parseUsage(home), error => error.code === 'usage_data');
  });

  test(`${design}: direct Telcel flow and logout preserve the carrier reading`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: fullFlow() });
    const data = await hooks.fetchUsage(CREDENTIALS);
    assert.deepEqual(plain(data), {
      plan_name: 'Plan 20 GB', expiration_date: '2027-01-02', days_until: 3,
      last_updated: '2026-12-30T14:35:00', total_gb: 20, used_gb: 5, remaining_gb: 15,
      used_percentage: 25, remaining_percentage: 75,
    });
    assert.deepEqual(state.requests.map(r => new URL(r.url).pathname), ['/login', '/security/1.0.0/v2/token', '/api/components/flow/home', '/sso/revoke']);
    const login = new URLSearchParams(state.requests[0].body);
    assert.equal(login.get('username'), CREDENTIALS.phone);
    assert.equal(login.get('telcel-pass'), CREDENTIALS.password);
    assert.equal(Buffer.from(login.get('pB64'), 'base64').toString('utf8'), CREDENTIALS.password);
    assert.equal(state.requests[1].headers.Authorization, 'Basic test-client-auth');
    assert.equal(new URL(state.requests[1].url).searchParams.get('token'), 'private-sso-token');
    assert.equal(state.requests[2].headers.Authorization, 'Bearer private-access-token');
    assert.equal(state.requests[3].method, 'POST');
    assert.equal(state.requests[3].timeout, 5);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(state.requests[3].body)), { token: 'private-sso-token', token_type: 'revoke' });
  });

  for (const stage of ['exchange', 'home', 'parsing']) {
    test(`${design}: logout after ${stage} failure preserves original failure`, async () => {
      const queue = fullFlow();
      if (stage === 'exchange') queue.splice(1, 2, { status: 503, text: 'private-body' });
      if (stage === 'home') queue[2] = { error: new Error('private-network-details') };
      if (stage === 'parsing') queue[2] = { body: {} };
      queue[queue.length - 1] = { error: new Error('private-logout-error') };
      const { hooks, state } = await loadWidget(design, { queue });
      await assert.rejects(hooks.fetchUsage(CREDENTIALS), error => {
        assert.equal(error.code, { exchange: 'token_http_503', home: 'usage_network', parsing: 'usage_data' }[stage]);
        assert.equal(error.message.includes('private'), false);
        return true;
      });
      assert.equal(new URL(state.requests.at(-1).url).pathname, '/sso/revoke');
    });
  }

  test(`${design}: failed login does not attempt logout`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: [{ body: { estatus: 'failed' } }] });
    await assert.rejects(hooks.fetchUsage(CREDENTIALS), error => error.code === 'login_rejected');
    assert.equal(state.requests.length, 1);
  });

  test(`${design}: failed logout does not discard successful data`, async () => {
    const queue = fullFlow(); queue[3] = { status: 500, text: 'private-logout-body' };
    const { hooks } = await loadWidget(design, { queue });
    assert.equal((await hooks.fetchUsage(CREDENTIALS)).remaining_gb, 15);
  });

  test(`${design}: fresh and corrupt cache behavior`, async () => {
    const { hooks, state } = await loadWidget(design);
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW - 60000, retryAt: 0 });
    const result = await hooks.loadUsage(CREDENTIALS);
    assert.equal(result.refreshAt, NOW - 60000 + 30 * 60000);
    assert.equal(state.requests.length, 0);
    state.files.set(CACHE, 'not-json');
    assert.equal(hooks.readCache(CREDENTIALS), null);
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW + 1, retryAt: 0 });
    assert.equal(hooks.readCache(CREDENTIALS), null);
  });

  test(`${design}: stale reading survives failure without changing its age`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: [{ error: new Error('private') }] });
    const fetchedAt = NOW - 31 * 60000;
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt, retryAt: 0 });
    const result = await hooks.loadUsage(CREDENTIALS);
    assert.equal(result.data.remaining_gb, 1.6);
    assert.equal(result.updateFailed, true);
    assert.equal(result.refreshAt, NOW + 15 * 60000);
    assert.equal(hooks.readCache(CREDENTIALS).fetchedAt, fetchedAt);
    await hooks.loadUsage(CREDENTIALS);
    assert.equal(state.requests.length, 1);
  });

  test(`${design}: failure without saved data is cached and pauses retries`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: [{ status: 401, text: 'private' }] });
    const result = await hooks.loadUsage(CREDENTIALS);
    assert.equal(result.data, null);
    assert.equal(result.updateFailed, true);
    await hooks.loadUsage(CREDENTIALS);
    assert.equal(state.requests.length, 1);
  });

  for (const header of ['1200', new Date(NOW + 1200000).toUTCString()]) {
    test(`${design}: respects Retry-After ${header.startsWith('1200') ? 'seconds' : 'date'}`, async () => {
      const { hooks, state } = await loadWidget(design, { queue: [{ status: 429, headers: { 'rEtRy-AfTeR': header }, text: '' }, ...fullFlow()] });
      assert.equal((await hooks.loadUsage(CREDENTIALS)).refreshAt, NOW + 1200000);
      state.now = NOW + 1199999;
      await hooks.loadUsage(CREDENTIALS);
      assert.equal(state.requests.length, 1);
      state.now++;
      assert.equal((await hooks.loadUsage(CREDENTIALS)).updateFailed, false);
      assert.equal(state.requests.length, 5);
    });
  }

  test(`${design}: cache storage failures do not discard readings`, async () => {
    const { hooks } = await loadWidget(design, { writeError: true, queue: fullFlow() });
    assert.equal((await hooks.loadUsage(CREDENTIALS)).data.remaining_gb, 15);
  });

  test(`${design}: cache excludes credentials and session tokens`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: fullFlow() });
    await hooks.loadUsage(CREDENTIALS);
    const saved = state.files.get(CACHE);
    for (const value of [CREDENTIALS.phone, CREDENTIALS.password, 'private-sso-token', 'private-access-token']) assert.equal(saved.includes(value), false);
    assert.equal(hooks.readCache({ ...CREDENTIALS, profileId: 'another-profile' }), null);
  });

  test(`${design}: logs never include sensitive request details`, async () => {
    const { hooks, state } = await loadWidget(design, { settings: { debug: true }, queue: fullFlow() });
    await hooks.loadUsage(CREDENTIALS);
    const log = state.logs.join('\n');
    for (const value of [CREDENTIALS.phone, CREDENTIALS.password, 'private-sso-token', 'private-access-token', 'test-client-auth', 'https://']) assert.equal(log.includes(value), false);
  });

  test(`${design}: a complete first run configures, fetches, and previews one standalone script`, async () => {
    const { hooks, state } = await loadWidget(design, { runsInWidget: false,
      alerts: [{ action: 0, fields: [CREDENTIALS.phone, CREDENTIALS.password] }],
      queue: fullFlow(), settings: { backgroundImageUrl: '' } });
    await hooks.main();
    assert.equal(state.requests.length, 4);
    assert.equal(state.previews, 1);
    assert.equal(state.completed, 1);
    assert.ok(state.texts.includes('15.0'));
    assert.ok(state.texts.some(value => value.startsWith('Última ejecución · ')));
    assert.equal(state.widget.backgroundColor.hex, '101012');
    assert.ok(state.widget.refreshAfterDate.getTime() > NOW);
  });

  test(`${design}: first run saves credentials with a secure password field`, async () => {
    const { hooks, state } = await loadWidget(design, { runsInWidget: false, alerts: [{ action: 0, fields: ['55 1234 5678', CREDENTIALS.password] }] });
    const result = await hooks.credentialsForRun();
    assert.equal(result.cancelled, false);
    assert.equal(result.credentials.phone, CREDENTIALS.phone);
    assert.equal(result.credentials.password, CREDENTIALS.password);
    assert.equal(state.prompts[0].fields[1].secure, true);
    assert.equal(state.prompts[0].fields[1].value, '');
    assert.equal(JSON.parse(state.keys.get(KEY)).phone, CREDENTIALS.phone);
  });

  test(`${design}: setup cancellation makes no requests and saves nothing`, async () => {
    const { hooks, state } = await loadWidget(design, { runsInWidget: false, alerts: [{ action: -1 }] });
    await hooks.main();
    assert.equal(state.requests.length, 0);
    assert.equal(state.keys.size, 0);
    assert.equal(state.widgets.length, 0);
    assert.equal(state.completed, 1);
  });

  for (const fields of [['123', 'password'], ['5512345678', '   ']]) {
    test(`${design}: invalid setup is not saved`, async () => {
      const { hooks, state } = await loadWidget(design, { runsInWidget: false, alerts: [{ action: 0, fields }, { action: 0 }] });
      const result = await hooks.credentialsForRun();
      assert.equal(result.cancelled, true);
      assert.equal(state.keys.size, 0);
      assert.equal(state.requests.length, 0);
    });
  }

  test(`${design}: Keychain write failure leaves the previous profile intact`, async () => {
    const { hooks, state } = await loadWidget(design, { credentials: CREDENTIALS, keyWriteError: true,
      alerts: [{ action: 0, fields: ['5598765432', 'new-password'] }, { action: 0 }] });
    assert.equal(await hooks.configureCredentials(CREDENTIALS), null);
    assert.equal(JSON.parse(state.keys.get(KEY)).phone, CREDENTIALS.phone);
  });

  test(`${design}: missing credentials on home screen never prompts or requests`, async () => {
    const { hooks, state } = await loadWidget(design);
    await hooks.main();
    assert.equal(state.prompts.length, 0);
    assert.equal(state.requests.length, 0);
    assert.ok(state.texts.includes('Abre Scriptable para configurar'));
  });

  test(`${design}: in-app view reuses Keychain and fresh cache`, async () => {
    const { hooks, state } = await loadWidget(design, { credentials: CREDENTIALS, runsInWidget: false,
      alerts: [{ action: 0 }], settings: { backgroundImageUrl: '' } });
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    await hooks.main();
    assert.equal(state.prompts.length, 1);
    assert.equal(state.prompts[0].type, 'sheet');
    assert.equal(state.requests.length, 0);
    assert.equal(state.previews, 1);
  });

  test(`${design}: changing credentials invalidates previous account cache`, async () => {
    const { hooks, state } = await loadWidget(design, { credentials: CREDENTIALS, runsInWidget: false,
      alerts: [{ action: 1 }, { action: 0, fields: ['5598765432', 'new password'] }] });
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    const result = await hooks.credentialsForRun();
    assert.equal(result.credentials.phone, '5598765432');
    assert.notEqual(result.credentials.profileId, CREDENTIALS.profileId);
    assert.equal(state.files.has(CACHE), false);
    // An in-flight execution from the old account cannot restore a usable cache.
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    assert.equal(hooks.readCache(result.credentials), null);
  });

  for (const sampleState of ['success', 'stale', 'error', 'setup']) {
    test(`${design}: ${sampleState} sample renders without credentials or carrier requests`, async () => {
      const { hooks, state } = await loadWidget(design, { runsInWidget: false,
        settings: { useSampleData: true, sampleState, backgroundImageUrl: '' } });
      await hooks.main();
      assert.equal(state.requests.length, 0);
      assert.equal(state.prompts.length, 0);
      assert.equal(state.previews, 1);
      assert.equal(state.completed, 1);
      assert.equal(state.texts.filter(value => /^(Última ejecución|Actualizado|Consultado|Ejecutado) · /.test(value)).length, 1);
      assert.ok(state.texts.some(value => value.startsWith('Última ejecución · ')));
      if (sampleState === 'setup') assert.ok(state.texts.includes('Abre Scriptable para configurar'));
      if (sampleState === 'stale') assert.ok(state.texts.includes('No se pudo actualizar'));
    });
  }

  test(`${design}: zero total permits null percentages`, async () => {
    const home = homeResponse(); home.data.components[1].config.value = '0';
    const { hooks } = await loadWidget(design);
    const result = hooks.parseUsage(home);
    assert.equal(result.used_percentage, null);
    assert.equal(hooks.isUsageData(result), true);
  });

  for (const [index, value] of [[1, 'invalid'], [4, 'Información al 31/02/2026 12:00 h'], [4, 'Información al 30/12/2026 25:00 h'], [5, '31 de abril']]) {
    test(`${design}: rejects malformed carrier field ${index}: ${value}`, async () => {
      const home = homeResponse(); home.data.components[index].config.value = value;
      const { hooks } = await loadWidget(design);
      assert.throws(() => hooks.parseUsage(home), error => error.code === 'usage_data');
    });
  }
}

test('both standalone designs share identical credential, cache, and carrier logic', () => {
  const get = design => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'telcel', `${design}.js`), 'utf8');
    assert.equal(/importModule|healthUrl|apiKey|checkServerReady/.test(source), false);
    return source.slice(source.indexOf('const KEYCHAIN_KEY'), source.indexOf(design === 'image' ? 'async function loadBackgroundImage' : 'function formatGB')).trim();
  };
  assert.equal(get('solid'), get('image'));
});

test('Telcel styles reuse the same Keychain profile and saved reading', async () => {
  const first = await loadWidget('solid', { credentials: CREDENTIALS, queue: fullFlow() });
  await first.hooks.loadUsage(CREDENTIALS);
  const second = await loadWidget('image', { keys: first.state.keys, files: first.state.files });
  const result = await second.hooks.loadUsage(second.hooks.readCredentials());
  assert.equal(result.data.remaining_gb, 15);
  assert.equal(second.state.requests.length, 0);
});

for (const value of ['not-json', JSON.stringify({ phone: '123', password: 'private' })]) {
  test('unreadable or incomplete Keychain entry is treated as missing', async () => {
    const { hooks, state } = await loadWidget('solid', { keys: new Map([[KEY, value]]) });
    await hooks.main();
    assert.equal(state.requests.length, 0);
    assert.ok(state.texts.includes('Abre Scriptable para configurar'));
  });
}

for (const sampleState of ['success', 'stale']) {
  test(`image: ${sampleState} sample may download a background without calling Telcel`, async () => {
    const { hooks, state } = await loadWidget('image', { settings: { useSampleData: true, sampleState },
      queue: [{ image: { size: { width: 800, height: 600 } } }] });
    await hooks.main();
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].kind, 'image');
    assert.ok(state.widget.backgroundImage);
  });
}

test('image: caches a cropped image for 24 hours', async () => {
  const { hooks, state } = await loadWidget('image', { queue: [{ image: { size: { width: 800, height: 600 } } }] });
  const result = await hooks.loadBackgroundImage();
  assert.equal(result.size.width, 400);
  state.now += 23 * 3600000;
  assert.ok(await hooks.loadBackgroundImage());
  assert.equal(state.requests.length, 1);
});

test('image: stale background survives failed refresh; changed URL does not reuse it', async () => {
  const { hooks, state } = await loadWidget('image', { queue: [
    { image: { size: { width: 800, height: 600 } } },
    { error: new Error('offline') }, { error: new Error('offline') },
  ] });
  await hooks.loadBackgroundImage();
  state.now += 25 * 3600000;
  assert.ok(await hooks.loadBackgroundImage());
  hooks.SETTINGS.backgroundImageUrl = 'https://images.example/new.jpg';
  assert.equal(await hooks.loadBackgroundImage(), null);
});

test('image: failed or invalid initial download leaves a solid background', async () => {
  for (const reply of [{ error: new Error('offline') }, { status: 404 }, { image: { size: { width: 0, height: 0 } } }]) {
    const { hooks } = await loadWidget('image', { queue: [reply] });
    assert.equal(await hooks.loadBackgroundImage(), null);
  }
});

test('image: malformed metadata and failed storage do not hide a downloaded image', async () => {
  const { hooks, state } = await loadWidget('image', { writeError: true,
    queue: [{ image: { size: { width: 300, height: 600 } } }] });
  state.files.set('/library/mobile-data-telcel-background.json', 'corrupt');
  state.files.set('/library/mobile-data-telcel-background.png', { size: { width: 400, height: 400 } });
  assert.ok(await hooks.loadBackgroundImage());
});
