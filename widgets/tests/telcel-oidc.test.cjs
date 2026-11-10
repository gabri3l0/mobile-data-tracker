const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWidget, fullFlow, CREDENTIALS, NOW, CACHE } = require('./scriptable-mock.cjs');

const AUTH_PATH = '/oid-authorize-prod/authorize';
const TOKEN_PATH = '/oid-authorize-prod/token';
const code = 'private+code/= &%';
const sso = 'private-oidc-sso';
const legacyFailure = { status: 200, text: '' };
function authorize(request) {
  const state = new URL(request.url).searchParams.get('state');
  return { text: '', headers: { 'X-OIDC-Redirect-Location': `https://mtl.smapps.mx:1333/sso/callback?code=${encodeURIComponent(code)}&state=${state}` } };
}
function oidcFlow() {
  return [authorize, { body: { access_token: sso, error: 'Seccessful', error_description: '' } }];
}
function queueWithFailedLogin(reply = legacyFailure) {
  const queue = fullFlow(); queue[0] = reply; return queue;
}

for (const design of ['solid', 'image']) {
  for (const [name, failure] of [
    ['empty', legacyFailure], ['HTML', { text: '<title>Request Rejected</title>' }],
    ['invalid JSON', { text: 'private-invalid-json' }],
    ['rejected credentials', { body: { estatus: 'failed', error: 'private-error' } }],
    ['missing token', { body: { estatus: 'ok', token: '' } }],
    ['HTTP 401', { status: 401, text: '' }],
    ['HTTP 429', { status: 429, headers: { 'Retry-After': '3000' }, text: '' }],
    ['network timeout', { error: new Error('private-network-details') }],
  ]) {
    test(`${design}: ${name} login activates exactly one OIDC flow`, async () => {
      const { hooks, state } = await loadWidget(design, {
        queue: queueWithFailedLogin(failure), oidcQueue: oidcFlow(), settings: { debug: true },
      });
      assert.equal((await hooks.fetchUsage(CREDENTIALS)).remaining_data, 15);
      assert.deepEqual(state.oidcRequests.map(r => new URL(r.url).pathname), [AUTH_PATH, TOKEN_PATH]);
      assert.equal(state.requests.filter(r => new URL(r.url).pathname === '/login').length, 1);
      assert.equal(new URL(state.requests[1].url).searchParams.get('token'), sso);
      assert.deepEqual(Object.fromEntries(new URLSearchParams(state.requests.at(-1).body)), { token: sso, token_type: 'revoke' });
      const logs = state.logs.join('\n');
      assert.ok(logs.includes('Intentando OIDC una vez'));
      for (const secret of [CREDENTIALS.phone, CREDENTIALS.password, code, encodeURIComponent(code), sso, 'private-network-details', 'private-invalid-json', 'private-error', 'private-access-token']) {
        assert.equal(logs.includes(secret), false);
      }
    });
  }

  test(`${design}: OIDC preserves credential encoding, parameters, redirect controls and form fields`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: queueWithFailedLogin(), oidcQueue: oidcFlow() });
    await hooks.fetchUsage(CREDENTIALS);
    const [auth, token] = state.oidcRequests;
    const query = new URL(auth.url).searchParams;
    assert.equal(auth.method, 'GET');
    assert.equal(auth.headers.USERNAME, `52${CREDENTIALS.phone}`);
    assert.equal(auth.headers.PASSWORD, CREDENTIALS.password);
    assert.equal(auth.headers['Accept-Charset'], 'UTF-8');
    assert.equal(query.get('scope'), 'openid');
    assert.equal(query.get('response_type'), 'code');
    assert.equal(query.get('acr_values'), '1');
    assert.ok(query.get('state'));
    assert.notEqual(query.get('state'), query.get('nonce'));
    assert.equal(auth.onRedirect({ url: 'https://other.example/?code=private' }), null);
    assert.equal(token.method, 'POST');
    assert.equal(token.onRedirect({ url: 'https://other.example/' }), null);
    assert.equal(token.headers.USERNAME, undefined);
    assert.equal(token.headers.PASSWORD, undefined);
    assert.equal(token.headers.Authorization, undefined);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
      grant_type: 'authorization_code', client_id: query.get('client_id'),
      redirect_uri: query.get('redirect_uri'), code,
    });
    assert.equal(auth.timeout, hooks.SETTINGS.requestTimeoutSeconds);
    assert.equal(token.timeout, hooks.SETTINGS.requestTimeoutSeconds);
    const form = new URLSearchParams(state.requests[0].body);
    assert.equal(form.get('MSISDN'), CREDENTIALS.phone);
    assert.equal(form.get('Type'), 'MSISDN');
    assert.equal(form.get('Invocation'), 'iFrame');
    assert.equal(form.get('Source'), '');
  });

  test(`${design}: each OIDC attempt has fresh state and nonce`, async () => {
    const { hooks, state } = await loadWidget(design, {
      queue: [...queueWithFailedLogin(), ...queueWithFailedLogin()], oidcQueue: [...oidcFlow(), ...oidcFlow()],
    });
    await hooks.fetchUsage(CREDENTIALS); await hooks.fetchUsage(CREDENTIALS);
    const values = state.oidcRequests.filter(r => r.method === 'GET').flatMap(r => {
      const q = new URL(r.url).searchParams; return [q.get('state'), q.get('nonce')];
    });
    assert.equal(new Set(values).size, 4);
  });

  for (const locationType of ['json', 'body URL', 'location', 'redirect callback']) {
    test(`${design}: obtains OIDC code from ${locationType}`, async () => {
      const auth = request => {
        const state = new URL(request.url).searchParams.get('state');
        const location = `https://other.example/callback?code=${encodeURIComponent(code)}&state=${state}`;
        if (locationType === 'json') return { body: { code, state } };
        if (locationType === 'body URL') return { text: location };
        if (locationType === 'location') return { status: 302, headers: { Location: location }, text: '' };
        return { status: 302, redirect: location, text: '' };
      };
      const { hooks, state } = await loadWidget(design, { queue: queueWithFailedLogin(), oidcQueue: [auth, oidcFlow()[1]] });
      assert.equal((await hooks.fetchUsage(CREDENTIALS)).remaining_data, 15);
      assert.equal(state.oidcRequests.length, 2);
      assert.ok(state.oidcRequests.every(r => new URL(r.url).host === 'www.mitelcel.com'));
    });
  }

  for (const variant of ['access_token', 'token', 'nested']) {
    test(`${design}: accepts ${variant} even alongside Seccessful`, async () => {
      const payload = { error: 'Seccessful' };
      if (variant === 'nested') payload.tokenResponse = { tokens: [{ id: 'token:mit', access_token: sso }] };
      else payload[variant] = sso;
      const { hooks } = await loadWidget(design, { queue: queueWithFailedLogin(), oidcQueue: [authorize, { body: payload }] });
      assert.equal((await hooks.fetchUsage(CREDENTIALS)).remaining_data, 15);
    });
  }

  for (const [name, reply, expected] of [
    ['missing code', { text: '' }, 'oidc_code'],
    ['mismatched state', { body: { code, state: 'wrong' } }, 'oidc_state'],
    ['rejected credentials', { headers: { Location: 'https://example.test/?error=access_denied&error_description=private-value' }, text: '' }, 'oidc_authorize_rejected'],
    ['HTTP error', { status: 403, text: 'private-body' }, 'oidc_authorize_http_403'],
    ['network failure', { error: new Error('private-details') }, 'oidc_authorize_network'],
    ['conflicting codes', { body: { code }, headers: { Location: 'https://example.test/?code=other' } }, 'oidc_code'],
    ['malformed encoding', { headers: { Location: 'https://example.test/?code=%GG' }, text: '' }, 'oidc_code'],
  ]) {
    test(`${design}: OIDC ${name} stops without token exchange or logout`, async () => {
      const { hooks, state } = await loadWidget(design, { queue: [{ ...legacyFailure }], oidcQueue: [reply], settings: { debug: true } });
      await assert.rejects(hooks.fetchUsage(CREDENTIALS), e => e.code === expected);
      assert.equal(state.requests.length, 1);
      assert.equal(state.oidcRequests.length, 1);
      assert.equal(state.logs.join('\n').includes('private-'), false);
    });
  }

  for (const [reply, expected] of [
    [{ body: { error: 'Seccessful' } }, 'oidc_token_rejected'],
    [{ body: { id_token: 'not-an-access-token' } }, 'oidc_token_missing'],
    [{ text: '' }, 'oidc_token_json'],
    [{ status: 302, headers: { Location: 'https://other.example/' }, text: '' }, 'oidc_token_http_302'],
  ]) {
    test(`${design}: unusable OIDC token response ${expected} does not query usage`, async () => {
      const { hooks, state } = await loadWidget(design, { queue: [legacyFailure], oidcQueue: [authorize, reply] });
      await assert.rejects(hooks.fetchUsage(CREDENTIALS), e => e.code === expected);
      assert.equal(state.requests.length, 1);
      assert.equal(state.oidcRequests.length, 2);
    });
  }

  for (const phase of ['exchange', 'home', 'parser']) {
    test(`${design}: OIDC session is revoked after ${phase} failure with no authentication restart`, async () => {
      const queue = queueWithFailedLogin();
      if (phase === 'exchange') queue.splice(1, 2, { status: 401, text: '' });
      if (phase === 'home') queue[2] = { status: 503, text: '' };
      if (phase === 'parser') queue[2] = { body: {} };
      const { hooks, state } = await loadWidget(design, { queue, oidcQueue: oidcFlow() });
      await assert.rejects(hooks.fetchUsage(CREDENTIALS), e => e.code === {
        exchange: 'token_http_401', home: 'usage_http_503', parser: 'usage_data',
      }[phase]);
      assert.equal(state.oidcRequests.length, 2);
      assert.equal(new URL(state.requests.at(-1).url).pathname, '/sso/revoke');
      assert.equal(new URLSearchParams(state.requests.at(-1).body).get('token'), sso);
    });
  }

  test(`${design}: logout failure preserves a fresh OIDC reading and cache contains no tokens`, async () => {
    const queue = queueWithFailedLogin(); queue[3] = { status: 503, text: 'private-logout' };
    const { hooks, state } = await loadWidget(design, { queue, oidcQueue: oidcFlow() });
    assert.equal((await hooks.loadUsage(CREDENTIALS)).updateFailed, false);
    const cache = state.files.get(CACHE);
    assert.ok(cache.includes('remaining_data'));
    for (const value of [sso, code, CREDENTIALS.password, CREDENTIALS.phone, 'private-access-token']) assert.equal(cache.includes(value), false);
    await hooks.loadUsage(CREDENTIALS);
    assert.equal(state.oidcRequests.length, 2);
    assert.equal(state.requests.length, 4);
  });

  test(`${design}: failed fallback retains previous data and Retry-After deadline`, async () => {
    const { hooks, state } = await loadWidget(design, {
      queue: [{ status: 429, headers: { 'Retry-After': '3000' }, text: '' }],
      oidcQueue: [{ error: new Error('private-details') }],
    });
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW - 3600000, retryAt: 0 });
    const result = await hooks.loadUsage(CREDENTIALS);
    assert.equal(result.updateFailed, true);
    assert.equal(result.data.remaining_data, hooks.SAMPLE_DATA.remaining_data);
    assert.equal(JSON.parse(state.files.get(CACHE)).retryAt, NOW + 3000000);
    await hooks.loadUsage(CREDENTIALS);
    assert.equal(state.oidcRequests.length, 1);
    assert.equal(state.requests.length, 1);
  });

  test(`${design}: successful normal login and failed later exchange never invoke OIDC`, async () => {
    const queue = fullFlow(); queue.splice(1, 2, { status: 401, text: '' });
    const { hooks, state } = await loadWidget(design, { queue });
    await assert.rejects(hooks.fetchUsage(CREDENTIALS), e => e.code === 'token_http_401');
    assert.equal(state.oidcRequests.length, 0);
    assert.equal(new URL(state.requests.at(-1).url).pathname, '/sso/revoke');
  });
}
