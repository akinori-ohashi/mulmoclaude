# chart-plugin：カードの幅が変わったらグラフを描き直す（#3511）

ECharts は `resize()` を呼んだときにしか入れ物を測り直さない。画面は `window` の `resize` でしか呼んでいなかったので、Canvas を広げる、ペインの境目を動かす、といった変化では描き直されなかった。

- 一つの `ResizeObserver` で、それぞれのグラフの入れ物を見る（`renderAll` で `observe`、`disposeAll` で `disconnect`）。
- `ResizeObserver` の無い環境では作らない。`window` の `resize` はそのまま残す。

## 確かめたこと

MulmoTerminal に手元でビルドしたものを入れ、ウィンドウの大きさを変えずに Canvas を広げて戻した。グラフの `canvas` の幅が、入れ物の幅に付いてきた（狭い → 広い → 狭い）。
