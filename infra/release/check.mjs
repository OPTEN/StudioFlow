// Consistency of the release files. Run by CI (job lint-typecheck) and locally: node infra/release/check.mjs
//
//  1. One version everywhere: .release-please-manifest.json, package.json, package-lock.json and Directory.Build.props
//     (release-please changes all of them in the release pull request, docs/releasing.md). docker-compose.release.yml
//     holds no version: its image tag defaults to "latest", so it is the same file for every release.
//  2. docker-compose.release.yml is the twin of docker-compose.yml: the same services with the same settings, except
//     that the images we build are pulled instead of built and the netem test service is missing.
//  3. The edge cannot reach the data: the admin API of Caddy (it reads the DNS credentials and replaces the whole
//     configuration, without authentication) is no TCP listener and its socket volume is shared by Caddy and the API
//     only; LiveKit (media traffic from the internet) is not on the network of PostgreSQL and the backup service.
//
// Plain Node, no dependencies; the compose files are read with `docker compose config`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const readJson = (path) => JSON.parse(read(path));
const problems = [];

// Built from source in docker-compose.yml, pulled in docker-compose.release.yml: service -> published image name.
const IMAGES = {
  caddy: 'studioflow-web',
  api: 'studioflow-api',
  livekit: 'studioflow-livekit',
  backup: 'studioflow-backup',
};

// --- 1. versions ----------------------------------------------------------------------------------------------

const config = readJson('release-please-config.json');
const lock = readJson('package-lock.json');
const props = /<Version>([^<]+)<\/Version>[^\n]*x-release-please-version/.exec(
  read('apps/api/Directory.Build.props'),
);
const versions = {
  '.release-please-manifest.json': readJson('.release-please-manifest.json')['.'],
  'package.json': readJson('package.json').version,
  'package-lock.json (version)': lock.version,
  'package-lock.json (packages[""])': lock.packages?.['']?.version,
  'apps/api/Directory.Build.props': props?.[1],
};
for (const [file, version] of Object.entries(versions)) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(version))) {
    problems.push(`${file}: "${version}" is not a version (X.Y.Z).`);
  }
}
if (new Set(Object.values(versions)).size > 1) {
  problems.push(
    `The version differs between the files:\n${Object.entries(versions)
      .map(([file, version]) => `    ${String(version).padEnd(8)} ${file}`)
      .join('\n')}`,
  );
}
const extraFiles = config.packages?.['.']?.['extra-files'] ?? [];
if (!extraFiles.includes('apps/api/Directory.Build.props'))
  problems.push(
    'release-please-config.json: apps/api/Directory.Build.props is missing in extra-files.',
  );
if (extraFiles.includes('docker-compose.release.yml'))
  problems.push(
    'release-please-config.json: docker-compose.release.yml must not be in extra-files, it has no version (the image tag defaults to latest).',
  );
if (/x-release-please-version/.test(read('docker-compose.release.yml')))
  problems.push('docker-compose.release.yml must not carry x-release-please-version markers.');

// --- 2. compose twins -----------------------------------------------------------------------------------------

const compose = (file) =>
  JSON.parse(
    execFileSync(
      'docker',
      ['compose', '-f', file, 'config', '--no-interpolate', '--format', 'json'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );

// Only in docker-compose.yml: a test service without a published image.
const SOURCE_ONLY = ['netem'];

function differences(left, right, path = '') {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (plain(left) && plain(right)) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => {
      const next = path ? `${path}.${key}` : key;
      if (!(key in left)) return [`${next}: only in docker-compose.release.yml`];
      if (!(key in right)) return [`${next}: only in docker-compose.yml`];
      return differences(left[key], right[key], next);
    });
  }
  return [
    `${path}: ${JSON.stringify(left)} (docker-compose.yml) vs ${JSON.stringify(right)} (docker-compose.release.yml)`,
  ];
}

