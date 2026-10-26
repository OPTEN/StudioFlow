import {
  licenseSummary,
  licenseText,
  npmRuntimePackages,
  nugetPackages,
  nuspecLicense,
  packageNameOf,
  readBlock,
  renderBlock,
  renderTable,
  replaceBlock,
} from './third-party-notices.mjs';

describe('licenseText', () => {
  it('reads a plain SPDX expression', () => {
    expect(licenseText('MIT')).toBe('MIT');
    expect(licenseText(' (Apache-2.0 AND BSD-3-Clause) ')).toBe('(Apache-2.0 AND BSD-3-Clause)');
  });

  it('reads the legacy object and array forms', () => {
    expect(licenseText({ type: 'ISC', url: 'https://example.com' })).toBe('ISC');
    expect(licenseText([{ type: 'MIT' }, 'Apache-2.0'])).toBe('(MIT OR Apache-2.0)');
  });

  it('says UNKNOWN when there is nothing usable', () => {
    for (const value of [undefined, null, '', '  ', [], {}, 42]) {
      expect(licenseText(value)).toBe('UNKNOWN');
    }
  });
});

describe('packageNameOf', () => {
  it('takes the name after the last node_modules segment', () => {
    expect(packageNameOf('node_modules/rxjs')).toBe('rxjs');
    expect(packageNameOf('node_modules/@angular/core')).toBe('@angular/core');
    expect(packageNameOf('node_modules/node-fetch/node_modules/tr46')).toBe('tr46');
  });
});

describe('npmRuntimePackages', () => {
  const lock = {
    packages: {
      '': { name: 'studioflow', version: '0.0.0' },
      'node_modules/rxjs': { version: '7.8.2', license: 'Apache-2.0' },
      'node_modules/@angular/core': { version: '22.2.3', license: 'MIT' },
      'node_modules/vite': { version: '8.0.0', license: 'MIT', dev: true },
      'node_modules/a/node_modules/tr46': { version: '0.0.3', license: 'MIT' },
      'node_modules/tr46': { version: '5.0.0', license: 'MIT' },
      'node_modules/b/node_modules/tr46': { version: '0.0.3', license: 'MIT' },
      'node_modules/@types/dom': { version: '1.0.0', license: 'MIT', peer: true },
      'node_modules/linked': { link: true, resolved: '../packages/linked' },
      'node_modules/odd': { version: '1.0.0' },
    },
  };

  it('keeps the production tree, sorted, and drops the root, dev tools and links', () => {
    expect(npmRuntimePackages(lock)).toEqual([
      { name: '@angular/core', version: '22.2.3', license: 'MIT' },
      { name: '@types/dom', version: '1.0.0', license: 'MIT' },
      { name: 'odd', version: '1.0.0', license: 'UNKNOWN' },
      { name: 'rxjs', version: '7.8.2', license: 'Apache-2.0' },
      { name: 'tr46', version: '0.0.3', license: 'MIT' },
      { name: 'tr46', version: '5.0.0', license: 'MIT' },
    ]);
  });

  it('copes with an empty lock file', () => {
    expect(npmRuntimePackages({})).toEqual([]);
  });
});

describe('nuspecLicense', () => {
  it('reads a licence expression', () => {
    expect(nuspecLicense('<package><metadata><license type="expression">MIT</license></metadata></package>')).toBe(
      'MIT',
    );
  });

  it('points at a licence file inside the package', () => {
    expect(nuspecLicense('<license type="file">LICENSE.txt</license>')).toBe('see LICENSE.txt in the package');
  });

  it('uses a real licence URL but not the placeholder', () => {
    expect(nuspecLicense('<licenseUrl>https://opensource.org/license/mit</licenseUrl>')).toBe(
      'https://opensource.org/license/mit',
    );
    expect(nuspecLicense('<licenseUrl>https://aka.ms/deprecateLicenseUrl</licenseUrl>')).toBe('UNKNOWN');
    expect(nuspecLicense('<package />')).toBe('UNKNOWN');
  });
});

describe('nugetPackages', () => {
  const assets = {
    packageFolders: { '/cache/a/': {}, '/cache/b/': {} },
    libraries: {
      'Npgsql/10.0.3': { path: 'npgsql/10.0.3' },
      'Some.Analyzers/1.0.0': { path: 'some.analyzers/1.0.0' },
      'Lost.Package/2.0.0': { path: 'lost.package/2.0.0' },
    },
    targets: {
      'net10.0': {
        'Npgsql/10.0.3': { type: 'package', runtime: { 'lib/net10.0/Npgsql.dll': {} } },
        'Some.Analyzers/1.0.0': { type: 'package' },
        'Lost.Package/2.0.0': { type: 'package', compile: { 'lib/x.dll': {} } },
        'Opten.StudioFlow.Core/1.0.0': { type: 'project', compile: { 'bin/x.dll': {} } },
      },
    },
  };
  const nuspecs: Record<string, string> = {
    '/cache/b/npgsql/10.0.3/npgsql.nuspec': '<license type="expression">PostgreSQL</license>',
  };
  const readNuspec = (folder: string, libraryPath: string, name: string): string | null =>
    nuspecs[`${folder}${libraryPath}/${name.toLowerCase()}.nuspec`] ?? null;

  it('lists packages with assemblies, finds the nuspec in any package folder and flags the unknown', () => {
    expect(nugetPackages(assets, readNuspec)).toEqual([
      { name: 'Lost.Package', version: '2.0.0', license: 'UNKNOWN' },
      { name: 'Npgsql', version: '10.0.3', license: 'PostgreSQL' },
    ]);
  });
});

describe('rendering', () => {
  const rows = [
    { name: 'a', version: '1.0.0', license: 'MIT' },
    { name: 'b|c', version: '2.0.0', license: 'MIT' },
    { name: 'd', version: '3.0.0', license: 'Apache-2.0' },
  ];

  it('renders a Markdown table and escapes the pipe character', () => {
    expect(renderTable(rows).split('\n')).toEqual([
      '| Package | Version | Licence |',
      '|---|---|---|',
      '| a | 1.0.0 | MIT |',
      '| b\\|c | 2.0.0 | MIT |',
      '| d | 3.0.0 | Apache-2.0 |',
    ]);
  });

  it('counts the licences, the most frequent first', () => {
    expect(licenseSummary(rows)).toBe('MIT 2, Apache-2.0 1');
    expect(renderBlock('From the lock file', rows)).toMatch(
      /^From the lock file: 3 packages \(MIT 2, Apache-2.0 1\)\.\n\n\| Package/,
    );
  });
});

describe('replaceBlock', () => {
  const document = 'Intro\n\n<!-- BEGIN generated:npm -->\n\nold\n\n<!-- END generated:npm -->\n\nOutro\n';

  it('replaces what is between the markers and nothing else', () => {
    const next = replaceBlock(document, 'npm', 'new table\n');
    expect(next).toBe('Intro\n\n<!-- BEGIN generated:npm -->\n\nnew table\n\n<!-- END generated:npm -->\n\nOutro\n');
    expect(replaceBlock(next, 'npm', 'new table')).toBe(next);
    expect(readBlock(next, 'npm')).toBe('new table');
  });

  it('refuses a file without the markers', () => {
    expect(() => replaceBlock('no markers', 'npm', 'x')).toThrow(/BEGIN generated:npm/);
    expect(() => replaceBlock(document, 'nuget', 'x')).toThrow(/BEGIN generated:nuget/);
    expect(readBlock(document, 'nuget')).toBeNull();
  });
});
