const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEY = 'mobile-data-tracker.telcel.credentials.v1';
const CACHE = '/library/mobile-data-tracker-telcel-usage-v1.json';
const CREDENTIALS = { phone: '5512345678', password: 'private password+ñ', profileId: 'test-profile' };
const BAIT_KEY = 'mobile-data-tracker.bait.credentials.v1';
const BAIT_CACHE = '/library/mobile-data-tracker-bait-usage-v1.json';
const BAIT_CREDENTIALS = { phone: '5598765432', profileId: 'bait-profile' };
const NOW = Date.UTC(2026, 9, 20, 21, 38);

function homeResponse() {
  const values = {
    'tabs-plans-v2-plan-name-0-0-0': 'Plan 20 GB',
    'tabs-plans-v2-total-data-value-0-0-0': '20',
    'tabs-plans-v2-used-data-value-0-0-0': 5,
    'tabs-plans-v2-available-data-value-0-0-0': '15',
    'last-update-text': 'Información al 30/12/2026 14:35 h',
    'text-due-value': '2 de enero',
  };
  return { data: { components: [
    ...Object.entries(values).map(([id, value]) => ({ id, config: { value } })),
    { id: 'tabs-plans-v2-limited-cutoff-message-0-0-0', config: { segments: [{ text: 'Faltan ' }, { text: '3 días' }] } },
  ] } };
}

function fullFlow(home = homeResponse()) {
  return [
    { body: { estatus: 'ok', token: 'private-sso-token' } },
    { body: { message: 'Éxito.', tokenResponse: { tokens: [{ id: 'token:b2f', access_token: 'private-access-token' }] } } },
    { body: home },
    { status: 204, text: '' },
  ];
}

