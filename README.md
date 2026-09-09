# 落雲宗羽球團

保留原本墨玉風格的羽球開團網站，現在可獨立運作，不需要 Claude Artifact。

- **正式公開名單**：<https://luoyun-badminton.luoyun-badminton.workers.dev/>
- **管理後台**：<https://luoyun-badminton.luoyun-badminton.workers.dev/console.html>

- **公開名單** `/`：任何人可看，每 5 秒讀取最新資料。斷線會標示資料狀態。
- **管理後台** `/console.html`：登入後開團、維護弟子名冊、加入散修、切換入陣／觀望／候補、複製 LINE 通知。
- **掌門殿**：管理長老、變更密碼、檢視操作日誌、下載資料備份。
- **多人同步**：所有管理者使用同一個 SQLite 資料庫；衝突時拒絕舊版本寫入，請關閉編輯視窗、依最新資料重做。
- **修仙玩法**：公開頁每日靈籤、宗門活躍榜、修仙稱號、靈力與席位統計；後台名冊同步顯示弟子稱號與入陣次數。
- **公開報名意願**：訪客可在公開頁送出參加／觀望／候補意願（可設截止時間），進到後台「候旨玉簡」由管理者核准後才列入正式名單。
- **洞府場館**：常用球館建檔（地址、導航、停車、設施、預設面數與費用），開團時一鍵帶入；舊活動的地點會自動轉成場館資料。

## 本機啟動

需要 Node.js **22.13 以上**（本機已以 22.20 測試）；沒有伺服器端第三方相依套件，不需 `npm install` 或建置。

```sh
npm start
```

