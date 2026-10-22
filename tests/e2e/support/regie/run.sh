#!/usr/bin/env bash
# Runs the Regie specs on stack 1 (reused). Usage: run.sh <playwright args>
cd "$(dirname "$0")/../../../.."
E2E_STACK=1 E2E_REUSE_STACK=1 npx playwright test -c tests/e2e/playwright.config.ts "$@"
