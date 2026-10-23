#!/usr/bin/env bash
# Loads the kernel modules of the netem sidecar on a CI runner (docs/testing.md 6.1): sch_netem (delay, jitter, loss),
# ifb and act_mirred (shaping of the ingress direction). The sidecar container only has NET_ADMIN; the modules must
# exist on the host kernel.
#
# If they cannot be loaded, the script does not fail: it writes a warning annotation and sets E2E_NETEM=unavailable for
# the following steps. E2E-NET-00 then reports the netem tool as skipped, and the tests that need it are skipped
# instead of failing for a reason that is not in the product (tests/e2e/support/fixtures.ts, requireTool).
set -uo pipefail

modules=(sch_netem ifb act_mirred)

load() { sudo modprobe -a "${modules[@]}" 2>/dev/null; }

if ! load; then
  echo "Not loadable yet; trying linux-modules-extra-$(uname -r)."
  sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends "linux-modules-extra-$(uname -r)" > /dev/null 2>&1
fi

if load; then
  echo "Loaded: ${modules[*]} (kernel $(uname -r))."
else
  echo "::warning title=netem unavailable::The kernel $(uname -r) of this runner has no ${modules[*]}. The network impairment tests are skipped."
  echo "E2E_NETEM=unavailable" >> "${GITHUB_ENV:-/dev/null}"
fi
