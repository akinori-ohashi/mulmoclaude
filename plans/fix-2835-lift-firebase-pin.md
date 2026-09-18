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

`firebase` は 2026-09-13 の定期 dep 更新（`1d0d52b2a`）で、修正済みの `@firebase/auth` を
同梱するラインへ既に上がっていた。#2835 には触れていないルーチン更新。つまり**修正版は既に
ツリーに入っている**。

残っているのはピンの形だけで、root と launcher の双方がキャレット無しのまま。ピンを置いた
理由は消えている。ちなみにこの `firebase` が、両マニフェストに残っていた**最後の完全固定
ピン**だった（`git show origin/main:package.json` と現在の `package.json` の双方で、
`dependencies` / `devDependencies` の完全固定を数えれば確認できる）。キャレットに戻すことは
リポジトリ内の他の依存の宣言の仕方に揃える動きでもある。

## やること

- `package.json` と `packages/mulmoclaude/package.json` の `firebase` を `^12.19.0` にする。
  `server/remoteHost/` は実行時に `firebase` を launcher から解決するので、両方揃える必要が
  ある（ピンを置いたときと同じ理由）。
- `yarn.lock` の当該 stanza のキーを新しいレンジに合わせる。コミット済み lockfile から解決
  される版は動かさない。
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
  rm -rf "auth-$v" && mkdir -p "auth-$v"
  curl -sL "$url" | tar xz -C "auth-$v" --strip-components=1
  grep -rl --include='*.js' "isHiding" "auth-$v/dist" | wc -l
done
```

コミット済み lockfile からの解決先が動いていないこと。変更の前後で同じ版が返ることを見る
もので、特定の版番号を期待する検査ではない:

```sh
yarn install --frozen-lockfile
node -p "require('firebase/package.json').version"
node -p "require('@firebase/auth/package.json').version"
```

root と launcher のレンジがずれたら CI が落ちること（`scripts/mulmoclaude/launcherSync.mjs`
の invariant 1）。片方だけを完全固定に戻して `yarn check:launcher-sync` を走らせると、
`root-launcher-mismatch` が `firebase` を名指しして非ゼロ終了する。

lint / build / typecheck は CI に委ねる（ソースの変更が無く、解決される依存ツリーも同一）。

## このキャレットが今後に何を許すか

「解決先の版は動かない」は**コミット済み lockfile からの解決に限った話**で、ここを曖昧に
しない。消費者の種類ごとに結論が違う:

| 消費者 | このキャレットで何が変わるか |
|---|---|
| このリポジトリ、コミット済み lockfile で `--frozen-lockfile` | 何も変わらない。lockfile が版を固定している |
| このリポジトリ、lockfile を作り直す install | レンジを満たす 12.x のうち、その時点の最新を引く |
| npm で launcher を入れる利用者（lockfile を持たない） | 同上。**ここが実質的な変更点** |

3 行目が本題で、完全固定のときは常に同じ版が入っていた。**次の firebase リリース以降、npm
利用者にはこのリポジトリでレビューを経ないものが入る。** それは意図した効果であって、
「上げても何も変わらない」という話ではない。

そのうえで、**同じ種類のリグレッションが将来の 12.x で再発しても CI は検知しない。**
自動テストは存在せず、実サインインを踏むか、依存の canary を別途仕立てるしかない。それを
承知のうえでキャレットに戻す判断をしている。根拠は、リポジトリの他の依存がすべてキャレット
であること、および完全固定は「黙って更新を止める」側の害が大きいこと。

**実サインインは未確認。** Google アカウントが要るので、リモートホストの「Google でサイン
イン」を通しで踏む確認はこの変更では取れていない。#2835 はそれが取れてから閉じる。
