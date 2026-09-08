# 落雲宗羽球團

羽球開團管理工具。兩個檔案、零建置、零相依套件——直接用瀏覽器開就會動。

## 檔案

| 檔案 | 用途 | 誰能看 |
|---|---|---|
| `index.html` | **公開名單頁**。唯讀快照，顯示開團資訊、報名名單、團規。 | 任何人，不需要帳號 |
| `console.html` | **管理後台**原始碼。開團、管理弟子名冊、切換報名狀態、生成 LINE 通知。 | 需登入（見下方說明） |

## 管理後台怎麼跑

`console.html` 直接用瀏覽器開也能動，但會進入「獨修模式」——資料只存在你自己的瀏覽器裡，長老之間**不會同步**。

要多人共編，必須發佈成 Claude Artifact（宣告 `db` 能力）。目前線上版本：

    https://claude.ai/code/artifact/c54d8384-eea0-4454-a33f-15e116e83438

這個連結是私人的，而且平台限制宣告 `db` 的頁面只能組織內的登入成員瀏覽，無法公開分享——這也是為什麼要另外做一頁 `index.html` 給沒有帳號的人看。

改完 `console.html` 後要重新發佈才會生效（在 Claude Code 裡對同一個 artifact URL 重新 publish）。

## 公開名單頁怎麼更新

`index.html` 是**快照**，不會即時同步。管理者改完名單後要手動更新：

1. 後台 →「掌門殿 → 長老名冊」→ 點「複製佈告資料」
2. 打開 `index.html`，找到最上面這一段：

   ```html
   <script type="application/json" id="snapshot">
   { ... }
   </script>
   ```

3. 把大括號那整段 JSON 換成剛剛複製的內容
4. commit + push，GitHub Pages 幾十秒後就會更新

JSON 的結構：

    {
      "generatedAt": "ISO 時間字串",
      "events": [{
        "title": "...", "dateText": "9/25 (五)",
        "startTime": "10:00", "endTime": "13:00",
        "place": "...", "courts": 5, "fee": 220,
        "note": "用球：…｜取消規則：…",     // 用「｜」分隔多條補充事項
        "roster": [{ "nickname": "...", "gender": "male|female", "level": 5, "status": "going|maybe|wait" }]
      }]
    }

團規寫死在 `index.html` 的 `RULES` 陣列裡（跟後台同一份），要改直接改那段。

## GitHub Pages

Settings → Pages → Source 選 `Deploy from a branch`、分支 `main`、資料夾 `/ (root)`，
存檔後網址會是 `https://<帳號>.github.io/<repo 名>/`。

`index.html` 已經加了 `noindex, nofollow`，不會被 Google 收錄，但**任何拿到網址的人都看得到名單**——上面有 55 筆團員暱稱與程度。要更保守就改成不列人名（把 `roster` 清空即可，統計數字仍會顯示）。

## 注意

- 這個 repo **不含任何密碼**。長老帳號與 PIN 存在 Artifact 的資料庫裡，不在原始碼中。
- `console.html` 裡的 `admin` / `1234` 只是離線模式的預設值，線上版不會用到。
- PIN 是團隊內部的分工識別碼，用來記錄「是哪位長老做的」，不是資安等級的密碼。

## 技術

- 單檔 HTML，無建置流程
- 管理後台：React 18 UMD + Tailwind CDN + Lucide（皆由 CDN 載入）
- 公開頁：純 HTML/CSS/JS，零相依
- 資料層：Claude Artifact `db`（線上）或 localStorage（離線）
