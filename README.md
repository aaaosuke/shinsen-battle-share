# 真戦 戦闘ログ共有サイト

Base44を使わないNode.js/Express製の試作サイトです。

## 機能
- 複数画像アップロード
- 戦闘ID・分類・メモ
- サーバー上の画像保存
- 画像ごとの直接公開URL
- 検索
- 管理者パスワード付き削除
- JSON出力

## 起動
Node.js 20+ を用意し、このフォルダで

npm install
npm start

ブラウザで http://localhost:3000

## オンライン公開
Render / Railway / Fly.io / VPS等のNode.js対応環境に配置できます。
環境変数 PUBLIC_BASE_URL を公開URLに設定すると、画像URLが完全なURLになります。

本番ではuploadsを永続ディスクまたはS3/R2等へ移すことを推奨します。

## 次の段階
OCR → 戦闘ログDB → ダメージ式推定 → 全武将/戦法DB → 編成シミュレーター
