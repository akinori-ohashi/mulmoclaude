# 表計算のヘルプの関数一覧を登録済みの関数に合わせる（#3500）

## 方針
- `packages/core/assets/helps/spreadsheet.md` の「Available Functions」を、内蔵エンジン（`src/plugins/spreadsheet/engine`）の registry の分類と関数（`getFunctionsByCategory()`）に合わせる。ほかの関数名は `#NAME?` になることも書く
- `test/plugins/spreadsheet/test_helpFunctions.ts` で、次がずれたら落ちる
  - ヘルプの分類ごとの一覧 = registry（両方向）
  - ヘルプの数式の例が呼ぶ関数はすべて登録済み
- `assets/helps` を変えるので `@mulmoclaude/core` を 5.11.4 に上げ、依存範囲を `^5.11.4` にそろえる（これまでのヘルプ変更と同じ形）

## 確かめたこと
ヘルプを元に戻す、一覧に未登録の関数を足す、例に未登録の関数を足す、の 3 通りでテストが落ちる。

## 同じずれ
receptron/GUIChatPluginSpreadsheet#59（README の一覧）。そちらも同じ形のテストで止めた。
