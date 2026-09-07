# fix(dev): #2928 — Vite dev proxy に `/htmlfile` が無い

Issue: #2928 · 同型の先行修正: receptron/mulmoterminal#1758 / #1775

## 症状（再現済み）

`yarn dev` で `artifacts/html/` の**外**にある HTML を presentHtml で開くと、View の枠は出るが
iframe が空白になる。sandboxed iframe（opaque origin）が Vite の注入した `@vite/client` を
読もうとして CORS で落ちる。

backend を起動せず Vite だけを上げて経路差を確認（`npx vite --port 45999 --strictPort`）:

```text
/artifacts/html/x.html   -> 502   （proxy されている = backend 不在なので 502）
/api/config              -> 502
/htmlfile/abs/tmp/x.html -> 200   <!DOCTYPE html> …  ← SPA catch-all の index.html
/htmlfile/ws/docs/x.html -> 200   <!DOCTYPE html> …
```

## 到達経路

`presentHtml` に `artifacts/` 外のパスを渡す → `src/plugins/presentHtml/index.ts` は
`previewUrl` を注入しない → View が `htmlArtifactPreviewUrl()` → `htmlFileUrl()` →
`/htmlfile/<scope>/…` を iframe の `src` にする → proxy に無いので Vite が index.html を返す。

## 直し方（issue の A + C を採用）

### A. proxy エントリを足す

`/artifacts/html` と同じ形。`xfwd: true` が要る理由は同じで、`changeOrigin: true` が `Host` を
backend のものに書き換えるため、`browserVisibleOrigin(req)` が `X-Forwarded-*` を読めないと
CSP が誤った origin を広告する。`/htmlfile` は document だけでなく subresource（画像・メディア）も
配信するので、この origin は実際に効く（`server/index.ts` の非 document 拡張子は `res.sendFile`）。

### A の必須の随伴: LAN ガードにも足す

issue には書かれていなかったが、`vite.config.ts` には proxy 表と別に
`PROXIED_BACKEND_PREFIXES` があり、`MULMOCLAUDE_DEV_LAN=1` のとき非 loopback からの
アクセスを 403 にしている。既存コメントが
「a prefix added there without being added here is reachable from the LAN」
と明記しているとおり、**proxy にだけ足すと LAN 露出になる**。`/htmlfile` は
`/artifacts/*` と同じく bearer 免除（iframe の `src` は Authorization を送れない）なので、
ガード側にも足すのが必須。

### C. 回帰テスト `test/config/test_viteDevProxy.ts`

prefix のリストを二度書かず、**View が実際に組み立てる URL** を実際の proxy 表に当てる:

1. `htmlArtifactPreviewUrl()` / `htmlFileUrl()` が返す URL が proxy のどれかに前方一致する
2. proxy の全キーが `PROXIED_BACKEND_PREFIXES` のどれかに覆われている（LAN ガードの drift 防止）

2 のために `PROXIED_BACKEND_PREFIXES` を named export にする（Vite は default export しか見ない）。

### 付随: `__dirname` → `import.meta.dirname`

テストから `vite.config.ts` を素の ES module として import するために必要。
`__dirname` は ESM に存在せず、Vite が自前のローダで shim しているだけで、
Vite 自身が起動時に「`configLoader: 'native'` では未対応」と警告している。
`engines.node >= 20.12` なので `import.meta.dirname` は使える。

B（`HTML_FILE_MOUNT` を import してリテラル重複をやめる）は**採らない**。
`@mulmoclaude/html-plugin` は `build:packages` 前に存在しない workspace パッケージで、
config ロード時に引くとクリーンクローンの `yarn dev` が落ちる。

## 検証

- backend 無しの Vite 単体で 4 経路を再測定し、`/htmlfile/*` が 502（= proxy された）になること
- `MULMOCLAUDE_DEV_LAN=1` で LAN IP から `/htmlfile/…` が 403 になること（loopback からは通ること）
- 修正を外すと新テストが落ちること
- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`
