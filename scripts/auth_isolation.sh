#!/usr/bin/env bash
# Two-user isolation smoke test.
#
# Proves the M1 deliverable clause "no cross-user session leakage" against a
# running deployment: two independent accounts, two cookie jars, and a set of
# attempts to use one account's credentials as the other.
#
# Both accounts must already exist and be confirmed. Use MODE=login with two
# distinct addresses, or create them in the Supabase dashboard with
# "Auto Confirm User" ticked.
#
# Usage:
#   EMAIL_A=me+a@mail.com PASSWORD_A=... \
#   EMAIL_B=me+b@mail.com PASSWORD_B=... \
#   BASE_URL=https://quick-note-web-one.vercel.app scripts/auth_isolation.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ORIGIN="${ORIGIN:-$BASE_URL}"
API_PATH="${API_PATH:-/api/v1}"

: "${EMAIL_A:?set EMAIL_A to the first account's address}"
: "${EMAIL_B:?set EMAIL_B to the second account's address}"
: "${PASSWORD_A:?set PASSWORD_A}"
: "${PASSWORD_B:?set PASSWORD_B}"

[[ "$EMAIL_A" != "$EMAIL_B" ]] || { echo "EMAIL_A and EMAIL_B must differ" >&2; exit 1; }

JAR_A="$(mktemp -t qn-iso-a)"
JAR_B="$(mktemp -t qn-iso-b)"
BODY="$(mktemp -t qn-iso-body)"
trap 'rm -f "$JAR_A" "$JAR_B" "$BODY"' EXIT

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; exit 1; }

status_of() { tail -n1 "$BODY" | tr -d '\r'; }

request() {
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

cookie_value() { awk -v name="$1" '$6 == name { print $7 }' "$2" | tail -n1; }

sign_in() {
  local email="$1" password="$2" jar="$3" label="$4"
  request "$label signs in" 200 \
    -X POST "$BASE_URL$API_PATH/auth/login" \
    -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
    -c "$jar"
}

echo "Two-user isolation"
echo "  base:  $BASE_URL"
echo "  user A: $EMAIL_A"
echo "  user B: $EMAIL_B"
echo

echo "1. Both accounts sign in independently"
sign_in "$EMAIL_A" "$PASSWORD_A" "$JAR_A" "A"
sign_in "$EMAIL_B" "$PASSWORD_B" "$JAR_B" "B"

echo
echo "2. Each identity is its own"
request "A's /me returns A" 200 -b "$JAR_A" "$BASE_URL$API_PATH/me"
grep -qi "$EMAIL_A" "$BODY" || fail "A's /me does not mention A"
grep -qi "$EMAIL_B" "$BODY" && fail "A's /me leaked B's address"
pass "A's /me contains only A"

request "B's /me returns B" 200 -b "$JAR_B" "$BASE_URL$API_PATH/me"
grep -qi "$EMAIL_B" "$BODY" || fail "B's /me does not mention B"
grep -qi "$EMAIL_A" "$BODY" && fail "B's /me leaked A's address"
pass "B's /me contains only B"

echo
echo "3. Account identifiers differ"
request "A's /me (for the id)" 200 -b "$JAR_A" "$BASE_URL$API_PATH/me"
A_ACCOUNT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["account"]["id"])' "$BODY")"
request "B's /me (for the id)" 200 -b "$JAR_B" "$BASE_URL$API_PATH/me"
B_ACCOUNT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["account"]["id"])' "$BODY")"

if [[ -n "$A_ACCOUNT" && -n "$B_ACCOUNT" && "$A_ACCOUNT" != "$B_ACCOUNT" ]]; then
  pass "the two accounts have distinct application ids"
else
  fail "account ids are missing or equal ($A_ACCOUNT / $B_ACCOUNT)"
fi

echo
echo "4. One account's refresh token cannot be used by the other"
A_REFRESH="$(cookie_value qn_rt "$JAR_A")"
[[ -n "$A_REFRESH" ]] || fail "could not read A's refresh cookie"

# Send A's refresh cookie with B's CSRF token and jar: the session that comes
# back must still be A, because the cookie is the credential.
request "refresh with A's token returns A" 200 \
  -X POST "$BASE_URL$API_PATH/auth/refresh" \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $(cookie_value qn_csrf "$JAR_A")" \
  -H "Cookie: qn_rt=$A_REFRESH" -c "$JAR_A"

if grep -qi "$EMAIL_A" "$BODY"; then
  pass "the rotated session still belongs to A"
else
  fail "refresh with A's token returned another identity: $(head -c 300 "$BODY")"
fi

echo
echo "5. A's cookies never resolve to B"
request "A's cookies still report A" 200 -b "$JAR_A" "$BASE_URL$API_PATH/me"
grep -qi "$EMAIL_A" "$BODY" || fail "A's cookies stopped reporting A"
grep -qi "$EMAIL_B" "$BODY" && fail "A's cookies resolved to B"
pass "no crossover after refresh"

echo
echo "6. Signing out A does not disturb B"
request "A signs out" 204 \
  -X POST "$BASE_URL$API_PATH/auth/logout" \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $(cookie_value qn_csrf "$JAR_A")" \
  -b "$JAR_A" -c "$JAR_A"

request "A is signed out" 401 -b "$JAR_A" "$BASE_URL$API_PATH/me"

request "B is still signed in" 200 -b "$JAR_B" "$BASE_URL$API_PATH/me"
grep -qi "$EMAIL_B" "$BODY" || fail "B's session was affected by A's logout"
pass "B's session survived A's logout"

echo
echo "All isolation checks passed."
