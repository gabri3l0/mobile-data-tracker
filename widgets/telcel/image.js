// Variables used by Scriptable.
// icon-color: red; icon-glyph: signal;

const RUN_AT = new Date();
const WIDGET_VERSION = "1.0.0";
const WIDGET_CARRIER = "telcel";
const WIDGET_DESIGN = "image";
// Customize the settings below. Guide: widgets/README.md#customize
// Enter account details when running the script; they are saved in Keychain.
const SETTINGS = {
  backgroundHex: "101012", // Replace with your six-digit hex color, without #.
  // Replace with your image URL, or "" to use the solid color.
  backgroundImageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdZaVghFotA_TTTq7zfOxO5AipAmIdJpEJaQ0j4WnVb0BQfW67EaoZPcXC&s=10",
  backgroundOverlayOpacity: 0.65, // 0 = no dark overlay; 1 = fully black.
  backgroundCacheHours: 24,
  backgroundTimeoutSeconds: 5,
  textPrimaryHex: "FFFFFF", // Main balance and plan name.
  textSecondaryHex: "929298", // Details, units, and chart track (25% opacity).
  accentHex: "FF453A", // Chart fill and carrier label.
  chartStyle: "bar", // bar, arc (semicircle), or none.
  showPlanName: true, // false shows only the carrier in the header.
  cacheMinutes: 30,
  retryMinutes: 15,
  requestTimeoutSeconds: 20,
  debug: false, // Safe request, cache, and failure logs in Scriptable.
  useSampleData: false,
  sampleState: "success", // success, stale, error, setup, update.
};
const CLIENT_AUTH = "YlhSd2MyVnlkbWxqWlhNNk55UTROM0ptUm5OM1pTUXlNVjg9";
const CARRIER_NAME = "Telcel";
const COLORS = {
  get background() { return appearanceHex(SETTINGS.backgroundHex, "101012"); },
  get text() { return appearanceHex(SETTINGS.textPrimaryHex, "FFFFFF"); },
  get muted() { return appearanceHex(SETTINGS.textSecondaryHex, "929298"); },
  get accent() { return appearanceHex(SETTINGS.accentHex, "FF453A"); },
  get warning() {
    const hex = COLORS.background;
    const brightness = (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000;
    return brightness > 140 ? "9A3412" : "FFB454";
  },
};
const BAR_WIDTH = 112;
const BAR_HEIGHT = 7;
const SAMPLE_DATA = {
  plan_name: "Plan 7 GB", expiration_date: "2026-10-24", days_until: 5,
  last_updated: "2026-10-18T01:30:00", total_data: 7, total_unit: "GB", used_data: 5.4, used_unit: "GB", remaining_data: 1.6, remaining_unit: "GB",
  used_percentage: 77.14, remaining_percentage: 22.86,
};

// Shared across all carriers and styles; independent of account and usage caches.
const VERSION_CACHE_FILE = "mobile-data-tracker-version-v1.json";
const VERSION_URL = "https://gabri3l0.github.io/mobile-data-tracker/widgets/version.json";

function updateURL() {
  const appearance = {
    theme: "custom", hex: COLORS.background, primary: COLORS.text,
    secondary: COLORS.muted, accent: COLORS.accent,
    chart: chartStyle(), plan: String(SETTINGS.showPlanName !== false),
  };
  if (WIDGET_DESIGN === "image") {
    appearance.image = SETTINGS.backgroundImageUrl || "";
    appearance.overlay = String(Math.max(0, Math.min(1, SETTINGS.backgroundOverlayOpacity)));
  }
  // Keep appearance (including image URLs) in the fragment, separate from the page request.
  const params = Object.entries(appearance)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?carrier=${WIDGET_CARRIER}&design=${WIDGET_DESIGN}&update=1#${params}`;
}

function versionParts(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function newerVersion(latest, installed = WIDGET_VERSION) {
  const a = versionParts(latest), b = versionParts(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function checkForUpdate() {
  const now = Date.now();
  let files, path, cache = null;
  try {
    files = FileManager.local();
    path = files.joinPath(files.libraryDirectory(), VERSION_CACHE_FILE);
    if (files.fileExists(path)) {
      const saved = JSON.parse(files.readString(path));
      if (saved && (saved.latestVersion === null || versionParts(saved.latestVersion))
        && Number.isFinite(saved.checkedAt) && saved.checkedAt >= 0 && saved.checkedAt <= now
        && Number.isFinite(saved.nextCheckAt) && saved.nextCheckAt >= saved.checkedAt
        && saved.nextCheckAt <= saved.checkedAt + 86400000) cache = saved;
    }
  } catch { /* Version metadata is optional. */ }
  if (cache && cache.nextCheckAt > now) return newerVersion(cache.latestVersion);
  let latestVersion = cache ? cache.latestVersion : null;
  let interval = 3600000;
  try {
    const request = new Request(VERSION_URL);
    request.timeoutInterval = 3;
    request.headers = { Accept: "application/json", "Cache-Control": "no-cache" };
    const body = await request.loadString();
    if (request.response.statusCode !== 200) throw new Error("Version unavailable");
    const metadata = JSON.parse(body);
    if (!metadata || !versionParts(metadata.version)) throw new Error("Invalid version");
    latestVersion = metadata.version;
    interval = 86400000;
  } catch { /* Keep the last known version and retry in one hour. */ }
  try {
    if (files && path) files.writeString(path, JSON.stringify({ latestVersion, checkedAt: now, nextCheckAt: now + interval }));
  } catch { /* Cache failures must not affect the widget. */ }
  return newerVersion(latestVersion);
}

const KEYCHAIN_KEY = "mobile-data-tracker.telcel.credentials.v1";
const CACHE_FILE = "mobile-data-tracker-telcel-usage-v1.json";

function debugLog(message) {
  if (SETTINGS.debug) console.log(`[Telcel] ${message}`);
}

function diagnosticError(code) {
  const error = new Error("No se pudo consultar Telcel.");
  error.code = /^(configuration|usage_data|login_rejected|token_missing|(?:login|token|usage|logout)_(?:network|json|http_[1-5]\d{2}))$/.test(code) ? code : "unknown";
  return error;
}

function cacheLocation() {
  const files = FileManager.local();
  return { files, path: files.joinPath(files.libraryDirectory(), CACHE_FILE) };
}

function readCredentials() {
  try {
    if (!Keychain.contains(KEYCHAIN_KEY)) return null;
    const value = JSON.parse(Keychain.get(KEYCHAIN_KEY));
    return value && typeof value.phone === "string" && /^\d{10}$/.test(value.phone) && typeof value.password === "string"
      && value.password.trim() && typeof value.profileId === "string" && value.profileId
      ? value : null;
  } catch {
    debugLog("No se pudo leer la configuración.");
    return null;
  }
}

async function configureCredentials(existing) {
  const alert = new Alert();
  alert.title = "Configurar Telcel";
  alert.message = "Tus datos se guardan en el Keychain de iOS.";
  alert.addTextField("Número de 10 dígitos", existing ? existing.phone : "");
  alert.addSecureTextField("Contraseña Mi Telcel", "");
  alert.addAction("Guardar");
  alert.addCancelAction("Cancelar");
  if (await alert.presentAlert() !== 0) return null;
  const phone = alert.textFieldValue(0).replace(/[\s()-]/g, "");
  const password = alert.textFieldValue(1);
  if (!/^\d{10}$/.test(phone) || !password.trim()) {
    const notice = new Alert();
    notice.title = "Revisa tus datos";
    notice.message = "Ingresa un número de 10 dígitos y tu contraseña de Mi Telcel.";
    notice.addAction("Aceptar");
    await notice.presentAlert();
    return null;
  }
  const credentials = { phone, password, profileId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
  try {
    Keychain.set(KEYCHAIN_KEY, JSON.stringify(credentials));
  } catch {
    const notice = new Alert();
    notice.title = "No se pudo guardar";
    notice.message = "Intenta configurar tus datos nuevamente.";
    notice.addAction("Aceptar");
    await notice.presentAlert();
    return null;
  }
  try {
    const { files, path } = cacheLocation();
    if (files.fileExists(path)) files.remove(path);
  } catch {
    // The profile ID also prevents reuse of an old account's cache.
    debugLog("No se pudo limpiar la lectura anterior.");
  }
  return credentials;
}

async function credentialsForRun() {
  const existing = readCredentials();
  if (config.runsInWidget) return { credentials: existing, cancelled: false };
  if (existing) {
    const menu = new Alert();
    menu.title = "Mi Telcel";
    menu.addAction("Ver widget");
    menu.addAction("Cambiar datos");
    menu.addAction("Obtener nueva versión");
    menu.addCancelAction("Cancelar");
    const action = await menu.presentSheet();
    if (action === 2) {
      Safari.open(updateURL());
      return { credentials: existing, cancelled: true };
    }
    if (action === 0) return { credentials: existing, cancelled: false };
    if (action !== 1) return { credentials: existing, cancelled: true };
  }
  const credentials = await configureCredentials(existing);
  return { credentials, cancelled: credentials === null };
}

function isUsageData(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    && typeof data.plan_name === "string"
    && ["total_data", "used_data", "remaining_data", "days_until"].every(key => typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0)
    && ["total_unit", "used_unit", "remaining_unit"].every(key => ["MB", "GB"].includes(data[key]))
    && Number.isInteger(data.days_until)
    && ["used_percentage", "remaining_percentage"].every(key => data[key] === null || (typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0))
    && typeof data.last_updated === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(data.last_updated)
    && typeof data.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.expiration_date);
}

function readCache(credentials) {
  try {
    const { files, path } = cacheLocation();
    if (!files.fileExists(path)) return null;
    const cache = JSON.parse(files.readString(path));
    // Preserve saved GB readings from earlier widget versions.
    if (cache.data && cache.data.total_data === undefined) {
      for (const field of ["total", "used", "remaining"]) {
        cache.data[`${field}_data`] = cache.data[`${field}_gb`];
        cache.data[`${field}_unit`] = "GB";
        delete cache.data[`${field}_gb`];
      }
    }
    if (cache.profileId !== credentials.profileId || !(cache.data === null || isUsageData(cache.data))
      || !Number.isFinite(cache.fetchedAt) || cache.fetchedAt < 0 || cache.fetchedAt > Date.now()
      || !Number.isFinite(cache.retryAt) || cache.retryAt < 0) return null;
    return cache;
  } catch {
    debugLog("Caché no disponible.");
    return null;
  }
}

function writeCache(credentials, cache) {
  try {
    const { files, path } = cacheLocation();
    files.writeString(path, JSON.stringify({ profileId: credentials.profileId, ...cache }));
    debugLog("Caché guardada.");
  } catch {
    debugLog("No se pudo guardar la lectura.");
  }
}

function retryDeadline(headers) {
  const key = Object.keys(headers).find(name => name.toLowerCase() === "retry-after");
  const value = key ? String(headers[key]).trim() : "";
  const deadline = /^\d+$/.test(value) ? Date.now() + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(deadline) && deadline > Date.now() ? deadline : Date.now() + SETTINGS.retryMinutes * 60000;
}

async function requestText(url, stage, options = {}) {
  const request = new Request(url);
  request.method = options.method || "GET";
  request.headers = { Accept: "application/json", ...options.headers };
  request.timeoutInterval = options.timeoutSeconds || SETTINGS.requestTimeoutSeconds;
  if (options.body !== undefined) request.body = options.body;
  const label = ["login", "token", "usage", "logout"].includes(stage) ? stage : "request";
  const startedAt = Date.now();
  debugLog(`Solicitud ${label}: iniciada.`);
  let text;
  try {
    text = await request.loadString();
  } catch {
    debugLog(`Solicitud ${label}: fallo de red o tiempo agotado.`);
    throw diagnosticError(`${stage}_network`);
  }
  const status = request.response ? request.response.statusCode : 0;
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : "desconocido";
  debugLog(`Solicitud ${label}: HTTP ${safeStatus} (${Date.now() - startedAt} ms).`);
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    const error = diagnosticError(`${stage}_http_${status}`);
    if (status === 429) {
      error.retryAt = retryDeadline(request.response.headers || {});
      debugLog(`Límite del operador: esperar ${Math.ceil((error.retryAt - Date.now()) / 60000)} min.`);
    }
    throw error;
  }
  return text;
}

async function requestJson(url, stage, options = {}) {
  const text = await requestText(url, stage, options);
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    // Omit the raw response and native parser error.
  }
  debugLog(`Respuesta no válida: ${diagnosticError(`${stage}_json`).code}.`);
  throw diagnosticError(`${stage}_json`);
}

function formBody(values) {
  return Object.keys(values).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`).join("&");
}

async function fetchUsage(credentials) {
  debugLog("Inicio de sesión.");
  const login = await requestJson("https://wbl.telcel-id.com:8443/login", "login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      username: credentials.phone,
      "telcel-pass": credentials.password,
      pB64: Data.fromString(credentials.password).toBase64String(),
      CCode: "52",
      sitedomain: "https://www.mitelcel.com",
    }),
  });
  if (login.estatus !== "ok" || typeof login.token !== "string" || !login.token.trim()) throw diagnosticError("login_rejected");
  try {
    const tokens = await requestJson(`https://mi-telcel.smapps.mx/security/1.0.0/v2/token?user=${encodeURIComponent(credentials.phone)}&token=${encodeURIComponent(login.token)}`, "token", {
      headers: {
        Authorization: `Basic ${Data.fromBase64String(CLIENT_AUTH).toRawString()}`,
        "app-version": "0.14", "code-version": "38", "device-id": "DSK",
        os: "WEB", "os-version": "13", scope: "token:mit|token:b2f", "x-channel": "web-browser",
      },
    });
    const entries = tokens.tokenResponse && tokens.tokenResponse.tokens;
    const access = Array.isArray(entries) ? entries.find(entry => entry && entry.id === "token:b2f") : null;
    if (tokens.message !== "Éxito." || !access || typeof access.access_token !== "string" || !access.access_token.trim()) throw diagnosticError("token_missing");
    const response = await requestJson(`https://api.journeys.telcel.wavebybemobi.com/api/components/flow/home?externalCode=${encodeURIComponent(credentials.phone)}`, "usage", {
      headers: { Authorization: `Bearer ${access.access_token}` },
    });
    return parseUsage(response);
  } finally {
    debugLog("Cierre de sesión SSO.");
    try {
      await requestText("https://dev.smapps.mx:9000/sso/revoke", "logout", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ token: login.token, token_type: "revoke" }), timeoutSeconds: 5,
      });
    } catch {
      debugLog("No se pudo completar el cierre de sesión.");
    }
  }
}

