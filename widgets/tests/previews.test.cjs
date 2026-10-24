const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadWidget } = require('./scriptable-mock.cjs');

test('update links restore appearance and export the same settings in all four scripts', async () => {
  const imageURL = 'https://images.example/niño + photo.jpg?token=a+b&size=large#crop';
  for (const carrier of ['telcel', 'bait']) {
    for (const design of ['solid', 'image']) {
      const settings = {
        backgroundHex: '123456', textPrimaryHex: 'ABCDEF', textSecondaryHex: '112233',
        accentHex: '445566', chartStyle: 'arc', showPlanName: false,
        backgroundImageUrl: imageURL, backgroundOverlayOpacity: 0.35,
      };
      const { hooks } = await loadWidget(design, { carrier, settings });
      const link = new URL(hooks.updateURL());
      assert.equal(link.origin, 'https://gabri3l0.github.io');
      assert.equal(link.pathname, '/mobile-data-tracker/widgets/previews/');
      assert.equal(link.searchParams.get('carrier'), carrier);
      assert.equal(link.searchParams.get('design'), design);
      assert.equal(link.searchParams.get('update'), '1');
      assert.equal(link.searchParams.has('image'), false);
      const fragment = new URLSearchParams(link.hash.slice(1));
      assert.equal(fragment.get('image'), design === 'image' ? imageURL : null);
      assert.deepEqual([...fragment.keys()].sort(), (design === 'image'
        ? ['theme', 'hex', 'primary', 'secondary', 'accent', 'chart', 'plan', 'image', 'overlay']
        : ['theme', 'hex', 'primary', 'secondary', 'accent', 'chart', 'plan']).sort());
      const { elements: el } = preview(link.href);
      assert.equal(el['page-title'].textContent, 'Nueva versión disponible');
      assert.match(el['page-intro'].textContent, /Genera el código de nuevo/);
      assert.match(el['page-intro'].textContent, /script existente de Scriptable/);
      assert.equal(el['code-title'].textContent, 'Actualiza tu widget en Scriptable');
      assert.equal(el.theme.value, 'custom');
      assert.equal(el.hex.value, settings.backgroundHex);
      assert.equal(el['primary-hex'].value, settings.textPrimaryHex);
      assert.equal(el['secondary-hex'].value, settings.textSecondaryHex);
      assert.equal(el['accent-hex'].value, settings.accentHex);
      assert.equal(el['chart-style'].value, 'arc');
      assert.equal(el['show-plan'].checked, false);
      await el['generate-code'].emit('click');
      const exported = exportedSettings(el.code.value);
      for (const key of ['backgroundHex', 'textPrimaryHex', 'textSecondaryHex', 'accentHex', 'chartStyle', 'showPlanName']) {
        assert.equal(exported[key], settings[key]);
      }
      if (design === 'image') {
        assert.equal(el['image-url'].value, imageURL);
        assert.equal(exported.backgroundImageUrl, imageURL);
        assert.equal(exported.backgroundOverlayOpacity, 0.35);
      }
    }
  }
});

test('an explicitly empty background image survives an update link', async () => {
  const { hooks } = await loadWidget('image', { settings: { backgroundImageUrl: '', showPlanName: true } });
  const { elements: el } = preview(hooks.updateURL());
  assert.equal(el['image-url'].value, '');
  assert.equal(el['show-plan'].checked, true);
  await el['generate-code'].emit('click');
  assert.equal(exportedSettings(el.code.value).backgroundImageUrl, '');
});

test('an update preview shows the notice and preserves the carrier selection', () => {
  for (const carrier of ['telcel', 'bait']) {
    for (const design of ['solid', 'image']) {
      const { elements: el } = preview(`?carrier=${carrier}&design=${design}&state=update`);
      assert.equal(el.carrier.value, carrier);
      assert.equal(el.design.value, design);
      assert.equal(el.warning.hidden, false);
      assert.equal(el.warning.textContent, 'Nueva versión disponible');
      assert.equal(el.usage.hidden, false);
    }
  }
});

