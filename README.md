# SQL Formatter

SQLを整形するシングルページアプリケーションです。Svelte 5 + Vite + Tailwind CSS v4 で構築されています。

## 機能

- **5つのSQLダイアレクト対応**: MySQL、PostgreSQL、Snowflake、Oracle (PL/SQL)、SQL Server (T-SQL)
- **整形オプション**:
  - インデントスタイル（Standard / Tabular Left / Tabular Right）
  - タブ幅（1〜8スペース or タブ文字）
  - キーワード・識別子・データ型・関数名の大文字/小文字変換
  - 論理演算子の改行位置（前 / 後）
  - 最大式幅・クエリ間空行数
  - Dense operators / セミコロン前改行
- **コンパクトモード**: SELECT/FROM/WHERE 句を1行にまとめ、EXTRACT(YEAR FROM ...) などの関数呼び出しを正しく整形
- **自動整形**: 入力変更のたびにリアルタイムで整形
- **設定の永続化**: すべての設定を localStorage に保存（ページ再読み込み後も維持）
- **日本語 / 英語 UI 切替**
- **キーボードショートカット**: Ctrl+Enter で整形

## セットアップ

```bash
npm install
npm run dev      # 開発サーバー起動 (localhost:5173)
npm run build    # プロダクションビルド → dist/
npm run preview  # ビルド成果物をローカルで確認
```

## 技術スタック

| | |
|---|---|
| UI フレームワーク | Svelte 5 (runes) |
| ビルドツール | Vite 8 |
| CSS | Tailwind CSS v4 |
| SQL 整形ライブラリ | sql-formatter 15 |