function parseUsage(response) {
  function find(node, id) {
    if (node && typeof node === "object") {
      if (node.id === id) return node.config ?? null;
      for (const value of Object.values(node)) {
        const result = find(value, id);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }
  function component(id) {
    const result = find(response, id);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw diagnosticError("usage_data");
    return result;
  }
  function value(id) {
    const result = component(id).value;
    if (typeof result !== "string" && typeof result !== "number") throw diagnosticError("usage_data");
    return String(result);
  }
  function number(id) {
    let text = value(id).trim();
    if (text.includes(",")) {
      if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) throw diagnosticError("usage_data");
      text = text.replace(/,/g, "");
    }
    const result = Number(text);
    if (!text.trim() || !Number.isFinite(result) || result < 0) throw diagnosticError("usage_data");
    return result;
  }
  function date(year, month, day) {
    const result = new Date(Date.UTC(year, month - 1, day));
    if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) throw diagnosticError("usage_data");
    return result;
  }
  const plan = value(response.id === "home-corpo" ? "text-plan-name" : "tabs-plans-v2-plan-name-0-0-0");
  function dataReading(kind) {
    const amount = number(`tabs-plans-v2-${kind}-data-value-0-0-0`);
    const unitId = `tabs-plans-v2-${kind}-data-unit-0-0-0`;
    // Older responses without unit components were expressed in GB.
    const unit = find(response, unitId) === undefined ? "GB" : value(unitId).trim().toUpperCase();
    if (["MB", "GB"].includes(unit)) return { amount, unit };
    throw diagnosticError("usage_data");
  }
  const totalReading = dataReading("total");
  const usedReading = dataReading("used");
  const remainingReading = dataReading("available");
  const toGB = reading => reading.unit === "MB" ? reading.amount / 1000 : reading.amount;
  const total = toGB(totalReading);
  const used = toGB(usedReading);
  const remaining = toGB(remainingReading);
  const updated = value("last-update-text").replace("Información al ", "").replace(" h", "").trim();
  const parts = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(updated);
  if (!parts || Number(parts[4]) > 23 || Number(parts[5]) > 59) throw diagnosticError("usage_data");
  const year = Number(parts[3]);
  const readingDate = date(year, Number(parts[2]), Number(parts[1]));
  const segments = component("tabs-plans-v2-limited-cutoff-message-0-0-0").segments;
  if (!Array.isArray(segments) || segments.some(s => !s || typeof s.text !== "string")) throw diagnosticError("usage_data");
  const message = segments.map(s => s.text).join("");
  const days = /\bFaltan?\s+(\d+)\b/i.exec(message);
  const expiresToday = /^\s*Hoy\s+vence\s+tu\s+paquete\.?\s*$/i.test(message);
  if (!days && !expiresToday) throw diagnosticError("usage_data");
  const daysUntil = expiresToday ? 0 : Number(days[1]);
  let expiration;
  if (response.id === "home-corpo" && find(response, "text-due-value") === undefined) {
    expiration = new Date(readingDate.getTime() + daysUntil * 86400000);
    if (!Number.isFinite(expiration.getTime())) throw diagnosticError("usage_data");
  } else {
    const due = /^(\d{1,2}) de ([a-z]+)$/.exec(value("text-due-value").trim().toLowerCase());
    const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    if (!due || !months.includes(due[2])) throw diagnosticError("usage_data");
    expiration = date(year, months.indexOf(due[2]) + 1, Number(due[1]));
    if (expiration < readingDate) expiration = date(year + 1, months.indexOf(due[2]) + 1, Number(due[1]));
  }
  const data = {
    plan_name: plan, expiration_date: expiration.toISOString().slice(0, 10), days_until: daysUntil,
    last_updated: `${parts[3]}-${parts[2]}-${parts[1]}T${parts[4]}:${parts[5]}:00`,
    total_data: totalReading.amount, total_unit: totalReading.unit,
    used_data: usedReading.amount, used_unit: usedReading.unit,
    remaining_data: remainingReading.amount, remaining_unit: remainingReading.unit,
    used_percentage: total ? Math.round(used / total * 10000) / 100 : null,
    remaining_percentage: total ? Math.round(remaining / total * 10000) / 100 : null,
  };
  if (!isUsageData(data)) throw diagnosticError("usage_data");
  return data;
}

