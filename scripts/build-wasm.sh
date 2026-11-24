#!/usr/bin/env bash
# Rebuild wasm/pkg (the committed extenddb-core bindings) from source.
# Needs Rust (rustup reads wasm/rust-toolchain.toml) and wasm-bindgen-cli at
# the version wasm/Cargo.toml pins. Only needed when wasm/ changes.
set -euo pipefail
cd "$(dirname "$0")/../wasm"

want=$(sed -n 's/^wasm-bindgen = "=\(.*\)"/\1/p' Cargo.toml)
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)
if [[ "$have" != "$want" ]]; then
  echo "wasm-bindgen-cli $want is required (found: ${have:-none})." >&2
  echo "Install it with: cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

cargo build --release --locked --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/keyway_extenddb.wasm
