# Bundled maps

Both files come from [Natural Earth](https://www.naturalearthdata.com/), which is in the public
domain ("No permission is needed to use Natural Earth. Crediting the authors is unnecessary."),
taken from [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) at
commit `ca96624a56bd078437bca8184e78163e5039ad19`.

| file | source | kept |
|---|---|---|
| `world.json` | `geojson/ne_110m_admin_0_countries.geojson` | `NAME` → `name`, `NAME_JA` → `name_ja`; coordinates rounded to 2 decimals |
| `japan.json` | `geojson/ne_10m_admin_1_states_provinces.geojson`, features with `adm0_a3 == "JPN"` | `name` without diacritics (Ōita → Oita) → `name`, `name_ja` → `name_ja`; coordinates rounded to 3 decimals |

Every other property is dropped and features are sorted by `name`. The plugin registers each
file twice: `world` / `japan` named by `name`, and `world-ja` / `japan-ja` by `name_ja`
(`src/core/extensions.ts`).

To rebuild, for each feature keep `{ type, properties: { name, name_ja }, geometry: { type,
coordinates } }` as above, round every coordinate, and write compact JSON with non-ASCII kept.
`test/plugins/chart/test_chartExtensions.ts` checks the result: named polygons of finite points,
unique names in both languages, the 47 prefectures with plain-ASCII English names.
