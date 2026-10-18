// Configure your local copy only. Never share it with real credentials.
const RUN_AT = new Date();
// Public background image; change this URL in your local copy.
const BACKGROUND_IMAGE_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdZaVghFotA_TTTq7zfOxO5AipAmIdJpEJaQ0j4WnVb0BQfW67EaoZPcXC&s=10";
const BACKGROUND_OVERLAY_OPACITY = 0.65;
const BACKGROUND_CACHE_HOURS = 24;
const BACKGROUND_TIMEOUT_SECONDS = 5;
const SETTINGS = {
  apiUrl: "",       // Complete usage endpoint.
  healthUrl: "",    // Complete health endpoint on the same server.
  apiKey: "",      // No Bearer prefix.
  username: "",
  password: "",
  cacheMinutes: 30,
  debug: true,     // Safe diagnostics in the Scriptable console.
};

// Sample mode skips the usage API. The background URL may still be loaded.
const USE_SAMPLE_DATA = false;
// Sample mode: "success", "stale", "error", "connecting", "connecting-empty".
const PREVIEW_STATE = "success";
const COLORS = {
  background: "101012",
  text: "FFFFFF",
  muted: "FFFFFF",
  accent: "FF453A",
  track: "2C2C30",
};
const BAR_WIDTH = 112;
const BAR_HEIGHT = 7;

const SAMPLE_DATA = {
  plan_name: "Plan 7 GB",
  expiration_date: "2026-10-24",
  days_until: 5,
  last_updated: "2026-10-18T01:30:00",
  total_gb: 7.0,
  used_gb: 5.4,
  remaining_gb: 1.6,
  used_percentage: 77.14,
  remaining_percentage: 22.86,
};

// Background caching is independent of usage data and rate limits.
async function loadBackgroundImage() {
  if (!BACKGROUND_IMAGE_URL.trim()) return null;
  let files, imagePath, metadataPath, cached = null;
  try {
    files = FileManager.local();
    imagePath = files.joinPath(files.libraryDirectory(), "mobile-data-image-background.png");
    metadataPath = files.joinPath(files.libraryDirectory(), "mobile-data-image-background.json");
    if (files.fileExists(metadataPath) && files.fileExists(imagePath)) {
      const metadata = JSON.parse(files.readString(metadataPath));
      if (metadata.url === BACKGROUND_IMAGE_URL) {
        cached = files.readImage(imagePath);
        const age = Date.now() - metadata.savedAt;
        if (cached && Number.isFinite(age) && age >= 0 && age < BACKGROUND_CACHE_HOURS * 3600000) return cached;
      }
    }
  } catch {
    // Missing or corrupt image cache: try the URL once.
  }
  try {
    const request = new Request(BACKGROUND_IMAGE_URL);
    request.timeoutInterval = BACKGROUND_TIMEOUT_SECONDS;
    const image = await request.loadImage();
    const status = request.response.statusCode;
    if (status < 200 || status >= 300 || !image || image.size.width <= 0 || image.size.height <= 0) throw new Error("Image unavailable.");
    // Store a small square image to limit widget memory on later runs.
    const cropped = drawBackground(image, 0);
    try {
      if (files) {
        files.writeImage(imagePath, cropped);
        files.writeString(metadataPath, JSON.stringify({ url: BACKGROUND_IMAGE_URL, savedAt: Date.now() }));
      }
    } catch {
      // Still display the downloaded image if writing the cache fails.
    }
    return cropped;
  } catch {
    return cached;
  }
}