test('regenerating code in an open tab retrieves the newly published script', async () => {
  let calls = 0;
  const { elements: el } = preview('', { fetch: async () => ({
    ok: true, text: async () => sourceFor('telcel', 'solid')
      .replace(/const WIDGET_VERSION = "[^"]+";/, `const WIDGET_VERSION = "0.0.${++calls}";`),
  }) });
  await el['generate-code'].emit('click');
  assert.match(el.code.value, /WIDGET_VERSION = "0.0.1"/);
  await el['generate-code'].emit('click');
  assert.match(el.code.value, /WIDGET_VERSION = "0.0.2"/);
});

function sourceFor(carrier, design) {
  return fs.readFileSync(path.join(__dirname, '..', carrier, `${design}.js`), 'utf8')
    .replace(/const CLIENT_AUTH = "[^"]+";/, 'const CLIENT_AUTH = "test-client-auth";');
}
function classes() {
  const values = new Set();
  return { toggle(key, enabled) { enabled ? values.add(key) : values.delete(key); }, contains(key) { return values.has(key); } };
}
function preview(search = '', options = {}) {
  const location = new URL(search, 'https://example.com/widgets/previews/');
  const html = fs.readFileSync(path.join(__dirname, '../previews/index.html'), 'utf8');
  const elements = {};
  const state = { requests: [], images: [], copied: [], downloads: [], blobs: [] };
  for (const match of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const tag = match[0];
    const listeners = {};
    const element = {
      value: (tag.match(/\bvalue="([^"]*)"/)?.[1] || '').replaceAll('&amp;', '&'),
      hidden: /\bhidden\b/.test(tag), disabled: /\bdisabled\b/.test(tag), checked: /\bchecked\b/.test(tag),
      style: { setProperty(key, value) { this[key] = value; } }, classList: classes(),
      setAttribute(key, value) { this[key] = value; },
      getAttribute(key) { return this[key] ?? null; },
      removeAttribute(key) { delete this[key]; },
      addEventListener(key, callback) { listeners[key] = callback; },
      emit(key) { return listeners[key]?.({ target: this }); },
      focus() { this.focused = true; }, select() { this.selected = true; },
    };
    elements[match[1]] = element;
  }
  let imageSrc;
  Object.defineProperty(elements.background, 'src', {
    configurable: true, get: () => imageSrc,
    set(value) { imageSrc = value; state.images.push(value); },
  });
  elements.background.removeAttribute = key => { if (key === 'src') imageSrc = undefined; };
  elements.carrier.value = 'telcel'; elements.design.value = 'solid'; elements.state.value = 'success';
  elements.theme.value = 'dark'; elements['chart-style'].value = 'bar';
  class BrowserURL extends URL {
    static createObjectURL(blob) { state.blobs.push(blob); return 'blob:test'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    document: {
      body: { classList: classes(), appendChild() {} }, getElementById: id => elements[id],
      createElement() { return { click() { state.downloads.push({ href: this.href, filename: this.download }); }, remove() {} }; },
    },
    window: { location: { search: location.search, hash: location.hash, protocol: options.protocol || 'http:' }, innerWidth: options.width || 1000 },
    URL: BrowserURL, URLSearchParams, Blob, AbortController, setTimeout: () => 1, clearTimeout() {},
    navigator: { clipboard: { async writeText(value) { if (options.copyError) throw new Error(); state.copied.push(value); } } },
    async fetch(url, settings) {
      state.requests.push({ url, settings });
      if (options.fetch) return options.fetch(url, settings);
      const [, carrier, design] = url.match(/^\.\.\/(telcel|bait)\/(solid|image)\.js$/) || [];
      if (!carrier) throw new Error('Unexpected fetch');
      return { ok: true, text: async () => sourceFor(carrier, design) };
    },
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { elements, state, evaluate: expression => vm.runInContext(expression, context) };
}
function exportedSettings(code) {
  const block = code.match(/^const SETTINGS = (\{[\s\S]*?^\});/m);
  return vm.runInNewContext(`(${block[1]})`);
}

for (const design of ['solid', 'image']) {
  test(`${design}: carrier samples and all states render with one execution timestamp`, async () => {
    const { elements: el, evaluate } = preview(`?design=${design}`);
    for (const carrier of ['telcel', 'bait']) {
      const { hooks } = await loadWidget(design, { carrier });
      assert.deepEqual(JSON.parse(JSON.stringify(evaluate(`SAMPLES.${carrier}`))), JSON.parse(JSON.stringify(hooks.SAMPLE_DATA)));
      el.carrier.value = carrier; el.carrier.emit('change');
      assert.equal(el.remaining.textContent, carrier === 'bait' ? '13.5' : '1.6');
      assert.equal(el.execution.textContent, `Última ejecución · ${evaluate('formatRunTime(RUN_AT)')}`);
      for (const mode of ['stale', 'error', 'setup']) {
        el.state.value = mode; el.state.emit('change');
        assert.equal(el.usage.hidden, mode !== 'stale');
        assert.equal(el.empty.hidden, mode === 'stale');
        assert.equal(el.execution.hidden, false);
      }
      el.state.value = 'success'; el.state.emit('change');
    }
    el.state.value = 'throttled'; el.state.emit('change');
    assert.equal(el.remaining.textContent, '105.0');
    assert.match(el.available.textContent, /^Velocidad reducida/);
    el.carrier.value = 'telcel'; el.carrier.emit('change');
    assert.equal(el.state.value, 'success');
    assert.equal(el['throttled-option'].disabled, true);
  });
  for (const carrier of ['telcel', 'bait']) {
    test(`${carrier}/${design}: exported code comes from the canonical script and changes only selected settings`, async () => {
      const url = 'https://example.com/a,b.jpg?q="quote"&cash=$&';
      const { elements: el, state } = preview(`?carrier=${carrier}&design=${design}&hex=123456&overlay=0.4&image=${encodeURIComponent(url)}&state=error`);
      assert.equal(state.requests.length, 0, 'Source loads only on generation');
      await el['generate-code'].emit('click');
      assert.equal(state.requests[0].url, `../${carrier}/${design}.js`);
      assert.equal(el['code-output'].hidden, false);
      const code = el.code.value;
      const settings = exportedSettings(code);
      assert.equal(settings.backgroundHex, '123456');
      assert.equal(settings.useSampleData, false);
      assert.equal(settings.debug, false);
      if (design === 'image') {
        assert.equal(settings.backgroundImageUrl, url);
        assert.equal(settings.backgroundOverlayOpacity, 0.4);
      } else {
        assert.equal(settings.backgroundImageUrl, undefined);
        assert.equal(state.images.length, 0);
      }
      const outsideSettings = value => value.replace(/^const SETTINGS = \{[\s\S]*?^\};/m, 'SETTINGS');
      assert.equal(outsideSettings(code), outsideSettings(sourceFor(carrier, design)));
      assert.doesNotThrow(() => new vm.Script(`(async () => {${code}\n})`));
      el['download-code'].emit('click');
      assert.equal(state.downloads[0].filename, `${carrier}-${design}.js`);
      assert.equal(await state.blobs[0].text(), code);
      await el['copy-code'].emit('click');
      assert.equal(state.copied[0], code);
    });
  }
}

test('solid mode never fetches backgrounds; image loading starts only when needed', () => {
  const { elements: el, state } = preview('?image=https://example.com/a.jpg');
  assert.equal(state.images.length, 0);
  assert.equal(el['image-settings'].hidden, true);
  el.design.value = 'image'; el.design.emit('change');
  assert.equal(state.images.length, 1);
  el.background.onload();
  assert.equal(el.background.hidden, false);
  assert.equal(el.card.classList.contains('has-background'), true);
  el.opacity.value = '0.4'; el.opacity.emit('input');
  assert.equal(state.images.length, 1);
  assert.equal(el.card.style['--overlay-opacity'], '0.4');
  el.state.value = 'setup'; el.state.emit('change');
  assert.equal(el.background.hidden, true);
  el.design.value = 'solid'; el.design.emit('change');
  assert.equal(el.background.src, undefined);
  assert.equal(el.background.onload, null);
  assert.equal(el.card.classList.contains('has-background'), false);
  el.state.value = 'success'; el.state.emit('change');
  assert.equal(state.images.length, 1);
});

test('image failures, blank URLs, and invalid schemes use the solid background', async () => {
  const { elements: el, state } = preview('?design=image');
  assert.equal(state.images.length, 0);
  el['image-url'].value = 'javascript:alert(1)'; el['image-url'].emit('input');
  assert.equal(el['generate-code'].disabled, true);
  await el['generate-code'].emit('click');
  assert.equal(state.requests.length, 0);
  el['image-url'].value = 'https://example.com/a.jpg'; el['image-url'].emit('input'); el['image-url'].emit('change');
  el.background.onerror();
  assert.equal(el.background.hidden, true);
  assert.match(el['image-status'].textContent, /No se pudo cargar/);
  el['image-url'].value = ''; el['image-url'].emit('input'); el['image-url'].emit('change');
  assert.equal(el.background.src, undefined);
  await el['generate-code'].emit('click');
  assert.equal(exportedSettings(el.code.value).backgroundImageUrl, '');
});

test('invalid colors preserve the applied preview and prevent stale exports', async () => {
  const { elements: el, state } = preview('?hex=%23abcdef', { width: 390 });
  assert.equal(el.card.style.backgroundColor, '#ABCDEF');
  assert.equal(el.frame.style.width, '255px');
  await el['generate-code'].emit('click');
  el.hex.value = 'invalid'; el.hex.emit('input');
  assert.equal(el['color-error'].hidden, false);
  assert.equal(el.card.style.backgroundColor, '#ABCDEF');
  assert.equal(el.code.value, '');
  assert.equal(el['copy-code'].disabled, true);
  assert.equal(el['generate-code'].disabled, true);
  el['color-picker'].value = '#123456'; el['color-picker'].emit('input');
  assert.equal(el.hex.value, '123456');
  await el['generate-code'].emit('click');
  assert.equal(exportedSettings(el.code.value).backgroundHex, '123456');
  assert.equal(state.requests.length, 2, 'Each generation fetches fresh canonical source');
  el.carrier.value = 'bait'; el.carrier.emit('change');
  assert.equal(el.code.value, '');
  assert.equal(el['download-code'].disabled, true);
});

test('changed selections discard in-flight exports', async () => {
  let finish;
  const { elements: el } = preview('', { fetch: () => new Promise(resolve => { finish = resolve; }) });
  const pending = el['generate-code'].emit('click');
  el.carrier.value = 'bait'; el.carrier.emit('change');
  finish({ ok: true, text: async () => sourceFor('telcel', 'solid') });
  await pending;
  assert.equal(el.code.value, '');
  assert.equal(el['copy-code'].disabled, true);
  assert.equal(el['generate-code'].disabled, false);
  assert.match(el['code-status'].textContent, /Cambiaste los ajustes/);
});

test('file previews explain hosted generation without attempting local file fetches', async () => {
  const { elements: el, state } = preview('', { protocol: 'file:' });
  await el['generate-code'].emit('click');
  assert.equal(state.requests.length, 0);
  assert.equal(el['code-output'].hidden, true);
  assert.match(el['code-status'].textContent, /generador en línea/);
});

test('source failures are recoverable and never expose partial or invalid code', async () => {
  for (const reply of [null, { ok: false }, { ok: true, text: async () => '<html>Not a script</html>' },
    { ok: true, text: async () => sourceFor('telcel', 'solid').replace('  backgroundHex:', '  renamed:') }]) {
    let fail = true;
    const { elements: el } = preview('', { fetch: async () => {
      if (fail) { if (!reply) throw new Error(); return reply; }
      return { ok: true, text: async () => sourceFor('telcel', 'solid') };
    } });
    await el['generate-code'].emit('click');
    assert.equal(el.code.value, '');
    assert.equal(el['copy-code'].disabled, true);
    assert.match(el['code-status'].textContent, /No se pudo cargar/);
    fail = false;
    await el['generate-code'].emit('click');
    assert.equal(el['copy-code'].disabled, false);
  }
});

test('clipboard failure selects the full code for manual copying', async () => {
  const { elements: el } = preview('', { copyError: true });
  await el['generate-code'].emit('click');
  await el['copy-code'].emit('click');
  assert.equal(el.code.focused, true);
  assert.equal(el.code.selected, true);
  assert.match(el['code-status'].textContent, /manualmente/);
});

test('themes apply preset palettes and switch to custom after any manual color edit', () => {
  const { elements: el } = preview();
  assert.equal(el.theme.value, 'dark');
  assert.equal(el['primary-hex'].value, 'FFFFFF');
  el.theme.value = 'light'; el.theme.emit('change');
  assert.equal(el.hex.value, 'F5F5F7');
  assert.equal(el['primary-hex'].value, '18181B');
  assert.equal(el['secondary-hex'].value, '52525B');
  assert.equal(el.card.style['--warning'], '#9A3412');
  el.carrier.value = 'bait'; el.carrier.emit('change');
  assert.equal(el['accent-hex'].value, 'FFC700');
  el['primary-picker'].value = '#abcdef'; el['primary-picker'].emit('input');
  assert.equal(el.theme.value, 'custom');
  assert.equal(el['primary-hex'].value, 'ABCDEF');
  el.carrier.value = 'telcel'; el.carrier.emit('change');
  assert.equal(el['primary-hex'].value, 'ABCDEF');
  assert.equal(el['accent-hex'].value, 'FFC700');
  el.theme.value = 'dark'; el.theme.emit('change');
  assert.equal(el.hex.value, '101012');
  assert.equal(el['primary-hex'].value, 'FFFFFF');
  assert.equal(el['accent-hex'].value, 'FF453A');
});

test('text and accent validation block export while preserving the last valid palette', async () => {
  for (const key of ['primary', 'secondary', 'accent']) {
    const { elements: el } = preview();
    await el['generate-code'].emit('click');
    const before = el.card.style[`--${key}`];
    el[`${key}-hex`].value = 'invalid'; el[`${key}-hex`].emit('input');
    assert.equal(el[`${key}-error`].hidden, false);
    assert.equal(el.card.style[`--${key}`], before);
    assert.equal(el['generate-code'].disabled, true);
    assert.equal(el['copy-code'].disabled, true);
    el[`${key}-picker`].value = '#246810'; el[`${key}-picker`].emit('input');
    assert.equal(el[`${key}-error`].hidden, true);
    assert.equal(el['generate-code'].disabled, false);
  }
});

test('all chart modes and independent colors export correctly for every canonical script', async () => {
  for (const carrier of ['telcel', 'bait']) {
    for (const design of ['solid', 'image']) {
      for (const chart of ['bar', 'arc', 'none']) {
        const { elements: el } = preview(`?carrier=${carrier}&design=${design}&primary=112233&secondary=445566&accent=00aacc&chart=${chart}&plan=false`);
        assert.equal(el.plan.textContent, carrier === 'bait' ? 'Bait' : 'Telcel');
        assert.equal(el['carrier-badge'].hidden, true);
        assert.equal(el.arc.hidden, chart !== 'arc');
        assert.equal(el.progress.hidden, chart !== 'bar');
        assert.equal(el.percentage.hidden, chart === 'none');
        assert.equal(el.card.style['--track'], 'rgba(68, 85, 102, 0.25)');
        if (chart === 'arc') assert.ok(Number(el['arc-fill'].style.strokeDashoffset) > 0);
        await el['generate-code'].emit('click');
        const settings = exportedSettings(el.code.value);
        assert.equal(settings.textPrimaryHex, '112233');
        assert.equal(settings.textSecondaryHex, '445566');
        assert.equal(settings.accentHex, '00AACC');
        assert.equal(settings.chartStyle, chart);
        assert.equal(settings.showPlanName, false);
        assert.equal(settings.useSampleData, false);
        assert.equal(settings.debug, false);
        el['show-plan'].checked = true; el['show-plan'].emit('change');
        assert.equal(el['copy-code'].disabled, true);
        assert.equal(el['carrier-badge'].hidden, false);
      }
    }
  }
});

test('theme and opacity changes do not reload images; chart edits invalidate generated code', async () => {
  const { elements: el, state } = preview('?design=image&image=https://example.com/a.jpg&overlay=0.4');
  el.background.onload();
  assert.equal(state.images.length, 1);
  el.theme.value = 'light'; el.theme.emit('change');
  assert.equal(el['image-url'].value, 'https://example.com/a.jpg');
  assert.equal(el.opacity.value, '0.4');
  assert.equal(state.images.length, 1);
  await el['generate-code'].emit('click');
  el['chart-style'].value = 'arc'; el['chart-style'].emit('change');
  assert.equal(el['copy-code'].disabled, true);
  assert.equal(el.code.value, '');
  assert.equal(el.card.classList.contains('is-arc'), true);
  assert.equal(state.images.length, 1);
  el['chart-style'].value = 'none'; el['chart-style'].emit('change');
  assert.equal(el.card.classList.contains('is-none'), true);
  assert.equal(el.arc.hidden, true);
});
