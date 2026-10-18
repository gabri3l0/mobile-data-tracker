// Configure your local copy only. Never share it with real credentials.
// API_URL is the complete usage endpoint, including its path.
const API_URL = "";
const API_KEY = "";
const USERNAME = "";
const PASSWORD = "";
const REQUEST_TIMEOUT_SECONDS = 20;

// Set true for an offline preview; no API request is made in sample mode.
const USE_SAMPLE_DATA = false;
// Sample mode only: "success", "stale", or "error".
const PREVIEW_STATE = "success";
const TITLE = "Mi consumo";
const COLORS = {
  background: "101012",
  text: "FFFFFF",
  muted: "929298",
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

async function loadUsage() {
  if (USE_SAMPLE_DATA) {
    return {
      data: PREVIEW_STATE === "error" ? null : SAMPLE_DATA,
      updateFailed: PREVIEW_STATE !== "success",
    };
  }
  try {
    return { data: await fetchUsage(), updateFailed: false };
  } catch {
    // Do not log request details, credentials, or the server's response body.
    return { data: null, updateFailed: true };
  }
}

async function fetchUsage() {
  if (![API_URL, API_KEY, USERNAME, PASSWORD].every(value => value.trim())) {
    throw new Error("Configure the API settings in your local script.");
  }
  const request = new Request(API_URL);
  request.method = "POST";
  request.headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  request.body = JSON.stringify({ username: USERNAME, password: PASSWORD });
  request.timeoutInterval = REQUEST_TIMEOUT_SECONDS;
  const data = await request.loadJSON();
  const status = request.response.statusCode;
  if (status < 200 || status >= 300 || !isUsageData(data)) {
    throw new Error("Unable to retrieve usage data.");
  }
  return data;
}

function isUsageData(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    && ["remaining_gb", "total_gb", "used_percentage", "days_until"].every(
      key => typeof data[key] === "number" && Number.isFinite(data[key])
    )
    && typeof data.last_updated === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.last_updated)
    && (data.expiration_date === null || (
      typeof data.expiration_date === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(data.expiration_date)
    ));
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

function createWidget({ data, updateFailed }) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(COLORS.background);
  widget.setPadding(12, 12, 12, 12);
  // iOS applies the outer widget corner shape.
  const header = widget.addStack();
  header.centerAlignContent();
  addText(header, TITLE, Font.boldSystemFont(12), COLORS.text);
  header.addSpacer();
  addText(header, "DATOS", Font.boldSystemFont(8), COLORS.accent);

  if (!data) {
    widget.addSpacer();
    addText(widget, "No se pudo cargar", Font.boldSystemFont(13), COLORS.text);
    widget.addSpacer(5);
    addText(widget, "Intenta más tarde", Font.systemFont(11), COLORS.muted);
    widget.addSpacer();
    return widget;
  }

  widget.addSpacer(7);
  const reading = widget.addStack();
  reading.bottomAlignContent();
  addText(reading, formatGB(data.remaining_gb), Font.boldSystemFont(36), COLORS.text);
  reading.addSpacer(4);
  const unit = reading.addStack();
  unit.layoutVertically();
  addText(unit, "GB", Font.mediumSystemFont(14), COLORS.muted);
  unit.addSpacer(7);
  addText(widget, `disponibles de ${formatGB(data.total_gb)} GB`, Font.systemFont(10), COLORS.muted);

  widget.addSpacer(7);
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
  addText(widget, `Lectura · ${formatReading(data.last_updated)}`, Font.systemFont(8), COLORS.muted);
  if (updateFailed) {
    widget.addSpacer(3);
    addText(widget, "No se pudo actualizar", Font.systemFont(8), COLORS.accent);
  }
  return widget;
}

const widget = createWidget(await loadUsage());
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentSmall();
Script.complete();
