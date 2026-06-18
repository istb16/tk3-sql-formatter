# Grill: コンパクトモードでのサブクエリ折りたたみ
Date: 2026-06-18

## Intent
コンパクトモード時、短いサブクエリ（インラインの `(SELECT ...)`）を1行に畳みたい。
現状は `SELECT` を含む `(...)` ブロックを一律に展開したままにしているため、短いサブクエリでも複数行になってしまう。

## Constraints
- CTE（`WITH name AS (...)`）は常に展開のまま（可読性のため）
- 畳む基準は expressionWidth（既存設定値）を流用
- 判定は「畳んだときの行全体の長さ」が expressionWidth 以内かどうか
- 節数（SELECT+FROM のみ か WHERE も含むか等）は問わない

## Key decisions
- Decision: 行全体の長さで判定。 Reason: 「画面に表示される1行の長さ」で判断するほうが見た目のコンパクトさに直結する。 Alternative considered: サブクエリ部分だけで判定（シンプルだが行全体が長くなっても気づかない）。
- Decision: CTE は展開のまま。 Reason: CTE はそもそも可読性のために名前をつける構造なので、畳むと意図が失われる。 Alternative considered: インラインサブクエリと同じ基準で畳む。
- Decision: expressionWidth の範囲を 50–200 に変更。 Reason: ユーザー指定。現行は 20–120。

## Surfaced assumptions
- `expressionWidth` を 9999 にして sql-formatter の折り返しを抑制している（コンパクトモード時）が、後処理の閾値判定には元の設定値を使う必要がある。
- CTE の `(` は `... AS (` という形で現れるため、正規表現でプレフィックスの末尾を見れば判別できる。
