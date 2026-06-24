#!/usr/bin/env bash
# push_changes.sh – stage, commit, and push all local modifications.
# Usage: ./push_changes.sh "Optional commit message"

set -e

# Stage everything
git add -A

# Determine commit message
if [ "$#" -ge 1 ]; then
  MSG="$*"
else
  MSG="Update $(date +'%%Y-%%m-%%d %%H:%%M')"
fi

# Commit if there are changes
if ! git diff-index --quiet HEAD; then
  git commit -m "$MSG"
fi

# Push to remote (default branch)
git push
