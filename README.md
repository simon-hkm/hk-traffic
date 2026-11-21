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
| 到站班次 | [港鐵實時列車服務資訊](https://data.gov.hk/tc-data/dataset/mtr-data2-nexttrain-data)。瀏覽器只問本站；同一車站 15 秒內只向港鐵查一次。 |
| 快拍位置 | [運輸署交通情況快拍圖像](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images) |
| 快拍照片 | 瀏覽器只問本站；同一快拍點 90 秒內只向 `tdcctv.data.one.gov.hk` 取一次。 |

官方路綫檔沒有車站座標，也沒有馬場站。座標來自 Wikidata，九龍站、大埔墟站和馬場站已另行核對。路綫形狀來自 OpenStreetMap 的港鐵路軌，沿真實走線彎曲。

港鐵沒有提供列車定位。全部路綫和單一路綫都會把即將到站的列車放在前一站到該站的路軌上，並按剩餘時間移動。這是估算，畫面上會說明。

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

建置並在本機以伺服器運行：

```bash
npm run build
npm start
```

到站和快拍在本機由 Next.js 伺服器暫存。發佈到 Cloudflare 時，頁面是靜態檔，`/api` 由 Worker 用 Cache API 暫存，規則相同：同一站 15 秒、同一快拍 90 秒。

底圖圖磚仍由瀏覽器向 OpenFreeMap 讀取。圖磚有瀏覽器快取，不經本站轉送，避免把所有人的地圖流量集中到一個位址。

## 發佈到 Cloudflare Workers

Workers 免費方案每日約 10 萬次 Worker 請求。頁面和靜態檔不經 Worker，不計入這額度。選定路綫後，瀏覽器約每 20 秒問一次 `/api`，這會計入額度。

```bash
npx wrangler login
npm run deploy:cloudflare
```

完成後網址是 `https://hk-traffic-map.<你的帳戶>.workers.dev`。