async function loadUsage(credentials) {
  const now = Date.now();
  const cache = readCache(credentials);
  if (cache && cache.retryAt > now) {
    debugLog(`Actualización en pausa: faltan ${Math.ceil((cache.retryAt - now) / 60000)} min.`);
    return { data: cache.data, updateFailed: true, refreshAt: cache.retryAt };
  }
  if (cache && cache.data && now - cache.fetchedAt < SETTINGS.cacheMinutes * 60000) {
    debugLog(`Usando lectura guardada: ${Math.floor((now - cache.fetchedAt) / 60000)} min de antigüedad.`);
    return { data: cache.data, updateFailed: false, refreshAt: cache.fetchedAt + SETTINGS.cacheMinutes * 60000 };
  }
  debugLog(cache && cache.data ? "Lectura vencida: consultar operador." : "Sin lectura guardada: consultar operador.");
  try {
    const data = await fetchUsage(credentials);
    debugLog("Lectura recibida y validada.");
    const fetchedAt = Date.now();
    writeCache(credentials, { data, fetchedAt, retryAt: 0 });
    return { data, updateFailed: false, refreshAt: fetchedAt + SETTINGS.cacheMinutes * 60000 };
  } catch (error) {
    const data = cache ? cache.data : null;
    const retryAt = error.retryAt || Date.now() + SETTINGS.retryMinutes * 60000;
    writeCache(credentials, { data, fetchedAt: cache ? cache.fetchedAt : 0, retryAt });
    debugLog(`No se pudo actualizar: ${diagnosticError(error.code || "unknown").code}.`);
    debugLog(data ? "Mostrando lectura anterior." : "Sin lectura disponible.");
    debugLog(`Próximo intento permitido en ${Math.ceil((retryAt - Date.now()) / 60000)} min.`);
    return { data, updateFailed: true, refreshAt: retryAt };
  }
}

