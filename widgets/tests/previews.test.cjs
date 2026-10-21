const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadWidget } = require('./scriptable-mock.cjs');

function preview(design, search = '', width = 1000) {
  const html = fs.readFileSync(path.join(__dirname, '../previews', `${design}.html`), 'utf8');
  const elements = {};
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const tag = match[0];
    const listeners = {};
    const classes = new Set();
    elements[match[1]] = {
      value: (tag.match(/\bvalue="([^"]*)"/)?.[1] || '').replaceAll('&amp;', '&'),
      hidden: /\bhidden\b/.test(tag),
      style: { setProperty(key, value) { this[key] = value; } },
      classList: { toggle(key, enabled) { enabled ? classes.add(key) : classes.delete(key); }, contains(key) { return classes.has(key); } },
      setAttribute(key, value) { this[key] = value; },
      removeAttribute(key) { delete this[key]; },
      addEventListener(key, callback) { listeners[key] = callback; },
      emit(key) { listeners[key]?.({ target: this }); },
    };
  }
  elements.carrier.value = 'telcel';
  elements.state.value = 'success';
  const context = vm.createContext({
    document: { body: { dataset: { design } }, getElementById: id => elements[id] },
    window: { location: { search }, innerWidth: width }, URL, URLSearchParams,
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { elements, evaluate: expression => vm.runInContext(expression, context) };
}

for (const design of ['solid', 'image']) {
  test(`${design} preview: carrier samples match the standalone scripts`, async () => {
    const { elements: el, evaluate } = preview(design, '?image=');
    for (const carrier of ['telcel', 'bait']) {
      const { hooks } = await loadWidget(design, { carrier });
      assert.deepEqual(JSON.parse(JSON.stringify(evaluate(`SAMPLES.${carrier}`))), JSON.parse(JSON.stringify(hooks.SAMPLE_DATA)));
      el.carrier.value = carrier;
      el.carrier.emit('change');
      assert.equal(el.remaining.textContent, carrier === 'bait' ? '13.5' : '1.6');
      assert.match(el.timestamp.textContent, carrier === 'bait' ? /^Consultado/ : /^Actualizado/);
    }
  });

  test(`${design} preview: empty, stale and reduced-speed states`, () => {
    const { elements: el } = preview(design, '?carrier=bait&state=throttled&image=');
    assert.equal(el.remaining.textContent, '105.0');
    assert.match(el.available.textContent, /^Velocidad reducida/);
    el.state.value = 'stale'; el.state.emit('change');
    assert.equal(el.warning.hidden, false);
    for (const state of ['error', 'setup']) {
      el.state.value = state; el.state.emit('change');
      assert.equal(el.usage.hidden, true);
      assert.equal(el.empty.hidden, false);
      assert.match(el['empty-title'].textContent, state === 'setup' ? /Configura Bait/ : /No se pudo cargar/);
    }
    el.state.value = 'throttled'; el.carrier.value = 'telcel'; el.carrier.emit('change');
    assert.equal(el.state.value, 'success');
    assert.equal(el['throttled-option'].disabled, true);
    assert.equal(el.usage.hidden, false);
    assert.equal(el.warning.hidden, true);
  });

  test(`${design} preview: valid settings can be copied, invalid colors preserve the applied background`, () => {
    const { elements: el, evaluate } = preview(design, '?hex=%23abcdef&image=', 390);
    assert.equal(el.card.style.backgroundColor, '#ABCDEF');
    assert.equal(el.frame.style.width, '255px');
    el.hex.value = 'invalid'; el.hex.emit('input');
    assert.equal(el['color-error'].hidden, false);
    assert.equal(el.card.style.backgroundColor, '#ABCDEF');
    el['color-picker'].value = '#123456'; el['color-picker'].emit('input');
    assert.equal(el.hex.value, '123456');
    assert.equal(el['color-error'].hidden, true);
    const settings = evaluate(`({${el.settings.value}})`);
    assert.equal(settings.backgroundHex, '123456');
    assert.equal('backgroundImageUrl' in settings, design === 'image');
  });
}

test('image preview: load failure and empty states use the solid background', () => {
  const { elements: el } = preview('image', '?image=https://example.com/background.jpg&overlay=4');
  assert.equal(el.opacity.value, '1');
  el.background.onload();
  assert.equal(el.background.hidden, false);
  assert.equal(el.card.classList.contains('has-background'), true);
  el.state.value = 'setup'; el.state.emit('change');
  assert.equal(el.background.hidden, true);
  el.state.value = 'success'; el.state.emit('change');
  assert.equal(el.background.hidden, false);
  el.background.onerror();
  assert.equal(el.background.hidden, true);
  assert.equal(el.card.classList.contains('has-background'), false);
  el['image-url'].value = ''; el['apply-image'].emit('click');
  assert.equal(el.background.src, undefined);
  assert.match(el.settings.value, /backgroundImageUrl: ""/);
});

test('image preview: rejected URLs preserve the selected image and settings', () => {
  const { elements: el } = preview('image', '?image=https://example.com/background.jpg');
  const settings = el.settings.value;
  el['image-url'].value = 'javascript:alert(1)'; el['apply-image'].emit('click');
  assert.equal(el['image-url']['aria-invalid'], 'true');
  assert.equal(el.background.src, 'https://example.com/background.jpg');
  assert.equal(el.settings.value, settings);
  el.opacity.value = '0.4'; el.opacity.emit('input');
  assert.equal(el.card.style['--overlay-opacity'], '0.4');
  assert.match(el.settings.value, /backgroundOverlayOpacity: 0.4/);
});
