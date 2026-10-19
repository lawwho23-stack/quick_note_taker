#!/usr/bin/env bash
# Configure the Supabase Auth URLs this app depends on.
#
# Sets exactly two fields on the hosted project:
#   site_url        the fallback the browser is sent to after an auth link
#   uri_allow_list  the exact redirect URLs Supabase will honour
#
# Everything else is left alone on purpose. In particular this script never
# touches "Confirm email", SMTP, or OAuth providers: those are product decisions,
# not deployment plumbing, and a script that silently flips them is a footgun.
#
# Why it exists: without these values Supabase rewrites an unknown `redirect_to`
# back to the Site URL. Staging then emails links that point at localhost:3000.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... scripts/configure_auth.sh \
#     --project-ref <ref> --web-url https://<site>
#
#   scripts/configure_auth.sh --project-ref <ref> --web-url https://<site> --dry-run
#
# On macOS, if SUPABASE_ACCESS_TOKEN is unset and the Supabase CLI is signed in,
# its personal access token is read from the login keychain instead. On other
# platforms set the variable explicitly.
set -euo pipefail

PROJECT_REF=""
WEB_URL=""
DRY_RUN=0
API="https://api.supabase.com/v1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-ref) PROJECT_REF="${2:-}"; shift 2 ;;
    --web-url) WEB_URL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$PROJECT_REF" ]] || { echo "--project-ref is required" >&2; exit 2; }
[[ -n "$WEB_URL" ]] || { echo "--web-url is required" >&2; exit 2; }
WEB_URL="${WEB_URL%/}"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" ]] && command -v security >/dev/null 2>&1; then
  TOKEN="$(security find-generic-password -s 'Supabase CLI' -w 2>/dev/null || true)"
fi
[[ -n "$TOKEN" ]] || { echo "set SUPABASE_ACCESS_TOKEN" >&2; exit 2; }

# Local development stays allowed, so the same project can serve a developer's
# machine and staging without editing this list.
python3 - "$WEB_URL" > /tmp/qn-auth-urls.json <<'PY'
import json
import sys

web = sys.argv[1]
urls = [
    f"{web}/auth/confirm",
    f"{web}/api/v1/auth/callback",
]
for host in ("http://localhost:3000", "http://127.0.0.1:3000"):
    urls.append(f"{host}/auth/confirm")
    urls.append(f"{host}/api/v1/auth/callback")

print(json.dumps({"site_url": web, "uri_allow_list": ",".join(urls)}))
PY

echo "Project:  $PROJECT_REF"
echo "Site URL: $WEB_URL"
echo "Allowed redirects:"
python3 - <<'PY'
import json
for url in json.load(open("/tmp/qn-auth-urls.json"))["uri_allow_list"].split(","):
    print(f"  - {url}")
PY

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "Dry run: nothing was sent."
  exit 0
fi

echo
curl -sS --fail-with-body --max-time 30 \
  -X PATCH "$API/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/qn-auth-urls.json \
  -o /tmp/qn-auth-result.json -w 'applied: HTTP %{http_code}\n'

python3 - <<'PY'
import json

result = json.load(open("/tmp/qn-auth-result.json"))
print(f"  site_url        {result.get('site_url')}")
print(f"  uri_allow_list  {result.get('uri_allow_list')}")
# Report the settings this script promises not to touch, so a surprising change
# is visible immediately rather than at the first signup.
print(f"  confirm email   {not result.get('mailer_autoconfirm')} (autoconfirm={result.get('mailer_autoconfirm')})")
print(f"  smtp host       {result.get('smtp_host')}")
PY