async function loadWidget(design, options = {}) {
  const carrier = options.carrier || 'telcel';
  const profileKey = carrier === 'bait' ? BAIT_KEY : KEY;
  const filename = path.join(__dirname, '..', carrier, `${design}.js`);
  let source = fs.readFileSync(filename, 'utf8');
  // Keep bundled website configuration out of test snapshots and failure output.
  source = source.replace(/const CLIENT_AUTH = "[^"]+";/, `const CLIENT_AUTH = "${Buffer.from('test-client-auth').toString('base64')}";`);
  if (!/\nawait main\(\);\s*$/.test(source)) throw new Error('Missing standalone entry point');
  source = source.replace(/\nawait main\(\);\s*$/, '');
  const state = {
    now: NOW, keys: new Map(), files: new Map(), queue: [], alerts: [], prompts: [],
    requests: [], logs: [], texts: [], widgets: [], previews: 0, completed: 0,
    writeError: false, removeError: false, keyWriteError: false,
    ...options,
  };
  if (options.credentials) state.keys.set(profileKey, JSON.stringify(options.credentials));
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const files = {
    libraryDirectory: () => '/library',
    joinPath: (parent, name) => `${parent}/${name}`,
    fileExists: name => state.files.has(name),
    readString(name) {
      const value = state.files.get(name);
      if (typeof value !== 'string') throw new Error('Unreadable file');
      return value;
    },
    writeString(name, value) {
      if (state.writeError) throw new Error('Storage unavailable');
      state.files.set(name, value);
    },
    readImage(name) {
      const value = state.files.get(name);
      if (!value || typeof value !== 'object') throw new Error('Invalid image');
      return value;
    },
    writeImage(name, value) {
      if (state.writeError) throw new Error('Storage unavailable');
      state.files.set(name, value);
    },
    remove(name) {
      if (state.removeError) throw new Error('Storage unavailable');
      state.files.delete(name);
    },
  };
  class Alert {
    constructor() { this.fields = []; this.actions = []; }
    addTextField(label, value) { this.fields.push({ label, value, secure: false }); }
    addSecureTextField(label, value) { this.fields.push({ label, value, secure: true }); }
    addAction(value) { this.actions.push(value); }
    addCancelAction(value) { this.cancel = value; }
    async show(type) {
      state.prompts.push({ type, title: this.title, fields: this.fields, actions: this.actions });
      this.reply = state.alerts.shift() || { action: -1 };
      return this.reply.action;
    }
    presentAlert() { return this.show('alert'); }
    presentSheet() { return this.show('sheet'); }
    textFieldValue(i) { return this.reply.fields[i]; }
  }
  class Request {
    constructor(url) { this.url = url; this.method = 'GET'; this.headers = {}; }
    async reply(kind) {
      state.requests.push({ url: this.url, method: this.method, headers: this.headers,
        body: this.body, timeout: this.timeoutInterval, kind });
      const next = state.queue.shift();
      if (!next) throw new Error('Unexpected mocked request');
      if (next.error) throw next.error;
      if (next.advance) state.now += next.advance;
      this.response = { statusCode: next.status === undefined ? 200 : next.status, headers: next.headers || {} };
      return next;
    }
    async loadString() {
      const next = await this.reply('text');
      return next.text === undefined ? JSON.stringify(next.body) : next.text;
    }
    async loadImage() {
      return (await this.reply('image')).image;
    }
  }
  class Node {
    addText(value) { state.texts.push(String(value)); return new Node(); }
    addStack() { return new Node(); }
    addImage() { return new Node(); }
    addSpacer() {}
    centerAlignContent() {}
    bottomAlignContent() {}
    layoutVertically() {}
    leftAlignImage() {}
    setPadding() {}
  }
  class ListWidget extends Node {
    constructor() { super(); state.widgets.push(this); }
    async presentSmall() { state.previews++; }
  }
  class Size { constructor(width, height) { this.width = width; this.height = height; } }
  class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } }
  class Color { constructor(hex, opacity = 1) { Object.assign(this, { hex, opacity }); } }
  class Path { addRoundedRect() {} }
  class DrawContext {
    setFillColor() {}
    addPath() {}
    fillPath() {}
    fillRect() {}
    drawImageInRect() {}
    getImage() { return { size: { width: this.size.width, height: this.size.height } }; }
  }
  const context = vm.createContext({
    Date: Clock, config: { runsInWidget: options.runsInWidget !== false },
    Keychain: {
      contains: name => state.keys.has(name), get: name => state.keys.get(name),
      set(name, value) {
        if (state.keyWriteError) throw new Error('Keychain unavailable');
        state.keys.set(name, value);
      },
    },
    FileManager: { local: () => files }, Alert, Request, ListWidget, Size, Rect, Color, Path, DrawContext,
    Font: { systemFont: size => ({ size }), boldSystemFont: size => ({ size }), mediumSystemFont: size => ({ size }) },
    Data: {
      fromString: value => ({ toBase64String: () => Buffer.from(value, 'utf8').toString('base64') }),
      fromBase64String: value => ({ toRawString: () => Buffer.from(value, 'base64').toString('utf8') }),
    },
    Script: { setWidget: widget => { state.widget = widget; }, complete: () => { state.completed++; } },
    console: { log: value => state.logs.push(value) },
  });
  const hooks = await new vm.Script(`(async () => {\n${source}\nreturn {
    SETTINGS, SAMPLE_DATA, KEYCHAIN_KEY, CACHE_FILE, readCredentials, configureCredentials,
    credentialsForRun, parseUsage, isUsageData, loadUsage, fetchUsage, readCache, writeCache,
    retryDeadline, createWidget, main,
    loadBackgroundImage: typeof loadBackgroundImage === 'function' ? loadBackgroundImage : null,
  };\n})()`, { filename: `${carrier}-${design}.js` }).runInContext(context);
  if (options.settings) Object.assign(hooks.SETTINGS, options.settings);
  return { hooks, state };
}

module.exports = { loadWidget, homeResponse, fullFlow, CREDENTIALS, KEY, CACHE, NOW, BAIT_KEY, BAIT_CACHE, BAIT_CREDENTIALS };
