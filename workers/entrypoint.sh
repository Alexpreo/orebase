#!/bin/sh
set -e
if [ -n "$SSM_PREFIX" ]; then
  eval "$(uv run python load_ssm.py)"
fi
exec "$@"
