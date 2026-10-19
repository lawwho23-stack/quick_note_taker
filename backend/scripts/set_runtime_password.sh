#!/usr/bin/env bash
# Set the password for the qn_runtime database role.
#
# The runtime role is created by migration 0001 without a password, so no secret
# ever lives in a migration file or in git. Run this once against each database
# (local, staging) with the owner/migration connection string:
#
#   DATABASE_URL="postgresql://postgres:<owner-password>@<host>:5432/postgres" \
#   RUNTIME_DB_PASSWORD="<new-runtime-password>" \
#   backend/scripts/set_runtime_password.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the owner/migration connection string}"
: "${RUNTIME_DB_PASSWORD:?Set RUNTIME_DB_PASSWORD to the password for qn_runtime}"

psql "$DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --set runtime_password="$RUNTIME_DB_PASSWORD" \
  <<'SQL'
-- :'runtime_password' is a psql variable, which only interpolates from stdin
-- (or a file), not from -c.
alter role qn_runtime with password :'runtime_password';
SQL

echo "qn_runtime password updated."
