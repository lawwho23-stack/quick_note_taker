#!/usr/bin/env bash
# End-to-end authentication smoke test through the website rewrite.
#
# Proves, using curl and cookie jars:
#   session -> /me -> CSRF rejections -> refresh rotation -> logout
# and one of three ways to reach a session:
#   register  autoconfirm on; registration returns a session immediately
#   login     sign in with an existing, already-confirmed account
#   confirm   register, then complete the emailed link (needs CONFIRM_URL)
#
# Usage:
#   scripts/auth_smoke.sh                              # local web on :3000, register mode
#   MODE=login EMAIL=me+a@mail.com PASSWORD=... scripts/auth_smoke.sh
#   BASE_URL=https://quick-note-web-one.vercel.app scripts/auth_smoke.sh
#   BASE_URL=http://localhost:8000 scripts/auth_smoke.sh   # API directly, no rewrite
#
# Confirmation mode (email confirmation stays ON):
#   MODE=confirm EMAIL=me+a@mail.com CONFIRM_URL='https://<ref>.supabase.co/auth/v1/verify?...' \
#     scripts/auth_smoke.sh
#
# Pass CONFIRM_URL through the environment or stdin, never as a command-line
# argument: arguments land in shell history and process lists, and the link is
# a single-use credential.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ORIGIN="${ORIGIN:-$BASE_URL}"
API_PATH="${API_PATH:-/api/v1}"
MODE="${MODE:-register}"
# Hosted Supabase rejects reserved domains such as example.com, so the domain is
# configurable. Use a domain you control, or a real mailbox provider for testing.
EMAIL_DOMAIN="${EMAIL_DOMAIN:-example.com}"
EMAIL="${EMAIL:-smoke-$(date +%s)-$RANDOM@$EMAIL_DOMAIN}"
PASSWORD="${PASSWORD:-smoke-pass-$(date +%s)-A1}"

JAR="$(mktemp -t qn-smoke-jar)"
BODY="$(mktemp -t qn-smoke-body)"
trap 'rm -f "$JAR" "$BODY"' EXIT

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; exit 1; }
note() { printf '  %s\n' "$1"; }

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

# Read the Location header without following the redirect: the fragment that
# carries the session never reaches a server, so curl must not chase it.
location_of() {
  curl -sS -o /dev/null -D - "$1" \
    | tr -d '\r' \
    | awk 'tolower($1) == "location:" { $1 = ""; sub(/^ /, ""); print; exit }'
}

fragment_value() {
  # fragment_value <fragment> <key>
  printf '%s' "$1" | tr '&' '\n' | awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
}

echo "Auth smoke test"
echo "  base:   $BASE_URL"
echo "  origin: $ORIGIN"
echo "  mode:   $MODE"
echo "  email:  $EMAIL"
echo

echo "1. Establish a session"

case "$MODE" in
  register)
    request "register returns a session" 200 \
      -X POST "$BASE_URL$API_PATH/auth/register" \
      -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
      -c "$JAR"

    if grep -q '"status":"signed_in"' "$BODY"; then
      pass "registration signed in immediately"
    else
      fail "registration did not sign in; the project still requires email confirmation"
    fi
    ;;

  login)
    request "login returns a session" 200 \
      -X POST "$BASE_URL$API_PATH/auth/login" \
      -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
      -c "$JAR"
    ;;

  confirm)
    if [[ "${SKIP_REGISTER:-0}" == "1" ]]; then
      note "skipping registration: CONFIRM_URL already identifies the account"
    else
      request "register asks for confirmation" 200 \
        -X POST "$BASE_URL$API_PATH/auth/register" \
        -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
        -c "$JAR"

      if grep -q '"status":"confirmation_required"' "$BODY"; then
        pass "registration withheld the session until the email is confirmed"
      else
        fail "expected confirmation_required; the project may have autoconfirm on"
      fi

      if [[ -z "$(cookie_value qn_at)" ]]; then
        pass "no session cookie was issued before confirmation"
      else
        fail "a session cookie was issued before the email was confirmed"
      fi
    fi

    CONFIRM_URL="${CONFIRM_URL:-}"
    if [[ -z "$CONFIRM_URL" && ! -t 0 ]]; then
      read -r CONFIRM_URL || true
    fi
    [[ -n "$CONFIRM_URL" ]] || fail "set CONFIRM_URL to the link from the confirmation email"

    note "redeeming the confirmation link"
    LOCATION="$(location_of "$CONFIRM_URL")"
    [[ -n "$LOCATION" ]] || fail "the confirmation link returned no redirect"

    if [[ "$LOCATION" != *#* ]]; then
      # Supabase reports failures by redirecting with ?error=... instead.
      fail "confirmation link was rejected: $LOCATION"
    fi

    FRAGMENT="${LOCATION#*#}"
    ACCESS_TOKEN="$(fragment_value "$FRAGMENT" access_token)"
    REFRESH_TOKEN="$(fragment_value "$FRAGMENT" refresh_token)"
    [[ -n "$ACCESS_TOKEN" ]] || fail "the redirect carried no access_token"

    if [[ "$LOCATION" == */auth/confirm* ]]; then
      pass "the link returned the browser to our own /auth/confirm route"
    else
      fail "the link did not target our route: $LOCATION"
    fi

    request "exchange turns the link into a session" 200 \
      -X POST "$BASE_URL$API_PATH/auth/exchange" \
      -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
      -d "{\"access_token\":\"$ACCESS_TOKEN\",\"refresh_token\":\"$REFRESH_TOKEN\"}" \
      -c "$JAR"
    ;;

  *)
    fail "unknown MODE '$MODE' (expected register, login or confirm)"
    ;;
esac

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

if grep -qi "$EMAIL" "$BODY"; then
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
