#!/usr/bin/env node
/**
 * Regenerates the lists of packages in THIRD_PARTY_NOTICES.md, so that the notices stay current:
 *
 *   npm packages     the production dependency tree of package-lock.json (offline, always available)
 *   NuGet packages   the packages with assemblies in apps/api/src/Opten.StudioFlow.Web/obj/project.assets.json, with the
 *                    licence from the .nuspec in the NuGet cache (needs `dotnet restore apps/api/StudioFlow.slnx`)
 *
 * Usage: node tools/third-party-notices.mjs [--check]
 *   npm run notices          writes the file
 *   npm run check:notices    only compares; exit 1 when the file is out of date or a licence is unknown
 *
 * Without the assets file the NuGet list is left as it is and the script says so. Run it after every change of the
 * runtime dependencies in package.json or of the packages in apps/api/Directory.Packages.props.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  npmRuntimePackages,
  nugetPackages,
  readBlock,
  renderBlock,
  replaceBlock,
} from './lib/third-party-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const NOTICES = join(root, 'THIRD_PARTY_NOTICES.md');
const LOCK = join(root, 'package-lock.json');
const ASSETS = join(root, 'apps/api/src/Opten.StudioFlow.Web/obj/project.assets.json');
const check = process.argv.includes('--check');

const read = (path) => readFileSync(path, 'utf8');
const problems = [];
let markdown = read(NOTICES);

// --- npm --------------------------------------------------------------------------------------------------------
const npm = npmRuntimePackages(JSON.parse(read(LOCK)));
markdown = replaceBlock(
  markdown,
  'npm',
  renderBlock('Generated from `package-lock.json` (production dependencies, direct and transitive)', npm),
);
for (const row of npm.filter((entry) => entry.license === 'UNKNOWN')) {
  problems.push(`npm package ${row.name}@${row.version} has no licence in package-lock.json.`);
}

// --- NuGet ------------------------------------------------------------------------------------------------------
let nuget = null;
if (existsSync(ASSETS)) {
  const readNuspec = (folder, libraryPath, name) => {
    const file = join(folder, libraryPath, `${name.toLowerCase()}.nuspec`);
    return existsSync(file) ? read(file) : null;
  };
  nuget = nugetPackages(JSON.parse(read(ASSETS)), readNuspec);
  markdown = replaceBlock(
    markdown,
    'nuget',
    renderBlock('Generated from `apps/api` (`dotnet restore`; packages with assemblies, direct and transitive)', nuget),
  );
  for (const row of nuget.filter((entry) => entry.license === 'UNKNOWN')) {
    problems.push(`NuGet package ${row.name} ${row.version} has no licence in its .nuspec.`);
  }
} else {
  const kept = readBlock(markdown, 'nuget');
  console.warn(
    `third-party-notices: ${ASSETS} is missing, so the NuGet list is not regenerated (run dotnet restore apps/api/StudioFlow.slnx first)${kept ? '; the existing list is kept' : ''}.`,
  );
}

// --- write or compare -------------------------------------------------------------------------------------------
if (check) {
  if (markdown !== read(NOTICES)) {
    problems.push('THIRD_PARTY_NOTICES.md is out of date: run `npm run notices` and commit the result.');
  }
} else {
  writeFileSync(NOTICES, markdown);
}

if (problems.length > 0) {
  console.error(`third-party-notices:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `third-party-notices: ${check ? 'up to date' : 'written'} (${npm.length} npm packages, ${nuget === null ? 'NuGet list unchanged' : `${nuget.length} NuGet packages`}).`,
);
