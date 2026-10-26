// The generated parts of THIRD_PARTY_NOTICES.md: the npm packages that run in (or ship with) the product and the NuGet
// packages of the API, each with its licence. Pure functions; tools/third-party-notices.mjs reads the files and writes.

/** Marker lines around a generated block of the Markdown file. */
export const beginMarker = (name) => `<!-- BEGIN generated:${name} -->`;
export const endMarker = (name) => `<!-- END generated:${name} -->`;

/** The licence of a package.json / lock entry as one SPDX-style string ("MIT", "(Apache-2.0 AND BSD-3-Clause)"). */
export function licenseText(license) {
  if (typeof license === 'string' && license.trim() !== '') return license.trim();
  if (Array.isArray(license) && license.length > 0) {
    const parts = license.map(licenseText).filter((part) => part !== 'UNKNOWN');
    return parts.length > 0 ? `(${parts.join(' OR ')})` : 'UNKNOWN';
  }
  if (license && typeof license === 'object' && typeof license.type === 'string') {
    return licenseText(license.type);
  }
  return 'UNKNOWN';
}

/** "@livekit/protocol" from "node_modules/a/node_modules/@livekit/protocol". */
export function packageNameOf(lockPath) {
  const marker = 'node_modules/';
  return lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
}

/**
 * The npm packages of the production dependency tree of a package-lock.json (lockfile version 2 or 3): everything the
 * root `dependencies` pull in, transitively. Entries flagged `dev` belong to the build tools and are left out. A
 * package that appears in several versions is listed once per version. Sorted by name, then version.
 */
export function npmRuntimePackages(lock) {
  const seen = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '' || entry.dev === true || entry.link === true) continue;
    const name = entry.name ?? packageNameOf(path);
    const row = { name, version: entry.version ?? 'unknown', license: licenseText(entry.license) };
    seen.set(`${row.name}@${row.version}`, row);
  }
  return [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  );
}

/** The licence of a NuGet package from the text of its .nuspec file. */
export function nuspecLicense(xml) {
  const expression = /<license\s+type="expression"[^>]*>\s*([^<\s][^<]*?)\s*<\/license>/i.exec(xml);
  if (expression) return expression[1];
  const file = /<license\s+type="file"[^>]*>\s*([^<\s][^<]*?)\s*<\/license>/i.exec(xml);
  if (file) return `see ${file[1]} in the package`;
  const url = /<licenseUrl>\s*([^<\s][^<]*?)\s*<\/licenseUrl>/i.exec(xml);
  if (url && !/aka\.ms\/deprecateLicenseUrl/i.test(url[1])) return url[1];
  return 'UNKNOWN';
}

/**
 * The NuGet packages that ship with a project, from its obj/project.assets.json: packages that bring assemblies
 * (compile or runtime assets). Analyzers, MSBuild tasks and other build-only packages are not distributed and are left
 * out. `readNuspec(folder, path, name)` returns the text of the .nuspec file of a package (`path` is the folder of the
 * library below the package folder, as the assets file names it) or null when the folder does not have it.
 */
export function nugetPackages(assets, readNuspec) {
  const folders = Object.keys(assets.packageFolders ?? {});
  const rows = [];
  for (const target of Object.values(assets.targets ?? {})) {
    for (const [library, entry] of Object.entries(target)) {
      if (entry.type !== 'package' || !(entry.compile || entry.runtime)) continue;
      const slash = library.lastIndexOf('/');
      const name = library.slice(0, slash);
      const version = library.slice(slash + 1);
      let license = 'UNKNOWN';
      for (const folder of folders) {
        const xml = readNuspec(folder, assets.libraries?.[library]?.path ?? '', name);
        if (xml !== null) {
          license = nuspecLicense(xml);
          break;
        }
      }
      rows.push({ name, version, license });
    }
  }
  const unique = new Map(rows.map((row) => [`${row.name}@${row.version}`, row]));
  return [...unique.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  );
}

/** A Markdown table: Package, Version, Licence. */
export function renderTable(rows) {
  const cell = (text) => String(text).replaceAll('|', '\\|');
  return [
    '| Package | Version | Licence |',
    '|---|---|---|',
    ...rows.map((row) => `| ${cell(row.name)} | ${cell(row.version)} | ${cell(row.license)} |`),
  ].join('\n');
}

/** How many packages carry which licence: "MIT 33, Apache-2.0 4". */
export function licenseSummary(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.license, (counts.get(row.license) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .map(([license, count]) => `${license} ${count}`)
    .join(', ');
}

/** Replaces what stands between the markers of `name`; throws when the markers are missing or out of order. */
export function replaceBlock(markdown, name, body) {
  const begin = markdown.indexOf(beginMarker(name));
  const end = markdown.indexOf(endMarker(name));
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`THIRD_PARTY_NOTICES.md needs the lines ${beginMarker(name)} and ${endMarker(name)}.`);
  }
  const head = markdown.slice(0, begin + beginMarker(name).length);
  return `${head}\n\n${body.trim()}\n\n${markdown.slice(end)}`;
}

/** The text between the markers of `name`, or null. */
export function readBlock(markdown, name) {
  const begin = markdown.indexOf(beginMarker(name));
  const end = markdown.indexOf(endMarker(name));
  if (begin < 0 || end < begin) return null;
  return markdown.slice(begin + beginMarker(name).length, end).trim();
}

/** The block for one list: a line saying where it comes from, the licence summary, the table. */
export function renderBlock(title, rows) {
  return `${title}: ${rows.length} packages (${licenseSummary(rows)}).\n\n${renderTable(rows)}`;
}
