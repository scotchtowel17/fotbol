# delaunator (vendored)

Fast 2D Delaunay triangulation, used by `js/engine/formation.js` to triangulate the formation table's ball samples.

| | |
|---|---|
| Package | `delaunator@5.1.0` |
| Source | <https://github.com/mapbox/delaunator> (npm: <https://www.npmjs.com/package/delaunator>) |
| Tarball | `https://registry.npmjs.org/delaunator/-/delaunator-5.1.0.tgz` |
| sha1 (shasum) | `d13271fbf3aff6753f9ea6e235557f20901046ea` |
| integrity | `sha512-AGrQ4QSgssa1NGmWmLPqN5NY2KajF5MqxetNEO+o0n3ZwZZeTmt7bBnvzHWrmkZFxGgr4HdyFgelzgi06otLuQ==` |
| Licence | ISC, see [LICENSE](LICENSE) (Copyright (c) 2026, Mapbox) |

## Files

- `index.js`: the package's ES module entry, byte-for-byte except one line: the bare import
  `import {orient2d} from 'robust-predicates';` is rewritten to
  `import {orient2d} from '../robust-predicates/orient2d.js';` so it loads in the browser and Node without a bundler.
- `LICENSE`: copied from the package.

## Updating

```bash
npm pack delaunator@5 robust-predicates@3     # in a scratch directory, never in the repo
tar xzf delaunator-*.tgz && cp package/index.js <repo>/vendor/delaunator/index.js
# re-apply the one-line import rewrite above, update this table, run: node --test tests/formation.test.js
```
