#!/usr/bin/env bash
# Compiles the macOS helpers. Re-run after editing the .swift files.
set -euo pipefail
cd "$(dirname "$0")"
for t in facedet personmatte persontrack; do
  if [ ! -x "$t" ] || [ "$t.swift" -nt "$t" ]; then
    echo "building $t..."
    swiftc -O "$t.swift" -o "$t"
  fi
done

# The transcriber is an app bundle, so macOS asks for speech-recognition
# permission in its own name (see transcribe.swift).
app="Transcribe.app"
bin="$app/Contents/MacOS/transcribe"
if [ ! -x "$bin" ] || [ transcribe.swift -nt "$bin" ] || [ Transcribe-Info.plist -nt "$bin" ]; then
  echo "building $app..."
  mkdir -p "$app/Contents/MacOS"
  cp Transcribe-Info.plist "$app/Contents/Info.plist"
  swiftc -O transcribe.swift -o "$bin"
  codesign --force --sign - "$app" >/dev/null 2>&1 || true
fi
echo "tools ready"
