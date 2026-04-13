# kitchen ひよこ タイムカード

## プロジェクト概要

kitchen ひよこ（本店・east・ASAHI）3店舗共通のタイムカードシステム。
Supabase + 単一HTMLファイルで動作する静的Webアプリ。GitHub Pagesでホスティング。

## ファイル構成

```
hiyoko-timecard/
├── index.html                    # フロントエンド（打刻UI・集計・設定・Supabase接続）
├── Code.gs                       # 旧GASバックエンド（リファレンス用・未使用）
├── .github/workflows/deploy.yml  # GitHub Pages自動デプロイ
├── .gitignore
└── README.md
```

## デプロイ・公開URL

- **ホスティング**: GitHub Pages（masterブランチへのpushで自動デプロイ）
- **リポジトリ**: https://github.com/helloin0847/hiyoko-timecard

### 各店舗ブックマークURL

| 店舗 | URL |
|------|-----|
| 本店 | `https://helloin0847.github.io/hiyoko-timecard/?store=本店` |
| east | `https://helloin0847.github.io/hiyoko-timecard/?store=east` |
| ASAHI | `https://helloin0847.github.io/hiyoko-timecard/?store=ASAHI` |

## バックエンド（Supabase）

- **プロジェクト**: `cenigdvpcxphljrravnb`（ap-northeast-1）
- **スキーマ**: `hiyoko_timecard`
- **接続**: Supabase JS v2（CDN）、anonキーで直接接続

### テーブル構成

#### `hiyoko_timecard.employees`（従業員マスタ）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | BIGINT (IDENTITY) | PK |
| mgmt_no | TEXT (UNIQUE) | 管理番号 |
| name | TEXT | 氏名 |
| name_kana | TEXT | 読み仮名（ひらがな・苗字のみ）|
| employee_no | TEXT | 社員番号（給与システム用）|
| sort_order | INT | ソート順 |
| is_active | BOOLEAN | 有効フラグ |
| store | TEXT | 店舗（本店/east/ASAHI）|
| hire_date | DATE | 入社日 |
| retire_date | DATE | 退職日 |
| employment_type | TEXT | 雇用形態（正社員/アルバイト）|
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時（トリガー自動更新）|

#### `hiyoko_timecard.time_records`（打刻記録）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID (DEFAULT gen_random_uuid()) | PK |
| date | DATE | 日付 |
| mgmt_no | TEXT (FK → employees) | 管理番号 |
| employee_name | TEXT | 氏名（非正規化）|
| store | TEXT | 店舗 |
| kubun | TEXT | 区分（仕込/営業/通し）|
| clock_in_raw | TIME | 出勤時刻（実打刻）|
| clock_out_raw | TIME | 退勤時刻（実打刻）|
| work_minutes_raw | INT | 勤務分数（実）|
| is_corrected | BOOLEAN | 修正フラグ |
| correction_memo | TEXT | 修正メモ |
| employee_no | TEXT | 社員番号 |
| clock_in_rounded | TIME | 丸め出勤（旧方式・未使用）|
| clock_out_rounded | TIME | 丸め退勤（旧方式・未使用）|
| work_minutes_rounded | INT | 丸め分数（旧方式・未使用）|
| is_deleted | BOOLEAN | 削除フラグ（論理削除）|
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時（トリガー自動更新）|

## 機能一覧

| 機能 | 説明 |
|------|------|
| 打刻 | 出勤・退勤の打刻（確認モーダル付き・楽観的UI更新）|
| 出勤状況パネル | 正社員（通し）・各店舗の出勤中スタッフ一覧 |
| モード切替 | 仕込/営業モード（16時で自動切替・手動切替可）|
| 集計 | シフト期間の店舗別・従業員別勤務時間集計 |
| 記録 | 日別の打刻記録一覧・修正・削除・氏名検索 |
| 月次CSV | FileMaker・PCA給与DX連携用CSV出力（丸め時間ベース）|
| 個人履歴 | スタッフ別の勤務履歴・サマリー |
| 勤怠一覧 | 全従業員×日付のカレンダーグリッド表示（店舗フィルタ・期間ナビ付き）|
| スタッフマスタ | 従業員の登録・編集・削除（upsert・社員番号は過去記録にも反映・削除はパスワード保護）|
| 丸め設定 | 出勤・退勤の丸め（分単位・切上/切捨/四捨五入）|
| 丸め切替 | ヘッダーの「丸め ON/OFF」ボタンで打刻時間⇔丸め時間を切替表示 |

## 主な仕様

- 締め日：毎月20日（前月21日〜当月20日）
- 給与支払日：締め日+6日
- 丸め設定：出勤・退勤それぞれ独立（分単位・切上/切捨/四捨五入）
- 丸め方式：表示時計算（DBには実打刻のみ保存、表示時に丸め設定で計算）
- 丸め切替：ヘッダーの「丸め ON/OFF」で全タブ切替（打刻・記録タブは常に実打刻表示）
- 区分：仕込（〜15:59自動）/ 営業（16:00〜自動）、手動切替可
- 正社員は「通し」区分で全店舗に表示
- CSVはFileMaker・PCA給与DX連携用（社員番号・時間は小数形式・正社員除外・常に丸め適用）
- 従業員保存はupsert方式（FK制約のある従業員は削除せずis_active=falseで無効化）
- 社員番号・氏名変更時、過去の打刻記録にも自動反映

## クライアント側の保存データ

| キー | 保存先 | 説明 |
|------|--------|------|
| `hiyoko_round` | localStorage | 丸め設定（各iPadごと）|
| `hiyoko_store` | localStorage | 最後に選択した店舗 |

## URLパラメータ

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| `?store=本店` | 本店/east/ASAHI | 店舗固定（iPad用ブックマーク）|

## 開発・更新手順

```bash
# コード編集後
git add index.html
git commit -m "変更内容の説明"
git push
# → GitHub Pagesに自動デプロイ（約30秒）
```
