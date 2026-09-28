# robust-predicates (vendored, orient2d only)

Robust geometric predicates (Shewchuk's adaptive arithmetic), a dependency of `vendor/delaunator`.
Only `orient2d` is vendored because that is all delaunator imports.

| | |
|---|---|
| Package | `robust-predicates@3.0.3` |
| Source | <https://github.com/mourner/robust-predicates> (npm: <https://www.npmjs.com/package/robust-predicates>) |
| Tarball | `https://registry.npmjs.org/robust-predicates/-/robust-predicates-3.0.3.tgz` |
| sha1 (shasum) | `1099061b3349e2c5abec6c2ab0acd440d24d4062` |
| integrity | `sha512-NS3levdsRIUOmiJ8FZWCP7LG3QpJyrs/TE0Zpf1yvZu8cAJJ6QMW92H1c7kWpdIHo8RvmLxN/o2JXTKHp74lUA==` |
| Licence | Unlicense (public domain), see [LICENSE](LICENSE) |

## Files

- `orient2d.js`: `esm/orient2d.js` from the package, unmodified (it imports `./util.js`).
- `util.js`: `esm/util.js` from the package, unmodified.
- `LICENSE`: copied from the package.
