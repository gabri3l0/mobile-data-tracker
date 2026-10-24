// Variables used by Scriptable.
// icon-color: yellow; icon-glyph: signal;

const RUN_AT = new Date();
const WIDGET_VERSION = "1.0.0";
const WIDGET_CARRIER = "bait";
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
  accentHex: "FFC700", // Chart fill and carrier label.
  chartStyle: "bar", // bar, arc (semicircle), or none.
  showPlanName: true, // false shows only the carrier in the header.
  cacheMinutes: 30,
  retryMinutes: 15,
  requestTimeoutSeconds: 20,
  debug: false, // Safe request, cache, and failure logs in Scriptable.
  useSampleData: false,
  sampleState: "success", // success, stale, error, setup, update, throttled.
};
const CLIENT_AUTH = "NTdiZmIyNjczNWFhNGVjM2ExYmFhZmE4NjQwMDZkN2Q=";
const CARRIER_NAME = "Bait";
const COLORS = {
  get background() { return appearanceHex(SETTINGS.backgroundHex, "101012"); },
  get text() { return appearanceHex(SETTINGS.textPrimaryHex, "FFFFFF"); },
  get muted() { return appearanceHex(SETTINGS.textSecondaryHex, "929298"); },
  get accent() { return appearanceHex(SETTINGS.accentHex, "FFC700"); },
  get warning() {
    const hex = COLORS.background;
    const brightness = (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000;
    return brightness > 140 ? "9A3412" : "FFB454";
  },
};
const BAR_WIDTH = 112;
const BAR_HEIGHT = 7;
const SAMPLE_DATA = {
  plan_name: "Paquete 3 meses Ilimitado", expiration_date: "2026-11-10", days_until: 21,
  last_updated: "2026-10-20T21:38:00.000Z", total_gb: 20495 / 1024,
  used_gb: 6690 / 1024, remaining_gb: 13805 / 1024,
  used_percentage: 32.64, remaining_percentage: 67.36, data_tier: "high_speed",
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

const KEYCHAIN_KEY = "mobile-data-tracker.bait.credentials.v1";
const CACHE_FILE = "mobile-data-tracker-bait-usage-v1.json";

function debugLog(message) {
  if (SETTINGS.debug) console.log(`[Bait] ${message}`);
}

function diagnosticError(code) {
  const error = new Error("No se pudo consultar Bait.");
  error.code = /^(configuration|usage_data|usage_(?:network|json|http_[1-5]\d{2}))$/.test(code) ? code : "unknown";
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
    return value && typeof value.phone === "string" && /^\d{10}$/.test(value.phone) && typeof value.profileId === "string" && value.profileId
      ? value : null;
  } catch {
    debugLog("No se pudo leer la configuración.");
    return null;
  }
}

async function configureCredentials(existing) {
  const alert = new Alert();
  alert.title = "Configurar Bait";
  alert.message = "Tu número se guarda en el Keychain de iOS.";
  alert.addTextField("Número de 10 dígitos", existing ? existing.phone : "");
  alert.addAction("Guardar");
  alert.addCancelAction("Cancelar");
  if (await alert.presentAlert() !== 0) return null;
  const phone = alert.textFieldValue(0).replace(/[\s()-]/g, "");
  if (!/^\d{10}$/.test(phone)) {
    const notice = new Alert();
    notice.title = "Revisa tus datos";
    notice.message = "Ingresa tu número Bait de 10 dígitos.";
    notice.addAction("Aceptar");
    await notice.presentAlert();
    return null;
  }
  const credentials = { phone, profileId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
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
    menu.title = "Mi Bait";
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
    && ["total_gb", "used_gb", "remaining_gb", "days_until"].every(key => typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0)
    && Number.isInteger(data.days_until)
    && ["used_percentage", "remaining_percentage"].every(key => data[key] === null || (typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0))
    && typeof data.last_updated === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.last_updated)
    && Number.isFinite(Date.parse(data.last_updated)) && ["high_speed", "throttled"].includes(data.data_tier)
    && typeof data.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.expiration_date);
}

