const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { ROOT, MANIFEST, SCRIPTS, compareVersions, versionParts, readRelease, nextPatch, prepare, scriptVersion } = require('./release.cjs');

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function productionChanged(files) {
  return files.some(name => name.startsWith('widgets/') && !name.startsWith('widgets/tests/')
    && /\.(js|html|css|json)$/.test(name) && name !== MANIFEST);
}

function latestStable(releases) {
  return releases.filter(release => {
    if (release.draft || release.prerelease || !/^v/.test(release.tag_name)) return false;
    try { versionParts(release.tag_name.slice(1)); return true; } catch { return false; }
  }).sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
}

function decideVersion(current, releases, changed) {
  const latest = latestStable(releases);
  if (!latest) throw new Error('Publish the initial stable release before enabling automation.');
  const previous = latest.tag_name.slice(1);
  const comparison = compareVersions(current, previous);
  if (comparison < 0) throw new Error('The checkout version is older than the latest stable release.');
  const version = comparison > 0 ? current : changed ? nextPatch(current) : current;
  return { version, previousTag: latest.tag_name, publish: compareVersions(version, previous) > 0 };
}

async function github(endpoint, options = {}) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.');
  const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
    method: options.method || 'GET', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(options.data ? { body: JSON.stringify(options.data) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${endpoint}.`);
  return response.json();
}

async function listReleases(api = github) {
  const result = [];
  for (let page = 1; ; page++) {
    const releases = await api(`releases?per_page=100&page=${page}`);
    result.push(...releases);
    if (releases.length < 100) return result;
  }
}

function output(values) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(JSON.stringify(values));
}

async function prepareAutomatic({ root = ROOT, api = github, runGit = git, emit = output } = {}) {
  const current = readRelease(root).version;
  const releases = await listReleases(api);
  const latest = latestStable(releases);
  if (!latest) throw new Error('An initial stable release is required.');
  const sha = runGit('rev-parse', 'HEAD');
  // A queued or manually rerun workflow must not overwrite newer main commits.
  runGit('fetch', 'origin', 'main');
  if (runGit('rev-parse', 'origin/main') !== sha) throw new Error('Main advanced. Run this workflow again on the latest main commit.');
  const previousCommit = runGit('rev-parse', `refs/tags/${latest.tag_name}^{commit}`);
  if (runGit('merge-base', previousCommit, sha) !== previousCommit) throw new Error('Previous release is outside this commit history.');
  const files = runGit('diff', '--name-only', `${latest.tag_name}..${sha}`, '--', 'widgets').split('\n');
  const decision = decideVersion(current, releases, productionChanged(files));
  if (decision.version !== current) {
    prepare(decision.version, root);
    runGit('config', 'user.name', 'github-actions[bot]');
    runGit('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    runGit('add', '--', MANIFEST, ...SCRIPTS);
    runGit('commit', '-m', `chore: release widgets v${decision.version}`);
    runGit('push', 'origin', 'HEAD:main');
  }
  emit({ sha: runGit('rev-parse', 'HEAD'), version: decision.version, publish: decision.publish });
}

async function verifyLive(baseURL, version, { request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 6 } = {}) {
  const base = new URL(baseURL);
  if (base.protocol !== 'https:') throw new Error('The Pages URL must use HTTPS.');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      for (const filename of [MANIFEST, ...SCRIPTS]) {
        const url = new URL(filename, `${base.href.replace(/\/$/, '')}/`);
        url.searchParams.set('version', version);
        const response = await request(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
        const source = await response.text();
        const actual = filename === MANIFEST ? JSON.parse(source).version : scriptVersion(source, filename);
        if (actual !== version) throw new Error(`${filename} is not yet at version ${version}.`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(10000);
    }
  }
  throw new Error(`Pages verification failed: ${lastError.message}`);
}

async function publishRelease({ version, sha, baseURL, api = github, runGit = git, verify = verifyLive }) {
  const releases = await listReleases(api);
  const tag = `v${version}`;
  const existing = releases.find(release => release.tag_name === tag);
  const tagged = runGit('tag', '--list', tag);
  if (existing) {
    if (existing.draft || existing.prerelease || !tagged) throw new Error(`${tag} conflicts with an incomplete release.`);
    const commit = runGit('rev-parse', `refs/tags/${tag}^{commit}`);
    if (runGit('merge-base', commit, sha) !== commit) throw new Error(`${tag} points outside this commit's history.`);
    await verify(baseURL, version);
    console.log(`${tag} already published; deployment verified, release left unchanged.`);
    return;
  }
  const latest = latestStable(releases);
  if (!latest || compareVersions(version, latest.tag_name.slice(1)) <= 0) throw new Error('The release must be newer than the latest stable release.');
  if (tagged && runGit('rev-parse', `refs/tags/${tag}^{commit}`) !== sha) throw new Error(`${tag} already points to a different commit.`);
  const previousCommit = runGit('rev-parse', `refs/tags/${latest.tag_name}^{commit}`);
  if (runGit('merge-base', previousCommit, sha) !== previousCommit) throw new Error('Previous release is outside this commit history.');
  await verify(baseURL, version);
  const notes = await api('releases/generate-notes', { method: 'POST', data: {
    tag_name: tag, target_commitish: sha, previous_tag_name: latest.tag_name,
  } });
  const changes = notes.body.replace(/^## What's Changed$/m, '## Cambios')
    .replace(/^## New Contributors$/m, '## Nuevos colaboradores');
  const body = `## Cómo actualizar\n\nAbre el [generador de widgets](${baseURL.replace(/\/$/, '')}/widgets/previews/), genera y copia el código y reemplaza todo el contenido de tu script existente en Scriptable. Tu cuenta guardada se conserva.\n\n${changes}`;
  const release = await api('releases', { method: 'POST', data: {
    tag_name: tag, target_commitish: sha, name: `${tag} — Widgets de Telcel y Bait`,
    body, draft: false, prerelease: false, make_latest: 'true',
  } });
  console.log(release.html_url);
}

if (require.main === module) {
  (async () => {
    const [command, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Unexpected arguments.');
    if (command === 'prepare') await prepareAutomatic();
    else if (command === 'publish') await publishRelease({
      version: readRelease().version, sha: git('rev-parse', 'HEAD'), baseURL: process.env.PAGES_URL,
    });
    else throw new Error('Usage: node scripts/release-automation.cjs prepare | publish');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { productionChanged, latestStable, decideVersion, listReleases, prepareAutomatic, verifyLive, publishRelease };
