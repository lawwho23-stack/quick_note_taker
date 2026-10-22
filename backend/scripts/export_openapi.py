"""Write the API's OpenAPI schema to backend/openapi.json (sorted keys, stable output).

The website generates its TypeScript API types from that file, so commit it
whenever a route or schema changes.

Usage (from backend/):
    uv run python scripts/export_openapi.py          # write openapi.json
    uv run python scripts/export_openapi.py --check  # exit 1 if it is out of date
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
OUTPUT = BACKEND_DIR / "openapi.json"


def build_schema() -> dict[str, Any]:
    # app.main builds the app at import time and needs settings; the values do
    # not change the schema, so placeholders are enough.
    os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
    os.environ.setdefault("SUPABASE_ANON_KEY", "openapi-export")
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

    from app.config import Settings
    from app.main import create_app

    settings = Settings(
        _env_file=None,
        supabase_url="http://localhost:54321",
        supabase_anon_key="openapi-export",
    )
    return create_app(settings).openapi()


def render(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if openapi.json is stale")
    args = parser.parse_args()

    text = render(build_schema())
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print("backend/openapi.json is out of date: run scripts/export_openapi.py")
            return 1
        print("backend/openapi.json is up to date")
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(BACKEND_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
