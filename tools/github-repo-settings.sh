#!/usr/bin/env bash
# One-time repository settings by the owner (docs/releasing.md section 8, issue #23). Needs `gh` signed in as a
# repository administrator. Safe to run again: every call sets the final state.
#
#   bash tools/github-repo-settings.sh [owner/repo]
#
# The repository rename (#3) is not done here.
set -euo pipefail

repo="${1:-OPTEN/StudioFlow}"

echo "1/4 Pull requests: squash merge only, the PR title becomes the commit message"
gh api -X PATCH "repos/$repo" --silent \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true

echo "2/4 Actions: read-only default token, allowed to create and approve pull requests (release-please)"
gh api -X PUT "repos/$repo/actions/permissions/workflow" --silent \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true

echo "3/4 Branch protection for main: required checks ci-ok (aggregate of the CI jobs, issue 57) and the PR title, no force push, no deletion"
# enforce_admins=false: administrators may still push directly to main (the maintainers' working mode).
gh api -X PUT "repos/$repo/branches/main/protection" --silent --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": [
      "ci-ok",
      "Conventional Commits title"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON

echo "4/4 Secret RELEASE_PLEASE_TOKEN (optional, not set by decision: docs/releasing.md section 8)"
if gh secret list --repo "$repo" | grep -q '^RELEASE_PLEASE_TOKEN'; then
  echo "    set: CI starts on the release pull request by itself"
else
  echo "    not set: click \"Approve workflows to run\" on the release pull request"
  echo "    (to set it later: gh secret set RELEASE_PLEASE_TOKEN --repo $repo)"
fi

echo "Done. Check: https://github.com/$repo/settings/branches"
