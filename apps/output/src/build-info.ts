/**
 * The version this output page was built from, shown as the last line of the `?debug=1` overlay.
 *
 * The page is served to people who are not signed in, so it cannot ask `GET /api/system/info` (admin only): the
 * version is written into the bundle at build time. `vite.config.ts` defines `__STUDIOFLOW_VERSION__` from the
 * `version` in `package.json` (the one version of the release) and the commit the image is built from (the Docker
 * build argument `STUDIOFLOW_REVISION`), in the same format as the API reports: `0.1.0+1a2b3c4`, or just `0.1.0` for a
 * build that does not know its commit (local development).
 */

/** Characters of the commit that are kept (as the API does). */
export const REVISION_LENGTH = 7;
/** Shown when the bundle carries no version at all (unit tests). */
export const UNKNOWN_VERSION = '0.0.0';

/**
 * `0.1.0+1a2b3c4` from the version of `package.json` and a commit hash. A missing or malformed commit (anything but
 * hexadecimal digits) is left out rather than shown.
 */
export function formatBuildVersion(version: string, revision?: string | null): string {
  const commit = (revision ?? '').trim().toLowerCase();
  return /^[0-9a-f]{4,64}$/.test(commit)
    ? `${version}+${commit.slice(0, REVISION_LENGTH)}`
    : version;
}

declare const __STUDIOFLOW_VERSION__: string | undefined;

/** The version of this build; `0.0.0` where the build tool did not define it. */
export const BUILD_VERSION: string =
  typeof __STUDIOFLOW_VERSION__ === 'string' && __STUDIOFLOW_VERSION__ !== ''
    ? __STUDIOFLOW_VERSION__
    : UNKNOWN_VERSION;
