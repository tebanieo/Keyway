# keyway-extenddb

WASM bindings over [`extenddb-core`](https://github.com/ExtendDB/extenddb), so
Keyway can use real DynamoDB expression semantics in the browser instead of
re-implementing them. Only the pure `core` crate is used (no server, storage, or
network code), and it is pulled straight from upstream, pinned to a tag: no fork.

Values cross the boundary as DynamoDB wire JSON (`{"S":"x"}`, `{"N":"1"}`).

## Build

The built bindings in `pkg/` are **committed**, so working on the app needs no
Rust. Rebuild them only when something in `wasm/` changes:

```bash
cargo install wasm-bindgen-cli --version 0.2.118 --locked   # once
npm run wasm:build
```

The toolchain is pinned (`rust-toolchain.toml`) and the build is reproducible,
so CI rebuilds `pkg/` from source and fails if it differs from what's committed:
the shipped binary is provably built from this source.

```bash
cargo test   # native unit tests
```

## License

This crate is MIT, like Keyway. `extenddb-core` is Apache-2.0: its `LICENSE` and
`NOTICE` ship with the site under `public/licenses/extenddb/`.
