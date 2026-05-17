# 職業システム RPG PWA サンプル

職業変更によるパラメータ補正、職業熟練度、上級職マスター特典を確認できるPWAサンプルです。

## 実装済み機能

- PWA対応
- GitHub Pages公開対応
- `data/jobs.json` に職業データを分離
- 職業変更
- パラメータ補正
- 熟練度1〜8
- 戦闘回数による熟練度アップ
- 上級職マスター特典
- ローカルストレージ保存
- リセット
- スマホ・iPad向けレスポンシブ表示

## ファイル構成

```text
rpg_job_pwa_sample/
├─ index.html
├─ manifest.json
├─ service-worker.js
├─ README.md
├─ css/
│  └─ style.css
├─ js/
│  └─ main.js
├─ data/
│  └─ jobs.json
└─ assets/
   └─ icons/
      ├─ icon-192.png
      └─ icon-512.png
```

## ローカル確認方法

`fetch()` で `data/jobs.json` を読み込むため、HTMLを直接ダブルクリックするのではなく、ローカルサーバーで開いてください。

```bat
cd rpg_job_pwa_sample
python -m http.server 8000
```

ブラウザで次を開きます。

```text
http://localhost:8000
```

## GitHub Pages公開方法

1. GitHubで新しいリポジトリを作成
2. このフォルダの中身をアップロード
3. GitHubの `Settings` → `Pages`
4. `Deploy from a branch` を選択
5. `main` / `/root` を選択して保存
6. 表示されたURLにアクセス

## 職業データの編集

職業データは `data/jobs.json` にあります。

主な項目は以下です。

```json
{
  "id": "warrior",
  "name": "戦士",
  "type": "basic",
  "multipliers": {
    "str": 110,
    "agi": 65,
    "vit": 100,
    "int": 70,
    "style": 100,
    "mhp": 110,
    "mmp": 40
  },
  "thresholds": [9, 10, 15, 20, 30, 30, 35],
  "masterBonus": null
}
```

`thresholds` は、熟練度1→2、2→3、3→4、4→5、5→6、6→7、7→8に必要な戦闘回数です。

## 公開時の注意

このサンプルは、入力いただいた職業名・数値で動く確認用です。一般公開するゲームでは、既存作品固有の名称に見えるものはオリジナル名称に変更してください。
