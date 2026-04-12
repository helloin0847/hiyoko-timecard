# kitchen ひよこ タイムカード

## プロジェクト概要

kitchen ひよこ（本店・east・ASAHI）3店舗共通のタイムカードシステム。
Google Apps Script（GAS）+ HTMLで動作するWebアプリ。

## ファイル構成

```
hiyoko-timecard/
├── Code.gs       # GASバックエンド（スプレッドシート操作・API）
├── index.html    # フロントエンド（打刻UI・集計・設定）
└── README.md     # このファイル
```

## デプロイ先

- Google Apps Script プロジェクト
- スプレッドシートにバインドされたコンテナバインド型

## スプレッドシート構成

### 従業員マスタシート（`従業員マスタ`）
| 列 | フィールド |
|----|-----------|
| A  | 管理番号 |
| B  | 氏名 |
| C  | 読み仮名 |
| D  | 社員番号 |
| E  | ソート順 |
| F  | 有効 |
| G  | 店舗 |
| H  | 入社日 |
| I  | 退職日 |
| J  | 雇用形態（正社員/アルバイト）|

### 打刻記録シート（`打刻記録`）
| 列 | フィールド |
|----|-----------|
| A  | ID（UUID）|
| B  | 日付 |
| C  | 管理番号 |
| D  | 氏名 |
| E  | 店舗 |
| F  | 区分（仕込/営業）|
| G  | 出勤時刻（実打刻）|
| H  | 退勤時刻（実打刻）|
| I  | 勤務分数（実）|
| J  | 修正フラグ |
| K  | 修正メモ |
| L  | 社員番号 |
| M  | 丸め出勤 |
| N  | 丸め退勤 |
| O  | 丸め分数 |
| P  | 削除フラグ |

## APIアクション一覧

| action | 説明 |
|--------|------|
| `getEmployees` | 従業員マスタ取得 |
| `saveEmployees` | 従業員マスタ保存 |
| `punchIn` | 出勤打刻 |
| `punchOut` | 退勤打刻 |
| `getOpenRecords` | 出勤中レコード取得 |
| `getRecords` | 打刻記録取得（フィルタ対応）|
| `updateRecord` | 打刻修正（丸め再計算含む）|
| `deleteRecord` | 打刻削除 |
| `getDailySummary` | 日次集計 |
| `getShiftSummary` | シフト期間集計 |
| `getCalendarData` | 勤務表用データ取得 |
| `getMonthlyCsv` | 月次CSV出力（FileMaker連携）|
| `cleanupDeleted` | ソフトデリート済み行の物理削除 |

## 主な仕様

- 締め日：毎月20日（前月21日〜当月20日）
- 給与支払日：締め日+6日
- 丸め設定：出勤・退勤それぞれ独立（分単位・切上/切捨/四捨五入）
- 区分：仕込（〜15:59自動）/ 営業（16:00〜自動）、手動切替可
- 集計は丸め分数優先、なければ実分数を使用
- CSVはFileMaker・PCA給与DX連携用（社員番号・時間は小数形式）

## 丸め設定の保存場所

- `localStorage` キー：`hiyoko_round`
- 各iPadのブラウザに個別保存（全店舗共通設定ではない）

## URLパラメータ

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| `?store=本店` | 本店/east/ASAHI | 店舗固定（iPad用ブックマーク）|

## 開発メモ

- GASの `google.script.run` を使用（fetchではない）
- HTMLはGASテンプレートとして `doGet()` で返す
- `<?= store ?>` でGASからHTMLに店舗名を埋め込む想定
- ダークモード対応済み（CSS変数 + `prefers-color-scheme`）
- 現バージョン：v8
