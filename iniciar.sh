#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  exec python3 servidor.py
fi

if command -v python >/dev/null 2>&1; then
  exec python servidor.py
fi

echo "No se encontró Python 3."
echo "Instálalo desde https://www.python.org/downloads/ y vuelve a intentarlo."
exit 1