function readCache(credentials) {
  try {
    const { files, path } = cacheLocation();
    if (!files.fileExists(path)) return null;
    const cache = JSON.parse(files.readString(path));
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

async function fetchUsage(credentials) {
  debugLog("Consultando consumo.");
  const response = await requestJson(`https://mibait.com/api/core/q/dn/${encodeURIComponent(credentials.phone)}/get/consumption`, "usage", {
    headers: { "x-ord-service": Data.fromBase64String(CLIENT_AUTH).toRawString() },
  });
  return parseUsage(response, new Date());
}

function parseUsage(response, fetchedAt = new Date()) {
  if (!fetchedAt || typeof fetchedAt.getTime !== "function" || !Number.isFinite(fetchedAt.getTime())) throw diagnosticError("usage_data");
  if (!response || response.success !== true || !Array.isArray(response.data)) throw diagnosticError("usage_data");
  const tiers = new Map();
  for (const entry of response.data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw diagnosticError("usage_data");
    if (entry.category !== "Data" || !["BestEffort", "Throttling"].includes(entry.type)) continue;
    if (tiers.has(entry.type)) throw diagnosticError("usage_data");
    const resume = entry.resume;
    if (!resume || typeof resume !== "object") throw diagnosticError("usage_data");
    const { total, unused } = resume;
    if (![total, unused].every(value => typeof value === "number" && Number.isFinite(value))
      || unused < 0 || total < unused) throw diagnosticError("usage_data");
    tiers.set(entry.type, entry);
  }
  const highSpeed = tiers.get("BestEffort");
  const throttled = tiers.get("Throttling");
  let selected, tier;
  if (highSpeed && highSpeed.resume.unused > 0) {
    selected = highSpeed; tier = "high_speed";
  } else if (throttled && (throttled.resume.unused > 0 || !highSpeed)) {
    selected = throttled; tier = "throttled";
  } else if (highSpeed) {
    selected = highSpeed; tier = "high_speed";
  } else {
    throw diagnosticError("usage_data");
  }
  const expiration = selected.resume.expire_date;
  const parts = typeof expiration === "string"
    ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(expiration) : null;
  const expiresAt = parts ? new Date(expiration) : null;
  const calendar = parts ? new Date(`${parts[1]}T00:00:00Z`) : null;
  if (!parts || Number(parts[1].slice(0, 4)) < 1 || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59
    || !Number.isFinite(expiresAt.getTime()) || !Number.isFinite(calendar.getTime())
    || calendar.toISOString().slice(0, 10) !== parts[1]) throw diagnosticError("usage_data");
  const expirationDate = expiresAt.toISOString().slice(0, 10);
  if (!Array.isArray(selected.offers_detail) || !selected.offers_detail.length) throw diagnosticError("usage_data");
  const names = [];
  for (const offer of selected.offers_detail) {
    if (!offer || typeof offer.offer_name !== "string" || !offer.offer_name.trim()) throw diagnosticError("usage_data");
    if (!names.includes(offer.offer_name.trim())) names.push(offer.offer_name.trim());
  }
  const { total, unused } = selected.resume;
  const used = total - unused;
  const today = Date.parse(`${fetchedAt.toISOString().slice(0, 10)}T00:00:00Z`);
  const data = {
    plan_name: names.join(", "), expiration_date: expirationDate,
    days_until: Math.max(0, Math.round((Date.parse(`${expirationDate}T00:00:00Z`) - today) / 86400000)),
    last_updated: fetchedAt.toISOString(),
    total_gb: total / 1024, used_gb: used / 1024, remaining_gb: unused / 1024,
    used_percentage: total ? Math.round(used / total * 10000) / 100 : null,
    remaining_percentage: total ? Math.round(unused / total * 10000) / 100 : null,
    data_tier: tier,
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
    imagePath = files.joinPath(files.libraryDirectory(), "mobile-data-bait-background.png");
    metadataPath = files.joinPath(files.libraryDirectory(), "mobile-data-bait-background.json");
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
      data: ["error", "setup"].includes(SETTINGS.sampleState) ? null
        : SETTINGS.sampleState === "throttled" ? {
          ...SAMPLE_DATA, total_gb: 105, used_gb: 0, remaining_gb: 105,
          used_percentage: 0, remaining_percentage: 100, data_tier: "throttled",
        } : SAMPLE_DATA,
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