async function loadBackgroundImage() {
  if (!SETTINGS.backgroundImageUrl.trim()) return null;
  let files, imagePath, metadataPath, cached = null;
  try {
    files = FileManager.local();
    imagePath = files.joinPath(files.libraryDirectory(), "mobile-data-telcel-background.png");
    metadataPath = files.joinPath(files.libraryDirectory(), "mobile-data-telcel-background.json");
    if (files.fileExists(metadataPath) && files.fileExists(imagePath)) {
      const metadata = JSON.parse(files.readString(metadataPath));
      if (metadata.url === SETTINGS.backgroundImageUrl) {
        cached = files.readImage(imagePath);
        const age = Date.now() - metadata.savedAt;
        if (cached && Number.isFinite(age) && age >= 0 && age < SETTINGS.backgroundCacheHours * 3600000) {
          debugLog("Fondo: usando imagen guardada.");
          return cached;
        }
      }
    }
  } catch {
    // Missing or corrupt image cache: try the URL once.
  }
  try {
    debugLog("Fondo: descarga iniciada.");
    const request = new Request(SETTINGS.backgroundImageUrl);
    request.timeoutInterval = SETTINGS.backgroundTimeoutSeconds;
    const image = await request.loadImage();
    const status = request.response.statusCode;
    if (status < 200 || status >= 300 || !image || image.size.width <= 0 || image.size.height <= 0) throw new Error("Image unavailable.");
    // Store a small square image to limit widget memory on later runs.
    const cropped = drawBackground(image, 0);
    try {
      if (files) {
        files.writeImage(imagePath, cropped);
        files.writeString(metadataPath, JSON.stringify({ url: SETTINGS.backgroundImageUrl, savedAt: Date.now() }));
      }
    } catch {
      // Still display the downloaded image if writing the cache fails.
    }
    debugLog("Fondo: descarga completada.");
    return cropped;
  } catch {
    debugLog(cached ? "Fondo: fallo de descarga; usando imagen guardada." : "Fondo: fallo de descarga; usando color sólido.");
    return cached;
  }
}

