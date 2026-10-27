#!/usr/bin/env bash
# Assembles the files of a GitHub release (docs/releasing.md) from the working tree. Runs in the release workflow after
# release-please tagged the release; nothing is uploaded here.
#
# Usage: infra/release/build-bundle.sh X.Y.Z OUTPUT_DIR
#
# Writes OUTPUT_DIR/assets/ - exactly the files that are attached to the release:
#   studioflow-X.Y.Z.tar.gz            the install folder: docker-compose.yml (the release file; its image tag is "latest",
#                                      the same file in every release), .env.example (optional overrides), runbook,
#                                      QUICKSTART.md, VERSION, LICENSE, NOTICE, THIRD_PARTY_NOTICES.md. No script:
#                                      docker compose is the only tool that installs, updates, backs up and restores.
#   docker-compose.yml, env.example    the same two files on their own (GitHub drops the leading dot of .env.example)
#   QUICKSTART.md                      one page: install, update, roll back
#   studioflow-prototype.html          the clickable Regie prototype as one self-contained file (fonts embedded, works
#                                      offline); no version in the name, so that .../releases/latest/download/ links to it
#   SHA256SUMS                         checksums of all of the above
set -euo pipefail

usage() {
	sed -n '2,/^set /p' "$0" | sed '$d;s/^# \{0,1\}//' >&2
	exit 2
}

[ "$#" -eq 2 ] || usage
version="$1"
out="$2"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo "Error: '$version' is not a version (X.Y.Z)." >&2
	exit 2
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# The files of this commit must carry the version that is released (release-please puts it there).
declared="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' package.json | head -n 1)"
[ "$declared" = "$version" ] || {
	echo "Error: package.json says version '$declared', not '$version'. Build the bundle from the release commit." >&2
	exit 1
}
grep -q 'STUDIOFLOW_IMAGE_TAG:-latest}' docker-compose.release.yml || {
	echo "Error: docker-compose.release.yml must default to the image tag latest." >&2
	exit 1
}

name="studioflow-$version"
stage="$out/stage/$name"
assets="$out/assets"
rm -rf "$out"
mkdir -p "$stage/docs" "$assets"

# Docker Compose reads docker-compose.yml by default, so the release file is called that in the bundle.
install -m 0644 docker-compose.release.yml "$stage/docker-compose.yml"
install -m 0644 docker-compose.override.example.yml .env.example "$stage/"
install -m 0644 docs/runbook.md "$stage/docs/"
install -m 0644 LICENSE NOTICE THIRD_PARTY_NOTICES.md "$stage/"
sed "s/@VERSION@/$version/g" infra/release/QUICKSTART.md >"$stage/QUICKSTART.md"
printf '%s\n' "$version" >"$stage/VERSION"

# Reproducible archive: fixed order, owner and time (the time of the commit), no timestamp in the gzip header.
epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$epoch" -cf - -C "$out/stage" "$name" |
	gzip -9n >"$assets/$name.tar.gz"

install -m 0644 "$stage/docker-compose.yml" "$stage/QUICKSTART.md" "$assets/"
install -m 0644 .env.example "$assets/env.example"

# The prototype with its fonts inlined (tools/build-prototype.mjs: plain Node, no npm install needed).
command -v node >/dev/null || {
	echo "Error: node is needed to build the prototype file." >&2
	exit 1
}
node tools/build-prototype.mjs --out "$assets/studioflow-prototype.html"

(cd "$assets" && sha256sum -- * >SHA256SUMS)
rm -rf "$out/stage"

echo "Release files for $version in $assets:"
(cd "$assets" && ls -l)
