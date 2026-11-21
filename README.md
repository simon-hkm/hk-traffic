# 香港交通實況

一幅香港地圖。底圖用 [OpenFreeMap](https://openfreemap.org/) 的公開服務。地圖上有十條港鐵重鐵綫，以及運輸署的交通快拍點。

- 點車站：查看該站即將到站的班次，最多四班、分兩個方向。
- 點橙色快拍點：查看該處最新照片。
- 沒有班次、照片未能提供，或查詢失敗時，畫面上會直接說明。

輕鐵不在這兩份官方資料裡，所以沒有畫上。

## 資料從哪裡來

| 內容 | 來源 |
| --- | --- |
| 底圖 | OpenFreeMap Liberty 樣式，經 MapLibre 顯示。免註冊、免鑰匙。 |
| 路綫和站名 | [港鐵路綫及車站](https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv) |
| 到站班次 | [港鐵實時列車服務資訊](https://data.gov.hk/tc-data/dataset/mtr-data2-nexttrain-data)，只在點選時向 `rt.data.gov.hk` 查詢 |
| 快拍位置 | [運輸署交通情況快拍圖像](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images) |
| 快拍照片 | 瀏覽器直接向 `tdcctv.data.one.gov.hk` 讀取 |

官方路綫檔沒有車站座標，也沒有馬場站。座標來自 Wikidata，九龍站、大埔墟站和馬場站已另行核對。路綫按官方車站次序以直線連接，不會沿真實隧道彎曲。

到站接口即使指定繁體中文，目的地仍是車站代碼。中文站名由路綫檔對照。

## 在自己的電腦運行

需要 Node.js 22。

```bash
npm install
npm run dev
```

然後打開 `http://127.0.0.1:4187`。

更新車站或快拍位置檔：

```bash
npm run data
```

Wikidata 若暫時拒絕連線，指令會改用 `scripts/fixtures/wikidata-stations.json`。

檢查靜態輸出：

```bash
npm run build
```

成品在 `out/`。

## 驗收後才發佈到 Cloudflare

正式版用 Cloudflare Workers 的免費方案，網址用平台提供的 `workers.dev`。網站是靜態檔案，到站和照片由瀏覽器直接向政府網址讀取，不經 Worker 轉發。靜態檔不計入每日 10 萬次請求額度。

預計費用是 0 元。不買網域，不使用 Workers 付費方案，不自建地圖伺服器。

要收費的做法沒有採用：

- Workers 付費方案每月最少 5 美元。免費方案超出每日額度後會停止服務，不會自動扣費。
- 自訂網域要另付網域費用。
- 自建地圖圖磚要自己的伺服器。

發佈前先在本機建好靜態檔，再登入你自己的 Cloudflare 帳戶：

```bash
npm run build
npx wrangler login
npx wrangler deploy
```

部署設定在 `wrangler.jsonc`。完成後，Wrangler 會印出 `https://hk-traffic-map.<你的帳戶>.workers.dev`。
