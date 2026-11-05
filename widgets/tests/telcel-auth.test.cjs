const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWidget, fullFlow, CREDENTIALS, NOW } = require('./scriptable-mock.cjs');

const basic = Buffer.from('web-client:public-configuration').toString('base64');
const page = '<script type="module" src="/assets/index-web123.js"></script>';
const bundle = `const config = {MTL_AUTHORIZATION_BASIC:"${basic}"};`;
const discovery = () => [{ text: page }, { text: bundle }];

for (const design of ['solid', 'image']) {
  test(`${design}: discovers Basic auth on every live fetch without sharing account details`, async () => {
    const { hooks, state } = await loadWidget(design, {
      queue: [...fullFlow(), ...fullFlow()], discoveryQueue: [...discovery(), ...discovery()], settings: { debug: true },
    });
    await hooks.fetchUsage(CREDENTIALS);
    await hooks.fetchUsage(CREDENTIALS);
    assert.equal(state.discoveryRequests.length, 4);
    const exchanges = state.requests.filter(request => new URL(request.url).pathname.endsWith('/token'));
    assert.equal(exchanges.length, 2);
    assert.ok(exchanges.every(request => request.headers.Authorization === `Basic ${basic}`));
    for (const request of state.discoveryRequests) {
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers.Cookie, '');
      assert.equal(request.body, undefined);
      assert.equal(request.timeout, 5);
      assert.equal(request.onRedirect({ url: 'https://other.example/' }), null);
    }
    for (const value of [basic, 'public-configuration', CREDENTIALS.phone, CREDENTIALS.password, bundle, page]) {
      assert.equal(state.logs.join('\n').includes(value), false);
    }
  });

  test(`${design}: a usage-cache hit skips discovery and an expired reading discovers again`, async () => {
    const { hooks, state } = await loadWidget(design, { queue: fullFlow(), discoveryQueue: discovery() });
    hooks.writeCache(CREDENTIALS, { data: hooks.SAMPLE_DATA, fetchedAt: NOW, retryAt: 0 });
    await hooks.loadUsage(CREDENTIALS);
    assert.equal(state.discoveryRequests.length, 0);
    assert.equal(state.requests.length, 0);
    state.now += 30 * 60000;
    assert.equal((await hooks.loadUsage(CREDENTIALS)).updateFailed, false);
    assert.equal(state.discoveryRequests.length, 2);
  });

  test(`${design}: supports both quote styles and quoted configuration keys`, async () => {
    for (const quote of ['"', "'"]) {
      const { hooks } = await loadWidget(design, { discoveryQueue: [
        { text: `<script src=${quote}https://www.mitelcel.com/assets/index-web123.js?v=1&amp;lang=es${quote}></script>` },
        { text: `{${quote}MTL_AUTHORIZATION_BASIC${quote}: ${quote}${basic}${quote}}` },
      ] });
      assert.equal(await hooks.discoverBasicAuth(), basic);
    }
  });

  test(`${design}: discovery failures fall back without adding exchange retries`, async () => {
    for (const replies of [
      [{ status: 503 }], [{ error: new Error('private-response') }],
      [{ text: '<html>Request Rejected</html>' }],
      [{ text: '<script src="https://other.example/assets/index-web123.js"></script>' }],
      [{ text: page }, { text: 'missing configuration' }],
      [{ text: page }, { text: 'MTL_AUTHORIZATION_BASIC:"invalid"' }],
      [{ text: page }, { text: `MTL_AUTHORIZATION_BASIC:"${Buffer.from('without-colon').toString('base64')}"` }],
    ]) {
      const { hooks, state } = await loadWidget(design, { queue: fullFlow(), discoveryQueue: replies, settings: { debug: true } });
      await hooks.fetchUsage(CREDENTIALS);
      assert.equal(state.requests.length, 4);
      assert.equal(state.requests[1].headers.Authorization, 'Basic test-client-auth');
      assert.ok(state.discoveryRequests.length <= 2);
      assert.equal(state.logs.join('\n').includes('private-response'), false);
    }
  });

  test(`${design}: redirects stay on Telcel and are bounded`, async () => {
    const { hooks, state } = await loadWidget(design, { discoveryQueue: [
      { status: 302, headers: { Location: '/mitelcel/login?redirect=1' } }, ...discovery(),
    ] });
    assert.equal(await hooks.discoverBasicAuth(), basic);
    assert.equal(state.discoveryRequests.length, 3);
    for (const location of ['https://other.example/', '//other.example/', 'http://www.mitelcel.com/']) {
      state.discoveryQueue.push({ status: 302, headers: { Location: location } });
      const before = state.discoveryRequests.length;
      assert.equal(await hooks.discoverBasicAuth(), 'test-client-auth');
      assert.equal(state.discoveryRequests.length, before + 1);
    }
    state.discoveryQueue.push(...Array.from({ length: 4 }, () => ({ status: 302, headers: { Location: '/mitelcel/login' } })));
    const before = state.discoveryRequests.length;
    assert.equal(await hooks.discoverBasicAuth(), 'test-client-auth');
    assert.equal(state.discoveryRequests.length, before + 4);
  });

  test(`${design}: a rejected exchange is not retried and the SSO session is revoked`, async () => {
    const queue = fullFlow();
    queue.splice(1, 2, { status: 401, text: 'rejected' });
    const { hooks, state } = await loadWidget(design, { queue, discoveryQueue: discovery() });
    await assert.rejects(hooks.fetchUsage(CREDENTIALS), error => error.code === 'token_http_401');
    assert.equal(state.discoveryRequests.length, 2);
    assert.deepEqual(state.requests.map(request => new URL(request.url).pathname), ['/login', '/security/1.0.0/v2/token', '/sso/revoke']);
  });
}
