#!/usr/bin/env bash
# Compiles the two macOS Vision helpers. Re-run after editing the .swift files.
set -euo pipefail
cd "$(dirname "$0")"
for t in facedet personmatte; do
  if [ ! -x "$t" ] || [ "$t.swift" -nt "$t" ]; then
    echo "building $t..."
    swiftc -O "$t.swift" -o "$t"
  fi
done
echo "tools ready"
