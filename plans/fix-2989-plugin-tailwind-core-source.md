# fix(build): core が名前を持つ Tailwind クラスを plugin の dist/style.css に出す (#2989)

## 症状（実測）

`packages/core/src/collection/core/enumColors.ts` にしかリテラルが無い Tailwind クラスが、
`collection-plugin` のパッケージビルドが出す `dist/style.css` に入らない。

パレットが名前を持つ **76 クラス中 43 が欠落**していた（issue 本文の 3 例より広い）。
欠落分には enum の配色だけでなく、通知 enum の重要度色（`bg-red-500` / `text-red-700` /
`bg-amber-100` / `bg-amber-500` / `bg-slate-300`）も含まれる。

## 原因

Tailwind v4 の自動コンテンツ検出は **CSS エントリから見た「プロジェクト」** を走査する。

- ホスト: vite の root がリポジトリルート → `packages/core/src` まで走査される → クラスが出る
- プラグイン: vite の root がそのパッケージ → `packages/plugins/<name>/src` しか走査されない
  → core 由来のクラスは誰も見ていないので落ちる

`packages/plugins/collection-plugin/vite.config.ts` のコメントが
「node_modules はホストの走査対象外なので、パッケージは自分のクラスを自分で出荷する」と
書いているとおりで、その理屈は **core にも当てはまるのに core だけ抜けていた**。

## 対処（issue の案 1 / 狭い @source + ガード）

1. `packages/plugins/collection-plugin/src/style.css` に、パレットのファイルを名指しする
   `@source` を 1 行足す。

   実測: 欠けていた 43 クラスが全部出るようになり、増えたのは +4.5 KB（パレット本体のみ）。
   ディレクトリごと（`@source "../../../core/src"`）だと `contents` `grow` `ring` `static`
   など **無関係な語をクラスとして拾って** 8 個ほど余計に emit されるため、ファイル名指しを採る。

2. ガード: `scripts/packages/check-plugin-tailwind-source.mjs` を追加し、CI に入れる。

   規則: **core のソースに Tailwind の配色クラスが書かれていて、そのファイルの export を
   使っているプラグインは、そのファイルを覆う `@source` を自分の CSS に持っていなければならない。**

   これで #2987（コレクション／フィードのアクセントカラーを core に置く予定）が同じ穴に
   落ちたとき、目視ではなく CI が落ちる。

## 採らなかった案

- **共有 CSS パーシャルに集約**: 将来 1 箇所で済むが、パレットを描画しないプラグインにも
  4.5 KB の未使用 CSS が乗る。今日クラスを描画しているのは collection-plugin だけ。
- **core が CSS を出力する（案 2）**: 依存の向きは正しいが core に Tailwind ビルドが増え、
  ホストとプラグインで同じ CSS が二重化する。
- **トークン化（案 3）**: 最も筋が良く、将来の方向としては残す。ただし 8 色 × 4 用途と
  その全呼び出し側の移行になり、この不具合の修正としては大きすぎる。

## 検証

- `collection-plugin` を再ビルドし、パレット 76 クラスが `dist/style.css` に全部あることを確認
- ガードを、@source を消した状態で走らせて **落ちること** を確認（規則が本当に効いているか）
- 純粋関数（クラス抽出 / export 抽出 / @source 抽出 / 被覆判定 / 規則本体）に単体テスト
