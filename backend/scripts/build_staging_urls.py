"""Build correctly-encoded staging connection strings from backend/.env.staging.

The owner password contains an `@`, so it must be percent-encoded before it can
live inside a URL. This script reads the raw password, writes the encoded
`DATABASE_URL` (session pooler, port 5432, used only by migrations and admin
scripts) and `RUNTIME_DATABASE_URL` (transaction pooler, port 6543, used by the
running API as qn_runtime) back into the same file.

It never prints secrets.
"""

from __future__ import annotations

import pathlib
import re
from urllib.parse import quote

ENV = pathlib.Path(__file__).resolve().parents[1] / ".env.staging"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in ENV.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def split_owner_url(url: str) -> tuple[str, str, str, str]:
    """Return (user, password, host, database) from a postgres URL, tolerating @ in the password."""
    scheme, _, rest = url.partition("://")
    assert scheme.startswith("postgres"), "expected a postgres URL"
    userinfo, _, hostpart = rest.rpartition("@")
    user, _, password = userinfo.partition(":")
    host_and_port, _, database = hostpart.partition("/")
    host, _, _port = host_and_port.partition(":")
    return user, password, host, database


def main() -> None:
    values = read_env()
    owner_url = values["DATABASE_URL"]
    user, password, host, database = split_owner_url(owner_url)

    if not password:
        raise SystemExit("DATABASE_URL has no password; paste the full pooler string first")

    encoded = quote(password, safe="")
    session_url = f"postgresql://{user}:{encoded}@{host}:5432/{database}"
    runtime_password = values["PINNED_RUNTIME_PASSWORD"]
    runtime_user = f"qn_runtime.{user.split('.', 1)[1]}"
    transaction_url = (
        f"postgresql://{runtime_user}:{quote(runtime_password, safe='')}@{host}:6543/{database}"
    )

    text = ENV.read_text()
    text = re.sub(r"(?m)^DATABASE_URL=.*$", f"DATABASE_URL={session_url}", text)
    if re.search(r"(?m)^RUNTIME_DATABASE_URL=", text):
        text = re.sub(r"(?m)^RUNTIME_DATABASE_URL=.*$", f"RUNTIME_DATABASE_URL={transaction_url}", text)
    else:
        text = text.replace(
            "PINNED_RUNTIME_PASSWORD=",
            f"RUNTIME_DATABASE_URL={transaction_url}\nPINNED_RUNTIME_PASSWORD=",
            1,
        )
    ENV.write_text(text)

    print("DATABASE_URL           -> session pooler  (port 5432, owner role)")
    print("RUNTIME_DATABASE_URL   -> transaction pooler (port 6543, qn_runtime)")


if __name__ == "__main__":
    main()
