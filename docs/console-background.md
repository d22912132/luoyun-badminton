# 主控台仙山背景

使用內建 ImageGen 生成款式 A：16:9 雲海仙山，中央低對比留白，兩側配置古松、宮闕、飛瀑與浮空山。

網頁素材（WebP，同一張圖的兩種解析度）：
- `public/assets/yunmeng-mountains-v1.webp`：桌面。
- `public/assets/yunmeng-mountains-small-v1.webp`：640px 以下手機。

CSS 使用靜態固定層，深淺色各有遮罩，卡片加深底色，沒有新增背景動態模糊。素材使用版本化檔名與長效快取；換圖時請改為 v2，並同步 CSS 與本機 server 的素材清單。

Cloudflare 透過 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) 提供 `public/`，本機與 Docker 使用 `server.mjs` 的明確素材清單。

## 生成 Prompt

Use case: stylized-concept. Asset type: production background artwork for the Luoyun Sect badminton club web console, landscape 16:9, ideally 2048x1152. A vast and epic Chinese xianxia cultivation panorama inspired by A Record of a Mortal's Journey to Immortality. Towering ethereal jade-green mountain peaks piercing through a sea of misty clouds. Ancient Taoist pavilions and grand sect temples nestled among craggy cliffs and twisted ancient pine trees. Distant floating islands with waterfalls cascading into the abyss. Grand cinematic matte painting, immense depth and atmospheric perspective, realistic delicate rock and pine textures, refined rather than oversaturated fantasy. Cool emerald green and mist teal with restrained soft gold sunlight breaking through celestial clouds. Composition for a readable web dashboard: concentrate detailed mountains, gnarled pines and small temples in the left and right outer thirds, keep the central 50 percent a quiet low contrast sea of mist with faint distant silhouettes. Strong depth from near cliff edges to many receding mountains. Lower center also soft and uncluttered. Sky and clouds softly luminous, no blown out white sun or harsh light beams. Full bleed landscape only, no UI, no letters, no watermark, no people, no weapons. Preserve elegant jade and dark teal mood with enough midtone detail for both dark and light theme overlays.
