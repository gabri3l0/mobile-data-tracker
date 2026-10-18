// Scriptable data module shared by widget designs. No UI or saved credentials.

async function loadUsage(settings) {
  settings = {
    requestTimeoutSeconds: 20,
    healthTimeoutSeconds: 5,
    wakeRetryMinutes: 2,
    cacheMinutes: 30,
    retryMinutes: 15,
    ...settings,
  };
  const now = Date.now();
  const cache = readCache(settings);
  if (cache && cache.retryAt > now) {
    return { data: cache.data, updateFailed: true, connectionPending: cache.connectionPending === true, refreshAt: cache.retryAt };
  }
  if (cache && cache.data && now - cache.fetchedAt < settings.cacheMinutes * 60000) {
    return {
      data: cache.data,
      updateFailed: cache.updateFailed,
      connectionPending: cache.connectionPending === true,
      refreshAt: cache.fetchedAt + settings.cacheMinutes * 60000,
    };
  }
  try {
    if (![settings.apiUrl, settings.healthUrl, settings.apiKey, settings.username, settings.password].every(value => typeof value === "string" && value.trim())) {
      throw new Error("Configure the API settings in your local script.");
    }
    await checkServerReady(settings);
    const data = await fetchUsage(settings);
    const fetchedAt = Date.now();
    writeCache(settings, { data, fetchedAt, retryAt: 0, updateFailed: false, connectionPending: false });
    return { data, updateFailed: false, connectionPending: false, refreshAt: fetchedAt + settings.cacheMinutes * 60000 };
  } catch (error) {
    // Do not log request details, credentials, or the server's response body.
    const retryAt = error.retryAt || Date.now() + settings.retryMinutes * 60000;
    const data = cache ? cache.data : null;
    const connectionPending = error.connectionPending === true;
    writeCache(settings, { data, fetchedAt: cache ? cache.fetchedAt : 0, retryAt, updateFailed: true, connectionPending });
    return { data, updateFailed: true, connectionPending, refreshAt: retryAt };
  }
}

async function checkServerReady(settings) {
  try {
    const request = new Request(settings.healthUrl);
    request.method = "GET";
    request.timeoutInterval = settings.healthTimeoutSeconds;
    const body = await request.loadString();
    const status = request.response.statusCode;
    if (status >= 200 && status < 300 && JSON.parse(body).status === "ok") return;
  } catch {
    // One attempt only. Let a future widget execution check again.
  }
  const error = new Error("Server is not ready.");
  error.connectionPending = true;
  error.retryAt = Date.now() + settings.wakeRetryMinutes * 60000;
  throw error;
}

function cacheLocation(settings) {
  const files = FileManager.local();
  // Separate account files. No password or bearer key is stored in the cache.
  const name = `mobile-data-usage-${encodeURIComponent(settings.username)}.json`;
  return { files, path: files.joinPath(files.libraryDirectory(), name) };
}

function readCache(settings) {
  try {
    const { files, path } = cacheLocation(settings);
    if (!files.fileExists(path)) return null;
    const cache = JSON.parse(files.readString(path));
    if (cache.source !== settings.apiUrl || !(cache.data === null || isUsageData(cache.data))
      || !Number.isFinite(cache.fetchedAt) || cache.fetchedAt < 0 || cache.fetchedAt > Date.now()
      || !Number.isFinite(cache.retryAt) || typeof cache.updateFailed !== "boolean") return null;
    return cache;
  } catch {
    return null;
  }
}

function writeCache(settings, cache) {
  try {
    const { files, path } = cacheLocation(settings);
    files.writeString(path, JSON.stringify({ source: settings.apiUrl, ...cache }));
  } catch {
    // A storage failure should not hide a successful API reading.
  }
}

async function fetchUsage(settings) {
  if (![settings.apiUrl, settings.apiKey, settings.username, settings.password].every(value => typeof value === "string" && value.trim())) {
    throw new Error("Configure the API settings in your local script.");
  }
  const request = new Request(settings.apiUrl);
  request.method = "POST";
  request.headers = {
    "Authorization": `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  request.body = JSON.stringify({ username: settings.username, password: settings.password });
  request.timeoutInterval = settings.requestTimeoutSeconds;
  const body = await request.loadString();
  const status = request.response.statusCode;
  if (status === 429) {
    const headers = request.response.headers || {};
    const header = Object.keys(headers).find(key => key.toLowerCase() === "retry-after");
    const value = header ? String(headers[header]).trim() : "";
    const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
    const deadline = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value);
    const error = new Error("Usage limit reached.");
    error.retryAt = Number.isFinite(deadline) && deadline > Date.now()
      ? deadline : Date.now() + settings.retryMinutes * 60000;
    throw error;
  }
  if (status < 200 || status >= 300) {
    throw new Error("Unable to retrieve usage data.");
  }
  const data = JSON.parse(body);
  if (!isUsageData(data)) {
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

module.exports = { loadUsage };
