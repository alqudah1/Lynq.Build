#!/bin/bash
# Deploys the public LYNQ website (lynq.build, Vercel project "lynq-dev") from this repo.
# Only an allowlist of website files is uploaded, so internal docs, client folders, the
# platform app, configs and archives are never published. Downloads cloud-only iCloud files
# first so the copy can't stall. Writes a log next to this script.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
SRC="$HOME/Desktop/Active Projects/lynq.build"
OUT="$HOME/Downloads/lynq-site-deploy"
LOG="$HOME/Downloads/lynq-deploy-log.txt"
ALLOW="index.html portfolio.html book.html digital-transformation.html office.html agent.html website-review.html admin.html favicon.svg logo.svg og-image.png site.webmanifest robots.txt sitemap.xml llms.txt vercel.json package.json package-lock.json pnpm-lock.yaml api assets projects work"
{
  echo "LYNQ deploy — $(date)"
  cd "$SRC" || { echo "repo not found"; exit 1; }
  echo "== downloading cloud-only files from iCloud"
  for p in $ALLOW; do [ -e "$p" ] && brctl download "$SRC/$p" 2>/dev/null; done
  for i in $(seq 1 90); do
    missing=0
    for p in $ALLOW; do
      [ -e "$p" ] || continue
      if [ -d "$p" ]; then
        while IFS= read -r f; do head -c1 "$f" >/dev/null 2>&1 || missing=$((missing+1)); done < <(find "$p" -type f -not -name .DS_Store)
      else head -c1 "$p" >/dev/null 2>&1 || missing=$((missing+1)); fi
    done
    [ "$missing" = 0 ] && break
    echo "  waiting on $missing file(s)…"; sleep 4
  done
  [ "$missing" = 0 ] || { echo "STOPPED: $missing file(s) still not downloaded from iCloud. Nothing was deployed."; exit 1; }
  # New robots.txt is staged as robots.next.txt (robots.txt was cloud-only and couldn't be replaced remotely).
  if [ -f robots.next.txt ]; then cp robots.next.txt robots.txt && rm -f robots.next.txt && echo "robots.txt updated"; fi
  echo "== copying website files only"
  rm -rf "$OUT" && mkdir -p "$OUT/.vercel"
  for p in $ALLOW; do [ -e "$p" ] && rsync -a --exclude '.DS_Store' --exclude '.env*' "$p" "$OUT/"; done
  printf '{"projectId":"prj_r1FJHhu0vn00xsAaii4A6zTKFGqi","orgId":"team_cc9itQ28cEyYANuFoIMVokYn"}' > "$OUT/.vercel/project.json"
  echo "files: $(find "$OUT" -type f | wc -l)"
  cd "$OUT"
  if command -v vercel >/dev/null 2>&1; then V="vercel"; else V="npx -y vercel@latest"; fi
  $V deploy --prod --yes 2>&1
  echo "DEPLOY EXIT: $?"
  sleep 5
  echo "--- live checks"
  for u in / /portfolio /book /llms.txt /robots.txt /CLAUDE.md /.mcp.json; do echo "$u $(curl -s -o /dev/null -w '%{http_code}' "https://lynq.build$u")"; done
  echo "(CLAUDE.md and .mcp.json should now be 404)"
  echo DONE
} 2>&1 | tee "$LOG"
echo; echo "Finished. You can close this window."
