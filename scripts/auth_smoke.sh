#!/usr/bin/env bash
# End-to-end authentication smoke test through the website rewrite.
#
# Runs the checks that M1 must prove, using curl and a cookie jar:
#   register -> session -> /me -> refresh rotation -> logout
#   CSRF: hostile origin is rejected, missing/mismatched token is rejected,
#   matching token is accepted.
#
# Usage:
#   scripts/auth_smoke.sh                          # local: web on :3000
#   BASE_URL=https://<web>.vercel.app scripts/auth_smoke.sh
#   BASE_URL=http://localhost:8000 scripts/auth_smoke.sh   # API directly
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ORIGIN="${ORIGIN:-$BASE_URL}"
API_PATH="${API_PATH:-/api/v1}"
JAR="$(mktemp -t qn-smoke-jar)"
BODY="$(mktemp -t qn-smoke-body)"
trap 'rm -f "$JAR" "$BODY"' EXIT

EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASSWORD="smoke-pass-$(date +%s)-A1"

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; exit 1; }

status_of() { tail -n1 "$BODY" | tr -d '\r'; }

request() {
  # request <label> <expected-status> <curl args...>
  local label="$1" expected="$2"
  shift 2
  local code
  code="$(curl -sS -o "$BODY" -w '%{http_code}' "$@")"
  if [[ "$code" == "$expected" ]]; then
    pass "$label ($code)"
  else
    printf '  FAIL  %s (expected %s, got %s)\n' "$label" "$expected" "$code"
    head -c 400 "$BODY"; printf '\n'
    exit 1
  fi
}

cookie_value() { awk -v name="$1" '$6 == name { print $7 }' "$JAR" | tail -n1; }

echo "Auth smoke test"
echo "  base:   $BASE_URL"
echo "  origin: $ORIGIN"
echo "  email:  $EMAIL"
echo

echo "1. Registration and session establishment"
request "register returns a session (local autoconfirm)" 200 \
  -X POST "$BASE_URL$API_PATH/auth/register" \
  -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  -c "$JAR"

if grep -q "qn_at" "$JAR" && grep -q "qn_rt" "$JAR" && grep -q "qn_csrf" "$JAR"; then
  pass "session, refresh and CSRF cookies were set"
else
  fail "expected qn_at, qn_rt and qn_csrf cookies"
fi

CSRF="$(cookie_value qn_csrf)"
[[ -n "$CSRF" ]] || fail "could not read the CSRF cookie value"

request "session probe reports authenticated" 200 \
  -b "$JAR" "$BASE_URL$API_PATH/auth/session"

if grep -q '"authenticated":true' "$BODY"; then
  pass "session payload is authenticated"
else
  fail "session payload is not authenticated: $(head -c 200 "$BODY")"
fi

echo
echo "2. Authenticated identity"
request "/me returns the account" 200 -b "$JAR" "$BASE_URL$API_PATH/me"

if grep -q "$EMAIL" "$BODY"; then
  pass "/me carries the right account identity"
else
  fail "/me does not mention the signed-in email: $(head -c 300 "$BODY")"
fi

echo
echo "3. CSRF protection"
request "hostile origin is rejected" 403 \
  -X POST "$BASE_URL$API_PATH/auth/logout" \
  -H "Origin: https://evil.example" -b "$JAR"

request "missing CSRF header is rejected" 403 \
  -X POST "$BASE_URL$API_PATH/auth/logout" \
  -H "Origin: $ORIGIN" -b "$JAR"

request "mismatched CSRF header is rejected" 403 \
  -X POST "$BASE_URL$API_PATH/auth/logout" \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: wrong-value" -b "$JAR"

echo
echo "4. Refresh rotation"
OLD_REFRESH="$(cookie_value qn_rt)"
request "refresh rotates the session" 200 \
  -X POST "$BASE_URL$API_PATH/auth/refresh" \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -b "$JAR" -c "$JAR"

NEW_REFRESH="$(cookie_value qn_rt)"
if [[ -n "$NEW_REFRESH" && "$NEW_REFRESH" != "$OLD_REFRESH" ]]; then
  pass "refresh token rotated"
else
  fail "refresh token did not rotate"
fi

request "/me still works after rotation" 200 -b "$JAR" "$BASE_URL$API_PATH/me"

echo
echo "5. Logout"
CSRF="$(cookie_value qn_csrf)"
request "logout with a valid token" 204 \
  -X POST "$BASE_URL$API_PATH/auth/logout" \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" -b "$JAR" -c "$JAR"

request "session probe reports signed out" 200 -b "$JAR" "$BASE_URL$API_PATH/auth/session"

if grep -q '"authenticated":false' "$BODY"; then
  pass "session is cleared"
else
  fail "session still authenticated after logout: $(head -c 200 "$BODY")"
fi

request "/me is unauthenticated after logout" 401 -b "$JAR" "$BASE_URL$API_PATH/me"

echo
echo "All auth smoke checks passed."
