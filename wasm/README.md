# keyway-extenddb

WASM bindings over [`extenddb-core`](https://github.com/ExtendDB/extenddb), so
Keyway can use real DynamoDB expression semantics in the browser instead of
re-implementing them. Only the pure `core` crate is used (no server, storage, or
network code), and it is pulled straight from upstream, pinned to a tag: no fork.

Values cross the boundary as DynamoDB wire JSON (`{"S":"x"}`, `{"N":"1"}`).

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.118 --locked
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg target/wasm32-unknown-unknown/release/keyway_extenddb.wasm
```

```bash
cargo test   # native unit tests
```

## License

This crate is MIT, like Keyway. `extenddb-core` is Apache-2.0; any build that
ships the compiled `.wasm` must carry ExtendDB's `LICENSE` and `NOTICE`.