function drawBackground(image, opacity = SETTINGS.backgroundOverlayOpacity) {
  const edge = 400;
  const context = new DrawContext();
  context.size = new Size(edge, edge);
  context.respectScreenScale = false;
  context.opaque = true;
  const scale = Math.max(edge / image.size.width, edge / image.size.height);
  const width = image.size.width * scale;
  const height = image.size.height * scale;
  context.drawImageInRect(image, new Rect((edge - width) / 2, (edge - height) / 2, width, height));
  context.setFillColor(new Color("000000", Math.max(0, Math.min(1, opacity))));
  context.fillRect(new Rect(0, 0, edge, edge));
  return context.getImage();
}

function formatGB(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value.toFixed(1)
    : "—";
}

function clampPercentage(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;
}

function formatExpiration(value) {
  const [, month, day] = value.split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

function formatRunTime(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function appearanceHex(value, fallback) {
  return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().replace(/^#/, "").toUpperCase() : fallback;
}

function chartStyle() {
  return ["bar", "arc", "none"].includes(SETTINGS.chartStyle) ? SETTINGS.chartStyle : "bar";
}

function addExecutionTime(widget) {
  widget.addSpacer(4);
  addText(widget, `Última ejecución · ${formatRunTime(RUN_AT)}`, Font.systemFont(8), COLORS.muted);
}

function drawProgressBar(percentage) {
  const context = new DrawContext();
  context.size = new Size(BAR_WIDTH, BAR_HEIGHT);
  context.opaque = false;
  context.respectScreenScale = true;
  function roundedFill(width, color) {
    if (width <= 0) return;
    const radius = Math.min(BAR_HEIGHT / 2, width / 2);
    const path = new Path();
    path.addRoundedRect(new Rect(0, 0, width, BAR_HEIGHT), radius, radius);
    context.setFillColor(color);
    context.addPath(path);
    context.fillPath();
  }
  roundedFill(BAR_WIDTH, new Color(COLORS.muted, 0.25));
  roundedFill(BAR_WIDTH * clampPercentage(percentage) / 100, new Color(COLORS.accent));
  return context.getImage();
}

function drawProgressArc(percentage) {
  const context = new DrawContext();
  context.size = new Size(112, 68);
  context.opaque = false;
  context.respectScreenScale = true;
  function strokeArc(fraction, color) {
    if (fraction <= 0) return;
    const steps = Math.max(1, Math.ceil(fraction * 90));
    const path = new Path();
    let start, end;
    for (let i = 0; i <= steps; i++) {
      const angle = Math.PI + Math.PI * fraction * i / steps;
      const point = new Point(56 + 53 * Math.cos(angle), 56 + 53 * Math.sin(angle));
      if (i === 0) { start = point; path.move(point); }
      else path.addLine(point);
      end = point;
    }
    context.setStrokeColor(color);
    context.setLineWidth(5);
    context.addPath(path);
    context.strokePath();
    context.setFillColor(color);
    for (const point of [start, end]) context.fillEllipse(new Rect(point.x - 2.5, point.y - 2.5, 5, 5));
  }
  strokeArc(1, new Color(COLORS.muted, 0.25));
  strokeArc(clampPercentage(percentage) / 100, new Color(COLORS.accent));
  return context.getImage();
}

function addText(stack, value, font, color) {
  const text = stack.addText(value);
  text.font = font;
  text.textColor = new Color(color);
  text.lineLimit = 1;
  text.minimumScaleFactor = 0.7;
  return text;
}

function addStatusNotice(widget, updateFailed, updateAvailable) {
  if (!updateFailed && !updateAvailable) return;
  const message = updateAvailable
    ? (updateFailed ? "Error · Nueva versión" : "Nueva versión disponible")
    : "No se pudo actualizar";
  widget.addSpacer(3);
  addText(widget, message, Font.systemFont(8), COLORS.warning);
}

function createWidget({ data, updateFailed, setupRequired = false, refreshAt, updateAvailable = false }) {
  const widget = new ListWidget();
  if (updateAvailable) widget.url = updateURL();
  // iOS decides the actual refresh time; this is only the earliest requested time.
  if (refreshAt) widget.refreshAfterDate = new Date(refreshAt);
  widget.backgroundColor = new Color(COLORS.background);
  widget.setPadding(12, 12, 12, 12);
  const header = widget.addStack();
  header.centerAlignContent();
  if (SETTINGS.showPlanName !== false) {
    const title = header.addStack();
    title.size = new Size(96, 14);
    addText(title, data && data.plan_name ? data.plan_name : "Consumo", Font.boldSystemFont(11), COLORS.text);
    header.addSpacer();
    addText(header, CARRIER_NAME, Font.boldSystemFont(8), COLORS.accent);
  } else {
    addText(header, CARRIER_NAME, Font.boldSystemFont(11), COLORS.accent);
  }
  if (!data) {
    widget.addSpacer();
    addText(widget, setupRequired ? `Configura ${CARRIER_NAME}` : "No se pudo cargar", Font.boldSystemFont(13), COLORS.text);
    widget.addSpacer(5);
    addText(widget, setupRequired ? "Abre Scriptable para configurar" : "Intenta más tarde", Font.systemFont(11), COLORS.muted);
    widget.addSpacer();
    addStatusNotice(widget, updateFailed, updateAvailable);
    addExecutionTime(widget);
    return widget;
  }

  const style = chartStyle();
  widget.addSpacer();
  const body = widget.addStack();
  body.addSpacer();
  let balanceParent = body;
  if (style === "arc") {
    const arc = body.addStack();
    arc.layoutVertically();
    arc.size = new Size(112, 68);
    arc.backgroundImage = drawProgressArc(data.used_percentage);
    arc.addSpacer(30);
    balanceParent = arc;
  }
  const reading = balanceParent.addStack();
  reading.bottomAlignContent();
  if (style === "arc") {
    reading.size = new Size(112, 38);
    reading.addSpacer();
  }
  const remainingUnit = data.remaining_unit ?? "GB";
  const remainingAmount = data.remaining_data ?? data.remaining_gb;
  const value = remainingUnit === "MB"
    ? remainingAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : formatGB(remainingAmount);
  const valueSize = style === "arc" ? (value.length > 4 ? 30 : 32) : style === "none" ? 40 : 34;
  addText(reading, value, Font.boldSystemFont(valueSize), COLORS.text);
  reading.addSpacer(4);
  const unit = reading.addStack();
  unit.layoutVertically();
  addText(unit, remainingUnit, Font.mediumSystemFont(14), COLORS.muted);
  unit.addSpacer(7);
  if (style === "arc") reading.addSpacer();
  body.addSpacer();
  addText(widget,
    data.data_tier === "throttled" ? `Velocidad reducida · ${formatGB(data.total_data ?? data.total_gb)} ${data.total_unit ?? "GB"}` : `disponibles de ${formatGB(data.total_data ?? data.total_gb)} ${data.total_unit ?? "GB"}`,
    Font.systemFont(10), COLORS.muted).centerAlignText();
  if (style === "bar") {
    widget.addSpacer(4);
    const bar = widget.addStack();
    bar.addSpacer();
    const progress = bar.addImage(drawProgressBar(data.used_percentage));
    progress.imageSize = new Size(BAR_WIDTH, BAR_HEIGHT);
    bar.addSpacer();
  }
  if (style !== "none") {
    widget.addSpacer(3);
    addText(widget, `${Math.round(clampPercentage(data.used_percentage))}% utilizado`, Font.systemFont(9), COLORS.muted).centerAlignText();
  }
  widget.addSpacer();
  if (data.expiration_date !== null) {
    addText(widget, `Vence ${formatExpiration(data.expiration_date)} · en ${data.days_until} días`, Font.systemFont(9), COLORS.muted);
  }
  addStatusNotice(widget, updateFailed, updateAvailable);
  addExecutionTime(widget);
  return widget;
}

async function main() {
  debugLog("Ejecución iniciada.");
  let result;
  if (SETTINGS.useSampleData) {
    debugLog("Modo de ejemplo: sin consultas al operador.");
    result = {
      data: ["error", "setup"].includes(SETTINGS.sampleState) ? null : SAMPLE_DATA,
      updateFailed: SETTINGS.sampleState === "stale" || SETTINGS.sampleState === "error",
      setupRequired: SETTINGS.sampleState === "setup",
      updateAvailable: SETTINGS.sampleState === "update",
    };
  } else {
    const { credentials, cancelled } = await credentialsForRun();
    if (cancelled) {
      debugLog("Ejecución cancelada.");
      Script.complete();
      return;
    }
    if (!credentials) debugLog("Configuración de cuenta pendiente.");
    const [usage, updateAvailable] = await Promise.all([
      credentials ? loadUsage(credentials) : Promise.resolve({ data: null, setupRequired: true }),
      checkForUpdate(),
    ]);
    result = { ...usage, updateAvailable };
  }
  const widget = createWidget(result);
  if (result.data) {
    const image = await loadBackgroundImage();
    if (image) widget.backgroundImage = drawBackground(image);
  }
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentSmall();
  debugLog("Widget mostrado. Ejecución finalizada.");
  Script.complete();
}

await main();