try {
  const source = compose('docker-compose.yml');
  const release = compose('docker-compose.release.yml');

  for (const [name, service] of Object.entries(release.services)) {
    if (service.build) problems.push(`docker-compose.release.yml: service ${name} must not build.`);
  }
  for (const [name, image] of Object.entries(IMAGES)) {
    const expected = `\${STUDIOFLOW_IMAGE_REGISTRY:-ghcr.io/opten}/${image}:\${STUDIOFLOW_IMAGE_TAG:-latest}`;
    const actual = release.services[name]?.image;
    if (actual !== expected)
      problems.push(
        `docker-compose.release.yml: service ${name} must use image ${expected}, found ${actual}.`,
      );
  }

  // Everything but the image/build lines and the source-only services must be identical.
  const expectedBuilt = Object.keys(IMAGES).sort();
  const built = Object.entries(source.services)
    .filter(([name, service]) => service.build && !SOURCE_ONLY.includes(name))
    .map(([name]) => name)
    .sort();
  if (JSON.stringify(built) !== JSON.stringify(expectedBuilt)) {
    problems.push(
      `docker-compose.yml builds [${built}] but the release images are [${expectedBuilt}]: add the new image to IMAGES in infra/release/check.mjs and to docker-compose.release.yml.`,
    );
  }
  const comparable = (file) => ({
    ...file,
    services: Object.fromEntries(
      Object.entries(file.services)
        .filter(([name]) => !SOURCE_ONLY.includes(name))
        .map(([name, { build, image, ...rest }]) => [
          name,
          name in IMAGES ? rest : { ...rest, image },
        ]),
    ),
  });
  problems.push(...differences(comparable(source), comparable(release)));

  // --- 3. network segmentation and the admin API of Caddy ---------------------------------------------------------
  for (const [file, config] of [
    ['docker-compose.yml', source],
    ['docker-compose.release.yml', release],
  ]) {
    const networks = (name) =>
      Object.keys(config.services[name]?.networks ?? {})
        .sort()
        .join(',');
    const mounts = (volume) =>
      Object.entries(config.services)
        .filter(([, service]) => (service.volumes ?? []).some((entry) => entry.source === volume))
        .map(([name]) => name)
        .sort()
        .join(',');
    const expectedNetworks = {
      caddy: 'studioflow',
      livekit: 'studioflow',
      api: 'backend,studioflow',
      postgres: 'backend',
      backup: 'backend',
    };
    for (const [name, expected] of Object.entries(expectedNetworks)) {
      if (networks(name) !== expected)
        problems.push(
          `${file}: ${name} is on the networks [${networks(name)}], expected [${expected}] (LiveKit must not reach PostgreSQL or the backup service).`,
        );
    }
    if (mounts('caddy_admin') !== 'api,caddy,init')
      problems.push(
        `${file}: the admin socket volume caddy_admin is mounted by [${mounts('caddy_admin')}], expected [api,caddy,init].`,
      );
    if (config.services.api?.environment?.INSTALL__CADDYADMINURL)
      problems.push(
        `${file}: the API must reach the admin API of Caddy through the unix socket (INSTALL__CADDYADMINSOCKET), not over TCP.`,
      );
    for (const [name, service] of Object.entries(config.services)) {
      if ((service.ports ?? []).some((port) => Number(port.target) === 2019))
        problems.push(`${file}: ${name} publishes port 2019 (the admin API of Caddy).`);
    }
  }
  for (const file of [
    'Caddyfile',
    'global.caddy',
    'servers.caddy',
    'studioflow.caddy',
    'health.caddy',
  ]) {
    const text = read(`infra/caddy/${file}`).replace(/^\s*#.*$/gm, '');
    const admin = /^\s*admin\s+(\S+)/m.exec(text);
    if (admin && !admin[1].startsWith('unix//'))
      problems.push(
        `infra/caddy/${file}: the admin API must listen on a unix socket, found "admin ${admin[1]}" (a TCP listener is reachable from every container of the network).`,
      );
  }
  if (!/^admin unix\/\/\S+\|0660\s*$/m.test(read('infra/caddy/global.caddy')))
    problems.push(
      'infra/caddy/global.caddy: expected "admin unix//<socket>|0660" (readable only by Caddy and the API).',
    );
} catch (error) {
  problems.push(
    `docker compose config failed: ${error.stderr?.toString().trim() || error.message}`,
  );
}

if (problems.length) {
  console.error(`Release files are not consistent:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Release files are consistent (version ${versions['package.json']}, compose twins match).`,
);
