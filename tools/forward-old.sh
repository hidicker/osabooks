#!/usr/bin/env bash
# The old addresses, once OsaBooks has moved to osabooks.app (23 November 2026):
#
# - nbparagliding.nz/osabooks gets the "moved" copy of the app (built with
#   OSABOOKS_MOVED_TO, into apps/web/dist-moved): it opens nothing online, sends
#   a browser with nothing kept there straight on, and offers a browser with
#   books kept there a backup to restore at the new address (moved.ts);
# - nbparagliding.nz/osabooks_demo forwards to demo.osabooks.app, path and all:
#   the demo's books are invented, and are made again there.
#
# For the "Deploy website" action, target "old". The logins come from the
# environment (WEBDISK_APP_USER, WEBDISK_DEMO_USER, WEBDISK_PASSWORD), never
# printed. Reuses deploy-webdisk.sh's upload and check for the app.
set -euo pipefail
BASE="${WEBDISK_BASE:-https://nbparagliding.nz:2078}"
: "${WEBDISK_PASSWORD:?WEBDISK_PASSWORD is not set}"

# The moved app, where the app was.
[ -f apps/web/dist-moved/index.html ] || { echo "Build the moved copy first (OSABOOKS_MOVED_TO)" >&2; exit 1; }
DIST_APP=apps/web/dist-moved TARGET=app bash tools/deploy-webdisk.sh

# The demo folder: every request forwarded, before any file in it is served.
# Streamed to the upload, not written to a file in /tmp first, where another
# user on the machine could have put one in its place (Antigravity L10).
curl -sS --fail -o /dev/null -u "${WEBDISK_DEMO_USER:?WEBDISK_DEMO_USER is not set}:$WEBDISK_PASSWORD" \
  -T - "$BASE/.htaccess" <<'EOF'
# The demo moved to https://demo.osabooks.app on 23 November 2026.
RewriteEngine On
RewriteRule ^(.*)$ https://demo.osabooks.app/$1 [R=301,L,QSA]
EOF
for tries in 1 2 3 4 5 6; do
  where=$(curl -sS -o /dev/null -w '%{redirect_url}' "https://nbparagliding.nz/osabooks_demo/?v=$RANDOM")
  case "$where" in https://demo.osabooks.app/*) echo "nbparagliding.nz/osabooks_demo forwards to $where"; exit 0;; esac
  sleep 5
done
echo "The old demo address does not forward yet." >&2
exit 1
