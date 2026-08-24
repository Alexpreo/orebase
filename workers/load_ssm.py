"""Load `/orebase/*` SSM parameters into the process environment.

Prints `export KEY='value'` lines for the Docker entrypoint to eval.
No-op when SSM_PREFIX is empty so local `uv run` is unchanged.
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    prefix = os.environ.get("SSM_PREFIX", "").strip()
    if not prefix:
        return 0
    try:
        import boto3
    except ImportError:
        print("boto3 is required to load SSM parameters", file=sys.stderr)
        return 1
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
    client = boto3.client("ssm", region_name=region)
    paginator = client.get_paginator("get_parameters_by_path")
    for page in paginator.paginate(Path=prefix, Recursive=True, WithDecryption=True):
        for param in page.get("Parameters") or []:
            name = str(param.get("Name") or "").rsplit("/", 1)[-1]
            if not name:
                continue
            value = str(param.get("Value") or "").replace("'", "'\"'\"'")
            print(f"export {name}='{value}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
