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

# Panic messages embed source paths. Remap the machine-specific prefixes
# (cargo home, this checkout) to fixed names so the binary is identical on
# every machine, and no local paths ship with the site.
cargo_home=$(cd "${CARGO_HOME:-$HOME/.cargo}" && pwd -P)
export RUSTFLAGS="--remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$(pwd -P)=/keyway"
cargo build --release --locked --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/keyway_extenddb.wasm
