const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWidget, fullFlow, CREDENTIALS, BAIT_CREDENTIALS, NOW } = require('./scriptable-mock.cjs');
const baitResponse = require('./fixtures/bait_consumption.json');

function assertPrivate(logs) {
  const output = logs.join('\n');
  for (const value of [CREDENTIALS.phone, BAIT_CREDENTIALS.phone, CREDENTIALS.password,
    'test-client-auth', 'private-sso-token', 'private-access-token', 'private-response',
    'private-network', 'https://', 'offers_detail', 'offering_id', 'Plan 20 GB', 'Paquete 3 meses']) {
    assert.equal(output.includes(value), false, 'Logs must omit account and response data');
  }
}

for (const carrier of ['telcel', 'bait']) {
  for (const design of ['solid', 'image']) {
    const credentials = carrier === 'telcel' ? CREDENTIALS : BAIT_CREDENTIALS;
    const queue = () => carrier === 'telcel' ? fullFlow() : [{ body: baitResponse }];
    const label = `${carrier}/${design} debug`;

    test(`${label}: request stages, cache hits and execution lifecycle are safe`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, credentials, queue: queue(),
        settings: { debug: true, backgroundImageUrl: '' } });
      await hooks.main();
      const stages = carrier === 'telcel' ? ['login', 'token', 'usage', 'logout'] : ['usage'];
      for (const stage of stages) {
        assert.ok(state.logs.some(value => value.includes(`Solicitud ${stage}: iniciada.`)));
        assert.ok(state.logs.some(value => value.includes(`Solicitud ${stage}: HTTP 2`)));
      }
      assert.ok(state.logs.some(value => value.includes('Lectura recibida y validada.')));
      assert.ok(state.logs.some(value => value.includes('Ejecución finalizada.')));
      const count = state.requests.length;
      await hooks.loadUsage(credentials);
      assert.equal(state.requests.length, count);
      assert.ok(state.logs.some(value => value.includes('Usando lectura guardada:')));
      assertPrivate(state.logs);
    });

    test(`${label}: network, HTTP, JSON and rate-limit failures expose no raw details`, async () => {
      const cases = [
        [{ error: new Error(`private-network ${credentials.phone}`) }, 'fallo de red o tiempo agotado'],
        [{ status: 401, text: 'private-response' }, 'HTTP 401'],
        [{ text: 'private-response' }, 'Respuesta no válida:'],
        [{ status: 429, text: 'private-response', headers: { 'Retry-After': '120' } }, 'esperar 2 min'],
        [{ status: 'private-response', text: 'private-response' }, 'HTTP desconocido'],
      ];
      for (const [reply, expected] of cases) {
        const { hooks, state } = await loadWidget(design, { carrier, queue: [reply], settings: { debug: true } });
        hooks.writeCache(credentials, { data: hooks.SAMPLE_DATA, fetchedAt: NOW - 31 * 60000, retryAt: 0 });
        const result = await hooks.loadUsage(credentials);
        assert.equal(result.updateFailed, true);
        assert.ok(state.logs.some(value => value.includes(expected)));
        assert.ok(state.logs.some(value => value.includes('Mostrando lectura anterior.')));
        const count = state.requests.length;
        await hooks.loadUsage(credentials);
        assert.equal(state.requests.length, count);
        assert.ok(state.logs.some(value => value.includes('Actualización en pausa:')));
        assertPrivate(state.logs);
      }
    });

    test(`${label}: disabled debug produces no logs on success or failure`, async () => {
      for (const replies of [queue(), [{ error: new Error('private-network') }]]) {
        const { hooks, state } = await loadWidget(design, { carrier, queue: replies });
        await hooks.loadUsage(credentials);
        assert.deepEqual(state.logs, []);
      }
    });
  }
}
