// Consistency of the release files. Run by CI (job lint-typecheck) and locally: node infra/release/check.mjs
//
//  1. One version everywhere: .release-please-manifest.json, package.json, package-lock.json, Directory.Build.props and
//     the default image tags of docker-compose.release.yml (release-please changes all of them in the release pull
//     request, docs/releasing.md).
//  2. docker-compose.release.yml is the twin of docker-compose.yml: the same services with the same settings, except
//     that the images we build are pulled instead of built and the netem test service is missing.
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
  backup: 'studioflow-backup',
};

// --- 1. versions ----------------------------------------------------------------------------------------------

const config = readJson('release-please-config.json');
const lock = readJson('package-lock.json');
const props = /<Version>([^<]+)<\/Version>[^\n]*x-release-please-version/.exec(
  read('apps/api/Directory.Build.props'),
);
const composeTags = [
  ...read('docker-compose.release.yml').matchAll(
    /\$\{STUDIOFLOW_IMAGE_TAG:-([^}]*)\}[^\n]*x-release-please-version/g,
  ),
].map((match) => match[1]);

const versions = {
  '.release-please-manifest.json': readJson('.release-please-manifest.json')['.'],
  'package.json': readJson('package.json').version,
  'package-lock.json (version)': lock.version,
  'package-lock.json (packages[""])': lock.packages?.['']?.version,
  'apps/api/Directory.Build.props': props?.[1],
};
composeTags.forEach(
  (tag, index) => (versions[`docker-compose.release.yml (image ${index + 1})`] = tag),
);

if (composeTags.length !== Object.keys(IMAGES).length) {
  problems.push(
    `docker-compose.release.yml must have ${Object.keys(IMAGES).length} image lines marked x-release-please-version (${Object.values(IMAGES).join(', ')}), found ${composeTags.length}.`,
  );
}
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
for (const file of ['apps/api/Directory.Build.props', 'docker-compose.release.yml']) {
  if (!extraFiles.includes(file))
    problems.push(`release-please-config.json: ${file} is missing in extra-files.`);
}

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
    const expected = `\${STUDIOFLOW_IMAGE_REGISTRY:-ghcr.io/opten}/${image}:\${STUDIOFLOW_IMAGE_TAG:-${versions['package.json']}}`;
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
