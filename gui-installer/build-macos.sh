#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$project_root/.." && pwd)"
dist_dir="$repo_root/dist"
tauri_config_path="$project_root/src-tauri/tauri.conf.json"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS GUI packages must be built on macOS." >&2
  exit 1
fi

mkdir -p "$dist_dir"
cd "$project_root"

build_args=(tauri build --bundles dmg)
if [[ -n "${MACOS_TARGET:-}" ]]; then
  build_args+=(--target "$MACOS_TARGET")
fi
npx "${build_args[@]}"

product_name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["productName"])' "$tauri_config_path")"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$tauri_config_path")"
host_arch="$(uname -m)"
if [[ "${MACOS_TARGET:-}" == "universal-apple-darwin" ]]; then
  artifact_arch="universal"
  delivered_arch="universal"
else
  delivered_arch="$host_arch"
  case "$host_arch" in
    arm64) artifact_arch="aarch64" ;;
    x86_64) artifact_arch="x64" ;;
    *) artifact_arch="$host_arch" ;;
  esac
fi

if [[ -n "${MACOS_TARGET:-}" ]]; then
  bundle_dir="$project_root/src-tauri/target/$MACOS_TARGET/release/bundle/dmg"
else
  bundle_dir="$project_root/src-tauri/target/release/bundle/dmg"
fi
dmg_path="$(find "$bundle_dir" -maxdepth 1 -type f -name "${product_name}_${version}_${artifact_arch}.dmg" -print -quit 2>/dev/null || true)"
if [[ -z "$dmg_path" ]]; then
  dmg_path="$(find "$bundle_dir" -maxdepth 1 -type f -name "${product_name}_*.dmg" -print -quit 2>/dev/null || true)"
fi
if [[ -z "$dmg_path" ]]; then
  echo "DMG artifact not found under $bundle_dir" >&2
  exit 1
fi

delivered_dmg="$dist_dir/${product_name}-${version}-macos-${delivered_arch}.dmg"
cp -f "$dmg_path" "$delivered_dmg"

python3 - "$dist_dir/app-version.json" "$version" <<'PY'
import json
import os
import sys

path, version = sys.argv[1], sys.argv[2]
payload = {"latest_version": version}
download_url = os.environ.get("GUI_INSTALLER_DOWNLOAD_URL")
if download_url:
    payload["download_url"] = download_url
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False)
    fh.write("\n")
PY

if [[ -f "$project_root/checksums.json" ]]; then
  cp -f "$project_root/checksums.json" "$dist_dir/checksums.json"
else
  echo "Warning: checksums.json not found at $project_root/checksums.json; package integrity verification will be skipped at runtime" >&2
fi

find "$dist_dir" -maxdepth 1 \( -name "*.next*" -o -name "_tmp*" \) -exec rm -rf {} +

printf 'macOS DMG copied to %s\n' "$delivered_dmg"