打開 [公開名單](http://localhost:3000/) 或 [管理後台](http://localhost:3000/console.html)。

第一次啟動會：

1. 在 `data/club.sqlite` 建立資料庫。
2. 從原始 `index.html` 的快照匯入兩場既有活動，以及依暱稱去重的弟子名冊。只有首次空資料庫才會匯入，重新啟動不覆蓋資料。
3. 產生 `data/setup-token.txt`。用文字編輯器開啟，將金鑰填入管理後台的「開始設定」，自行設定掌門帳號與密碼。

沒有預設帳號。口令可使用 4–8 位數 PIN，或 8–128 個字元密碼；正式掌門建議使用長密碼。初始化金鑰只在尚無帳號時有效，完成後可移除該檔案。若設定 `SETUP_TOKEN` 環境變數，改用該值且不產生金鑰檔。

資料儲存在主機，清除瀏覽器資料不會刪除名冊。登入 Cookie 為 HttpOnly，12 小時到期；密碼變更會使該帳號的既有登入失效。只有掌門能冊封或革除長老；系統會保留至少一位掌門。

## 免費上線（Cloudflare，建議）

專案已附上 Workers + SQLite Durable Object 部署設定，可使用 **Workers Free** 方案，不必自備主機或購買網域。首次需要你持有的 Cloudflare 免費帳號，網址使用平台提供的 `workers.dev` 子網域。

```sh
npm install
npx wrangler login --scopes account:read user:read workers_scripts:write workers_tail:read
npm run check:cloud
npm run deploy
npx wrangler secret put SETUP_TOKEN
```

最後一個命令會要求輸入初始化金鑰，可使用本機 `data/setup-token.txt` 內隨機產生的值。金鑰設好後，開啟部署輸出的網址，加上 `/console.html`，建立自己的掌門帳號。設好金鑰前初始化 API 不會允許任何人建立帳號。**不要把金鑰放在 wrangler.jsonc 或 GitHub。**

公開名單與後台使用同一個網址、同一份雲端資料，每 5 秒同步。背景分頁會暫停更新以節省請求。部署會從 repo 快照建立新的雲端名單，**不會上傳本機測試帳號或本機 SQLite**；後續部署保留雲端資料。Cloudflare 設定中的 `CLUB` 綁定、`Club` 類別及 `luoyun` 物件識別名稱不可任意變更，否則會切到另一份儲存空間。

截至 2026-09-09，免費額度包含每日 10 萬次請求、500 萬筆資料列讀取、10 萬筆寫入、共 5 GB 儲存；還有 CPU 與執行時間限制。超額時免費服務會回傳錯誤，不會自動升級。這些額度由帳號內的專案共用，未來以官方公告為準：[Workers 定價](https://developers.cloudflare.com/workers/platform/pricing/)、[Durable Objects 定價](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

例如 50 位團員每天各開啟名單 30 分鐘，按每 5 秒查一次粗估約 18,000 次公開名單請求，另加管理操作，仍低於每日 10 萬次。這是估算，不代表無限免費；圖片上傳、影片與外部 AI 服務要另外評估。

雲端 API 的 SQLite 交易、帳號與登入失敗限制都儲存在 Durable Object，程式休眠或重新部署不會遺失。雲端備份可先由掌門下載 JSON；完整雲端災難復原可使用平台的 SQLite Durable Object PITR 功能，與下方本機檔案備份方式不同。

本機驗證 Cloudflare 執行環境（使用獨立的 `.wrangler/` 測試資料）：

```sh
npx wrangler dev --port 8787 --var SETUP_TOKEN:local-worker-test
# 另一個終端執行
npm run test:cloud
```

**此測試金鑰與測試帳號僅限本機。** `test:cloud` 固定連線到 `127.0.0.1:8787`，不會操作正式網站。

## 自備主機上線（替代方式）

**GitHub Pages 無法執行此後端。** 直接開 HTML 或使用 Pages 時，公開頁只顯示舊快照；後台會提示需要啟動伺服器。完整網站需要可執行 Node.js 或 Docker、提供持久磁碟的主機。

可直接在 VPS / NAS 執行 `npm start`，或使用附帶的 Dockerfile：

```sh
docker build -t luoyun-badminton .
docker volume create luoyun-data
docker run -d --name luoyun --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e PUBLIC_ORIGIN=https://badminton.example.com \
  -v luoyun-data:/app/data \
  luoyun-badminton
```

以上為 Linux shell 範例；將網址換成自己的網域，以 Caddy / Nginx 等反向代理提供 HTTPS 並轉發到 3000。`PUBLIC_ORIGIN` 必須是使用者實際瀏覽的完整來源，不含結尾斜線或路徑，例如 `https://badminton.example.com`。HTTPS 設定會啟用 Secure Cookie。請以網域根目錄部署，非 `/repo/` 子路徑。

Docker 初始化金鑰可在主機執行 `docker exec luoyun cat /app/data/setup-token.txt` 取得。請勿將金鑰或資料庫放進 Git；已在 `.gitignore` 及 `.dockerignore` 排除。完成建置後可先用 `/health` 驗證程序健康，再測試公開名單及登入。

| 環境變數 | 預設 | 用途 |
|---|---|---|
| `PORT` | `3000` | 服務連接埠 |
| `HOST` | `127.0.0.1` | Docker 內預設改為 `0.0.0.0` |
| `DATA_DIR` | 專案 `data/` | 必須可寫、持久保存的資料目錄 |
| `PUBLIC_ORIGIN` | 請求的 HTTP 來源 | 正式部署設定為對外 HTTPS 來源 |
| `SETUP_TOKEN` | 自動產生檔案 | 首次初始化金鑰，可選 |

此版本適合單一羽球團及少量管理者；自備主機時部署為**單一服務實例**。資料與版本一起以 SQLite 交易寫入；目前每次管理操作保存完整名冊狀態，最多保留 400 筆日誌、每場最多 500 筆報名。大量使用者或多球團時再拆分資料表與服務。

## 備份與搬家

掌門可在「掌門殿 → 長老名冊 → 下載資料備份」下載 JSON，包含名冊、活動、長老基本資料及最近 400 筆日誌，**不含密碼雜湊或登入憑證**，供檢閱與資料轉移使用；目前沒有 JSON 一鍵還原功能。

完整災難復原請備份 SQLite：**先停止服務**，複製整個 `DATA_DIR`（含可能存在的 `club.sqlite-wal` / `club.sqlite-shm`），再重新啟動。還原時停止服務，保留原資料目錄作為回復點，再將備份目錄設為 `DATA_DIR`。完整備份含帳號雜湊與登入工作階段，請存放在私有位置。

原 Claude Artifact 私有資料庫與各瀏覽器的 localStorage 不會自動搬入；本版已帶入 GitHub 上可取得的兩場快照。如果私有版本有較新的資料，需要另行匯出後再核對遷移。

## 驗證

```sh
npm test
```

使用 Node.js 內建測試器啟動臨時資料庫與 HTTP 服務，涵蓋初始化、登入、權限、公開資料隔離、重複報名、欄位驗證、併發衝突、交易回滾、密碼變更、重啟持久化與限流，不會更動正式名單。

## 檔案與技術

- `club.mjs`：兩種部署共用的 API、交易、密碼雜湊與 Cookie 工作階段。
- `server.mjs`：本機／自備主機 HTTP 與 SQLite。
- `worker.mjs`、`wrangler.jsonc`：Cloudflare 免費雲端執行與持久儲存。
- `console.html`：既有 React 18 UMD 管理介面，改接共用 API。
- `index.html`：零 JavaScript 相依套件的公開名單；伺服器注入即時資料模式。
- `test/server.test.mjs`：API 整合測試，GitHub Actions 自動執行。
- `Dockerfile`：單容器部署，資料放在獨立持久磁碟。

管理頁目前仍需連網載入 React、Tailwind、Lucide CDN 及 Google Fonts；公開頁字型載入失敗時會退回系統字型。既有修仙文案、團規與每面場 7 人的規則保留。超額報名會警示，候補轉正仍由管理者決定，不自動調整次序。
