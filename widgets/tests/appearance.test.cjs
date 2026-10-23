const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadWidget } = require('./scriptable-mock.cjs');

for (const carrier of ['telcel', 'bait']) {
  for (const design of ['solid', 'image']) {
    const label = `${carrier}/${design}`;
    test(`${label}: custom colors reach text, chart and carrier; warnings stay independent`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, settings: {
        backgroundHex: 'F5F5F7', textPrimaryHex: '112233', textSecondaryHex: '445566',
        accentHex: '00AACC', chartStyle: 'arc', showPlanName: false,
      } });
      hooks.createWidget({ data: hooks.SAMPLE_DATA, updateFailed: true });
      const text = value => state.nodes.find(node => node.kind === 'text' && node.value === value);
      assert.equal(text((hooks.SAMPLE_DATA.remaining_data ?? hooks.SAMPLE_DATA.remaining_gb).toFixed(1)).textColor.hex, '112233');
      assert.equal(text('GB').textColor.hex, '445566');
      assert.equal(text(carrier === 'bait' ? 'Bait' : 'Telcel').textColor.hex, '00AACC');
      assert.equal(state.texts.includes(hooks.SAMPLE_DATA.plan_name), false);
      assert.equal(text('No se pudo actualizar').textColor.hex, '9A3412');
      const timestamps = state.nodes.filter(node => node.kind === 'text' && node.value.startsWith('Última ejecución · '));
      assert.equal(timestamps.length, 1);
      assert.equal(timestamps[0].font.size, 8);
      const strokes = state.drawings[0].operations.filter(op => op.type === 'stroke');
      assert.equal(strokes[0].color.hex, '445566');
      assert.equal(strokes[0].color.opacity, 0.25);
      assert.equal(strokes[1].color.hex, '00AACC');
      assert.equal(state.requests.length, 0);
    });

    test(`${label}: bars and semicircles clamp percentages and render a 180-degree sweep`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier });
      for (const value of [null, -10, 0, 33.333, 100, 150, NaN]) {
        const fraction = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : 0;
        state.drawings.length = 0;
        hooks.drawProgressBar(value);
        const fills = state.drawings[0].operations.filter(op => op.type === 'fill');
        assert.equal(fills.length, fraction > 0 ? 2 : 1);
        assert.equal(fills[0].path.rects[0].width, 112);
        if (fraction > 0) assert.ok(Math.abs(fills[1].path.rects[0].width - 112 * fraction) < 1e-8);
        state.drawings.length = 0;
        hooks.drawProgressArc(value);
        const canvas = state.drawings[0];
        assert.equal(canvas.size.width, 112);
        assert.equal(canvas.size.height, 68);
        const strokes = canvas.operations.filter(op => op.type === 'stroke');
        assert.equal(strokes.length, fraction > 0 ? 2 : 1);
        assert.equal(strokes[0].width, 5);
        const track = strokes[0].path.points;
        assert.ok(Math.abs(track[0].x - 3) < 1e-8);
        assert.ok(Math.abs(track.at(-1).x - 109) < 1e-8);
        for (const point of track) assert.ok(point.y >= 3 - 1e-8 && point.y <= 56 + 1e-8);
        if (fraction > 0) {
          const end = strokes[1].path.points.at(-1);
          assert.ok(Math.abs(end.x - (56 + 53 * Math.cos(Math.PI + Math.PI * fraction))) < 1e-8);
          assert.ok(Math.abs(end.y - (56 + 53 * Math.sin(Math.PI + Math.PI * fraction))) < 1e-8);
        }
      }
    });

    test(`${label}: all layouts preserve balances, long labels, warnings and setup/error states`, async () => {
      for (const chartStyle of ['bar', 'arc', 'none']) {
        const { hooks, state } = await loadWidget(design, { carrier, settings: { chartStyle } });
        const data = { ...hooks.SAMPLE_DATA, plan_name: 'A very long plan name that must fit one line',
          ...(carrier === 'telcel' ? { remaining_data: 105, total_data: 105 } : { remaining_gb: 105, total_gb: 105 }), used_percentage: null,
          ...(carrier === 'bait' ? { data_tier: 'throttled' } : {}) };
        hooks.createWidget({ data, updateFailed: true });
        assert.ok(state.texts.includes('105.0'));
        assert.ok(state.texts.includes(data.plan_name));
        assert.ok(state.texts.includes('No se pudo actualizar'));
        if (carrier === 'bait') assert.ok(state.texts.some(value => value.startsWith('Velocidad reducida')));
        const balance = state.nodes.find(node => node.value === '105.0');
        assert.equal(balance.font.size, chartStyle === 'arc' ? 30 : chartStyle === 'none' ? 40 : 34);
        assert.equal(state.drawings.length, chartStyle === 'none' ? 0 : 1);
        assert.equal(state.texts.some(value => /% (usado|utilizado)/.test(value)), chartStyle !== 'none');
        for (const setupRequired of [true, false]) {
          state.texts.length = 0; state.drawings.length = 0;
          hooks.createWidget({ data: null, updateFailed: true, setupRequired });
          assert.equal(state.drawings.length, 0);
          assert.ok(state.texts.includes(setupRequired ? `Configura ${carrier === 'bait' ? 'Bait' : 'Telcel'}` : 'No se pudo cargar'));
          assert.equal(state.texts.filter(value => value.startsWith('Última ejecución · ')).length, 1);
        }
      }
    });

    test(`${label}: invalid manual settings fall back to readable defaults`, async () => {
      const { hooks, state } = await loadWidget(design, { carrier, settings: {
        backgroundHex: 'invalid', textPrimaryHex: null, textSecondaryHex: '', accentHex: '#x', chartStyle: 'unknown',
      } });
      hooks.createWidget({ data: hooks.SAMPLE_DATA });
      assert.equal(hooks.COLORS.background, '101012');
      assert.equal(hooks.COLORS.text, 'FFFFFF');
      assert.equal(hooks.COLORS.muted, '929298');
      assert.equal(state.drawings[0].size.height, 7);
    });
  }
}

test('all four standalone scripts share the same appearance renderer', () => {
  const renderers = ['telcel', 'bait'].flatMap(carrier => ['solid', 'image'].map(design => {
    const source = fs.readFileSync(path.join(__dirname, '..', carrier, `${design}.js`), 'utf8');
    return source.slice(source.indexOf('function appearanceHex'), source.indexOf('async function main()'));
  }));
  for (const renderer of renderers.slice(1)) assert.equal(renderer, renderers[0]);
});
