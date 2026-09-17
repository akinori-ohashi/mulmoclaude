# fix(remote-host): firebase の完全固定ピンを外す（#2835）

## 背景

#2912 で `firebase` を **キャレット無しの `12.16.0`** に完全固定した。`@firebase/auth`
1.13.4 が `IndexedDBLocalPersistence` に `visibilitychange` リスナーを足し、hidden な
document をページ破棄として扱うようになったためで、サインインのポップアップが元ウィンドウ
を背面に回すと `signInWithPopup` の資格情報書き込みが `Database is closing/hidden` で throw
していた。`_withRetries` は `isHiding` のとき rethrow するため回復経路が無い。

`12.16.0` は `@firebase/auth` 1.13.3 を同梱する最新の 12.x で、キャレットを外したのは
12.17.x に浮いて 1.13.4 に戻るのを防ぐためだった。

## 上流はもう直っている

各版の tarball を取得し、リグレッションのマーカー（`isHiding` フラグ / `closing/hidden`
の文言 / persistence 側の `visibilitychange` 登録）を dist の JS に対して grep した:

| `@firebase/auth` | マーカーを含む dist ファイル |
|---|---|
| 1.13.3 | 無し |
| 1.13.4 | 有り |
| 1.13.5 | 無し |
| 1.13.6 | 無し |

壊れていた版だけに出て前後の版には出ないので、grep 自体が効いていることも同時に確認できる。
再現コマンドは「確認」節に置いた。

インストール済み 1.13.6 の実装でも裏が取れている。`IndexedDBLocalPersistence` が登録する
のは `pagehide` / `pageshow` だけで、`_openDb()` は条件無しに開く。フラグは `isClosing` に
変わり、ポーリングの開始・停止の制御にしか使われない。`_withRetries` はリトライする。

## 現状

`firebase` は 2026-09-13 の定期 dep 更新（`1d0d52b2a`）で `12.16.0` → `12.19.0` に上がって
いた。#2835 には触れていないルーチン更新で、`12.19.0` は npm の latest、同梱する
`@firebase/auth` は 1.13.6。つまり**修正版は既にツリーに入っている**。

残っているのはピンの形だけで、root と launcher の双方がキャレット無しのまま。ピンを置いた
理由は消えている。

## やること

- `package.json` と `packages/mulmoclaude/package.json` の `firebase` を `^12.19.0` にする。
  `server/remoteHost/` は実行時に `firebase` を launcher から解決するので、両方揃える必要が
  ある（ピンを置いたときと同じ理由）。
- `yarn.lock` の当該 stanza のキーを新しいレンジに合わせる。解決先の版は動かさない。
- `docs/CHANGELOG.md` の Unreleased にピンを外した旨を書く。過去のリリース節にある #2835 の
  記述は、そのリリースで実際に出荷した内容なので書き換えない。
- `packages/core` の optional peer は `firebase: ^12.0.0` のままでよい。

`src/config/firebase.ts` は既定の persistence のままにする。issue が提案していた
`inMemoryPersistence` 化は、SDK が直った今は回避策であって必要な変更ではない。

## 確認

上流の差分（マーカーの有無）:

```sh
for v in 1.13.3 1.13.4 1.13.5 1.13.6; do
  url=$(npm view @firebase/auth@$v dist.tarball)
  curl -sL "$url" | tar xz -C "auth-$v" --strip-components=1
  grep -rl --include='*.js' "isHiding" "auth-$v/dist" | wc -l
done
```

解決先が動いていないこと:

```sh
node -p "require('firebase/package.json').version"          # 12.19.0
node -p "require('@firebase/auth/package.json').version"    # 1.13.6
```

`yarn install --frozen-lockfile` が通ること、および lint / build / typecheck。

**実サインインは未確認。** Google アカウントが要るので、リモートホストの「Google でサイン
イン」を通しで踏む確認はこの変更では取れていない。#2835 はそれが取れてから閉じる。