function drawBackground(image, opacity = BACKGROUND_OVERLAY_OPACITY) {
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

function formatReading(value) {
  // Preserve the carrier's wall-clock reading: its timestamp has no timezone.
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year.slice(-2)} ${time.slice(0, 5)}`;
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

function addExecutionTime(widget) {
  widget.addSpacer(3);
  addText(widget, `Ejecutado · ${formatRunTime(RUN_AT)}`, Font.systemFont(7), COLORS.muted);
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
    context.setFillColor(new Color(color));
    context.addPath(path);
    context.fillPath();
  }

  roundedFill(BAR_WIDTH, COLORS.track);
  // DrawContext has no native gradient fill; use the red accent directly.
  roundedFill(BAR_WIDTH * clampPercentage(percentage) / 100, COLORS.accent);
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

function createWidget({ data, updateFailed, connectionPending = false, refreshAt }) {
  const widget = new ListWidget();
  // iOS decides the actual refresh time; this is only the earliest requested time.
  if (refreshAt) widget.refreshAfterDate = new Date(refreshAt);
  widget.backgroundColor = new Color(COLORS.background);
  widget.setPadding(12, 12, 12, 12);
  // iOS applies the outer widget corner shape.
  const header = widget.addStack();
  header.centerAlignContent();
  const title = header.addStack();
  title.size = new Size(96, 14);
  addText(title, data && data.plan_name ? data.plan_name : "Consumo", Font.boldSystemFont(11), COLORS.text);
  header.addSpacer();
  addText(header, "Telcel", Font.boldSystemFont(8), COLORS.text);

  if (!data) {
    widget.addSpacer();
    addText(widget, connectionPending ? "Iniciando conexión" : "No se pudo cargar", Font.boldSystemFont(13), COLORS.text);
    widget.addSpacer(5);
    addText(widget, connectionPending ? "Reintenta en 2 min" : "Intenta más tarde", Font.systemFont(11), COLORS.muted);
    widget.addSpacer();
    addExecutionTime(widget);
    return widget;
  }

  widget.addSpacer(3);
  const reading = widget.addStack();
  reading.bottomAlignContent();
  addText(reading, formatGB(data.remaining_gb), Font.boldSystemFont(connectionPending ? 32 : 34), COLORS.text);
  reading.addSpacer(4);
  const unit = reading.addStack();
  unit.layoutVertically();
  addText(unit, "GB", Font.mediumSystemFont(14), COLORS.muted);
  unit.addSpacer(7);
  addText(widget, `disponibles de ${formatGB(data.total_gb)} GB`, Font.systemFont(10), COLORS.muted);

  widget.addSpacer(3);
  const progress = widget.addImage(drawProgressBar(data.used_percentage));
  progress.imageSize = new Size(BAR_WIDTH, BAR_HEIGHT);
  progress.leftAlignImage();
  widget.addSpacer(3);
  addText(widget, `${Math.round(clampPercentage(data.used_percentage))}% utilizado`, Font.systemFont(9), COLORS.muted);
  widget.addSpacer();
  if (data.expiration_date !== null) {
    addText(widget, `Vence ${formatExpiration(data.expiration_date)} · en ${data.days_until} días`, Font.systemFont(9), COLORS.muted);
    widget.addSpacer(3);
  }
  addText(widget, `Actualizado · ${formatReading(data.last_updated)}`, Font.systemFont(8), COLORS.muted);
  if (updateFailed) {
    widget.addSpacer(3);
    addText(widget, connectionPending ? "Iniciando conexión" : "No se pudo actualizar", Font.systemFont(8), COLORS.accent);
    if (connectionPending) {
      addText(widget, "Reintenta en 2 min", Font.systemFont(8), COLORS.accent);
    }
  }
  addExecutionTime(widget);
  return widget;
}

// Install usage-data.js alongside this script in Scriptable for live data.
const result = USE_SAMPLE_DATA
  ? {
    data: ["error", "connecting-empty"].includes(PREVIEW_STATE) ? null : SAMPLE_DATA,
    updateFailed: PREVIEW_STATE !== "success",
    connectionPending: PREVIEW_STATE.startsWith("connecting"),
  }
  : await importModule("usage-data").loadUsage(SETTINGS);
const backgroundImage = await loadBackgroundImage();
const widget = createWidget(result);
if (backgroundImage) widget.backgroundImage = drawBackground(backgroundImage);
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentSmall();
Script.complete();
