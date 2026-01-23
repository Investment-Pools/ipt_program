# Refi-pool

Solana Anchor program for the refi pool.

---

## Tech stack

| Layer | Tech |
|-------|------|
| **Blockchain** | Solana |
| **Program** | [Rust](https://www.rust-lang.org/) 2021, [Anchor](https://www.anchor-lang.com/) 0.29 (`anchor-lang`, `anchor-spl`) |
| **Tests & client** | [TypeScript](https://www.typescriptlang.org/) 5.x, [Anchor](https://www.anchor-lang.com/) TS SDK, [@solana/spl-token](https://spl.solana.com/token) |
| **Testing** | [Mocha](https://mochajs.org/) + [Chai](https://www.chaijs.com/), [ts-mocha](https://github.com/piotrwitek/ts-mocha) |
| **Tooling** | [Prettier](https://prettier.io/), [Cargo](https://doc.rust-lang.org/cargo/) |
| **Package managers** | [Yarn](https://yarnpkg.com/) (JS/TS), Cargo (Rust) |

---

## License

This project is licensed under the **Apache License, Version 2.0**.

- **SPDX identifier:** `Apache-2.0`
- **License file:** [`LICENSE`](./LICENSE) at the project root.

### SPDX headers in source code

Add an SPDX license identifier at the top of each source file so tooling and auditors can detect the license reliably.

**Rust (`.rs`):**

```rust
// SPDX-License-Identifier: Apache-2.0
```

**TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`):**

```ts
// SPDX-License-Identifier: Apache-2.0
```

**Guidance:**

- Place the SPDX line as the first line of the file, or immediately after a shebang (`#!/usr/bin/...`) if present.
- Use exactly `SPDX-License-Identifier: Apache-2.0` (no extra spaces, consistent casing).
- You may add a short copyright line below if desired, e.g.

Full terms are in **[`LICENSE`](./LICENSE)**.
