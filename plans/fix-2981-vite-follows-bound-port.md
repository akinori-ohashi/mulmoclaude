# fix: Vite の proxy 先を backend が実際に bind したポートへ追従させる (#2981 / #2650)

## 背景

`server/index.ts` の `resolvePort()` は、`PORT` が暗黙かつ既定の 3001 が塞がっているとき
**次の空きポートへ歩く**。一方 Vite の proxy 先は `vite.config.ts` の評価時 —— 別プロセス、
かつ backend が歩く前 —— に `PORT` から決まるので、**両者が別のポートを指す**。

`resolvePort()` 自身のコメントがこの穴を記録している:

> Warn, not info: the dev client is NOT following. (…) so a second `yarn dev` started
> without `PORT` ends up rendering the FIRST instance's data, with nothing failing (#2650).

#2975 / PR #2977 はこの状態を**検出**して起動を止めるところまで入れた。本 issue はその
**本体**で、検出が不要になるように「追従」させる。

## 鍵になる事実（既に揃っている材料）

1. **backend は実際に bind したポートを既に公表している。** `server/index.ts` は `app.listen`
   直後に `<workspace>/.server-port` を書く。コメントも «the requested PORT may have walked
   forward off a busy default» と、まさにこの用途を述べている。
2. **順序が保証されている。** `yarn dev` の client pane は `yarn wait:backend && vite`。
   waiter は backend が上がるまで返らないので、**Vite が起動する時点で `.server-port` には
   この run の実ポートが入っている**。
3. **帰属も既に解決済み。** `yarn dev` は両 pane の起動前に `wait:backend --reset` で
   `.server-port` を消す。以後そこに在るファイルはこの startup のもの。

つまり Vite は「読むだけ」で追従できる。新しい配管は要らない。

## 設計

### 現状（検出）

```
waiter : PORT 由来のポートを待つ → .server-port と突き合わせ → 食い違えば exit 1
vite   : PORT 由来のポートへ proxy
```

### 変更後（追従）

```
waiter : この run の .server-port の publish を待つ → 実ポートを読む → そのポートが accept するまで待つ
vite   : .server-port を読み、そこへ proxy（読めなければ PORT 由来へフォールバック）
```

**食い違いという状態が存在しなくなる。**

### 触るもの

- `scripts/lib/devServerPort.ts` — `resolveProxyTarget(publishedRaw, resolution)` を追加。
  「公表された実ポート」と「`PORT` 由来のフォールバック」のどちらを使うかを**1 箇所**で決める
  （このモジュールの既存方針どおり、`PORT` について第 2 の意見を持たせない）。
- `vite.config.ts` — `.server-port` を読んで proxy 先に使う。
- `scripts/wait-for-backend.ts` — 待つ対象を反転（publish → 実ポート → accept）。
- `package.json` — `--reset` はそのまま必要（帰属のため）。

### 削除できるもの

追従すれば食い違いが起きないので、PR #2977 が入れた**検出と拒否は不要**になる:

- `reportMismatch` と **`exit 1`**（#2977 で入った唯一の挙動変更が消える）
- `backendPairing.ts` の `decideReadiness` / `classifyBoundPort` の mismatch 意味論

`wasRepublished`（帰属）と `waitForPort`（待機）は引き続き必要。

### 副産物: `PORT=0` が使えるようになる

`assertProxyablePort` は「0 は OS 任せで config 時に知りようがない」として起動を拒否している。
`.server-port` があれば **config 時に知れる**ので、この拒否は「公表が無かったとき」だけに縮む。

## 検証

- `test/scripts/test_devServerPort.ts` に `resolveProxyTarget` の表を追加
  （公表あり / 壊れた公表 / 公表なし / `PORT=0` + 公表あり）
- `test/config/test_viteDevProxy.ts` — proxy 先が公表ポートに追従することを固定
- `test/scripts/test_waitForBackendCli.ts` — 反転後の CLI（publish 待ち → 実ポート待ち）
- **実機**: 3001 を別プロセスに握らせた状態で `yarn dev` を起動し、
  backend が 3002 へ歩き、**Vite が 3002 へ proxy して 200 が返る**ことを確認する。
  これが「追従できている」の外部 ground truth。

## やらないこと

- backend が走行中にポートを変えた場合の追随（`vite.config.ts` は起動時に 1 度だけ評価される）。
  supervisor による再起動は通常同じポートを取り直すので、現状と同じ。
