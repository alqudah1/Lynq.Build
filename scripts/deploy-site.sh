#!/bin/bash
# Publishes the public website (lynq.build, Vercel project "lynq-dev") from a commit on GitHub.
#
#   bash scripts/deploy-site.sh <commit>      (always run with bash, never paste the lines)
#
# Written after 15 Nov 2026, when deploy lines pasted into zsh copied no files and published
# an empty site. zsh does not split "$ALLOW" into separate names, so the copy loop did nothing.
# This script therefore:
#   1. refuses to run in anything but bash,
#   2. refuses to deploy unless the key pages and a sensible number of files are present,
#   3. checks the live site afterwards and rolls back by itself if the pages are not there.
if [ -z "$BASH_VERSION" ]; then echo "Run this with: bash scripts/deploy-site.sh <commit>"; exit 1; fi
set -euo pipefail

COMMIT="${1:-}"
if [ -z "$COMMIT" ]; then echo "Usage: bash scripts/deploy-site.sh <commit>"; exit 1; fi
REPO="https://github.com/alqudah1/Lynq.Build"
PROJECT='{"projectId":"prj_r1FJHhu0vn00xsAaii4A6zTKFGqi","orgId":"team_cc9itQ28cEyYANuFoIMVokYn"}'
MUST_HAVE="index.html book.html privacy.html terms.html portfolio.html vercel.json package.json api/book-request.js"
MIN_FILES=40
CHECK_PAGES="/ /book /privacy /terms /portfolio"

W=$(mktemp -d)
git clone -q "$REPO" "$W/src"
cd "$W/src"
git checkout -q "$COMMIT"
echo "commit: $(git log --oneline -1)"

# The allowlist lives in one place: the Mac deploy script.
ALLOW=$(sed -n 's/^ALLOW="\(.*\)"$/\1/p' _DEPLOY-LYNQ-SITE.command)
if [ -z "$ALLOW" ]; then echo "STOPPED: could not read the file list. Nothing deployed."; exit 1; fi
mkdir -p "$W/out/.vercel"
for p in $ALLOW; do
  if [ -e "$p" ]; then rsync -a --exclude '.DS_Store' --exclude '.env*' "$p" "$W/out/"; fi
done
printf '%s' "$PROJECT" > "$W/out/.vercel/project.json"

N=$(find "$W/out" -type f | wc -l | tr -d ' ')
echo "files: $N"
if [ "$N" -lt "$MIN_FILES" ]; then echo "STOPPED: only $N files (need $MIN_FILES or more). Nothing deployed."; exit 1; fi
for f in $MUST_HAVE; do
  if [ ! -s "$W/out/$f" ]; then echo "STOPPED: $f is missing or empty. Nothing deployed."; exit 1; fi
done
for bad in platform clients AGENTS.md .claude .env; do
  if [ -e "$W/out/$bad" ]; then echo "STOPPED: $bad must never be published. Nothing deployed."; exit 1; fi
done

if command -v vercel >/dev/null 2>&1; then V="vercel"; else V="npx -y vercel@latest"; fi
cd "$W/out"
$V deploy --prod --yes

echo "--- live checks"
sleep 8
FAILED=0
for u in $CHECK_PAGES; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://lynq.build$u")
  echo "$u $code"
  if [ "$code" != "200" ]; then FAILED=1; fi
done
if [ "$FAILED" = 1 ]; then
  echo "A page is not loading. Rolling back to the previous version."
  $V rollback --yes || echo "ROLLBACK FAILED: open the lynq-dev project on vercel.com, Deployments, and use Instant Rollback on the last good one."
  exit 1
fi
echo "pixel on /book: $(curl -s https://lynq.build/book | grep -c 'fbq(' || true)"
echo "DONE: lynq.build is live on $COMMIT"
