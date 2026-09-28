# Windows の `lint_test` を緑に戻す（#3251）

## 症状と原因

`test/system/test_secrets.ts` の "writes owner-only" が Windows で `438 !== 384`
（`0o666` vs `0o600`）で落ちる。main では #3238 のマージ以降ずっと赤。

実装は正しく `0o600` / `0o700` を要求している。**Windows が POSIX の mode を
表現しない**ため、Node は読み取り専用ビットしか扱えず、書き込み可能なファイルの
`statSync().mode & 0o777` は常に `0o666` を返す。要求した mode は無視される。

つまりテスト側の移植性の問題で、POSIX 上のセキュリティ性質そのものは満たされている。

## 直し方

1. mode の assertion を **POSIX 限定** にする（`testCtx.skip`）。
   `test/journal/test_appendOrCreate.ts:75` に同じ形の先例がある
2. **Windows でも真であることを別のテストで固定する** — 秘密がユーザーの home
   配下（`secretsDir(home)`）に書かれていること。skip しただけだと「どこに書くか」を
   何も押さえないテストファイルになってしまう
3. `server/system/secrets.ts` のコメントを直す。`0600` とだけ書いてあると全
   プラットフォームで強制されていると読める。**Windows での保護はプロファイルの
   ACL であって mode ではない**、と明記する

## 非目標

- Windows で `icacls` を叩いて ACL を設定しにいくこと。別の判断
- #3238 の他の部分

## 検証

- `npx tsx --test test/system/test_secrets.ts` が POSIX で緑（mode の assertion は
  従来どおり走る）
- Windows は CI で確認する。手元に Windows が無いので、そこがこの PR の
  **確かめられていない側**
