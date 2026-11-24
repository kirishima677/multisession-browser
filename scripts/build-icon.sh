#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOSのsipsとiconutilが必要です。" >&2
  exit 1
fi
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
icon_source="$project_dir/assets/icon-source-clean.png"
icon_temp="$(mktemp -d "${TMPDIR:-/tmp}/multisession-icon.XXXXXX")"
trap 'rm -rf "$icon_temp"' EXIT
icon_set="$icon_temp/Multisession.iconset"
mkdir -p "$icon_set"
sips -z 1024 1024 "$icon_source" --out "$project_dir/assets/icon.png" >/dev/null
for icon_size in 16 32 128 256 512; do
  sips -z "$icon_size" "$icon_size" "$project_dir/assets/icon.png" --out "$icon_set/icon_${icon_size}x${icon_size}.png" >/dev/null
  retina_size="$((icon_size * 2))"
  sips -z "$retina_size" "$retina_size" "$project_dir/assets/icon.png" --out "$icon_set/icon_${icon_size}x${icon_size}@2x.png" >/dev/null
done
iconutil -c icns "$icon_set" -o "$project_dir/assets/icon.icns"
echo "Generated assets/icon.png and assets/icon.icns"
