# amine-thermo — 協作說明(給 Claude 與協作者)

GHGT-18 ePoster 的配套網站(清華大學化工系 林育正實驗室),由 GitHub Pages 發布:
https://rredpanda78.github.io/amine-thermo/ 。主角是瀏覽器遊戲 **Capture City 2050**(`game/`)。

回覆與註解用繁體中文或英文皆可;遊戲裡玩家看得到的文字一定要中英兩版。

## 工作方式

- **不要直接推到 `main`**:`main` 一推上去約 1 分鐘就上線。開分支、發 PR,由 repo 擁有者(Rredpanda78)看過再合併。
- commit 標題用 `vNN: 一句話`(接續 `git log` 的版號),內文條列改了什麼、為什麼。
- 動手前先 `git pull`,別人可能剛改過同一個檔。

## 公開原則(不可違反)

1. **不放未發表的研究數據**:例如本實驗室計算的 ΔG / ΔH。只放已發表的文獻值;遊戲自己估的數字標 `est.`。
2. **不寫任何商用製程模擬軟體的品牌名**(遊戲、註解、commit 訊息都一樣)。製程研發的按鈕一律寫「研發製程 / Develop process」,也不寫 pilot。
3. **引用要正確**:作者、期刊、年份、doi 對得上才寫;不確定就不寫。
4. **不放個人資料**(email、電話等)。這是公開 repo,推上去就收不回(git 歷史、fork)。

## 檔案

| 路徑 | 內容 |
|---|---|
| `index.html` | 首頁 |
| `game/index.html` | 遊戲介面:單一 HTML 檔(CSS + JS),UTF-8 |
| `game/model.js` | 遊戲模型(數值、事件、每月結算),沒有 DOM,Node 也能跑;**存成純 ASCII** |
| `game/full/` | 舊網址,只剩轉址 |
| `tools/` | 編碼轉換與模擬腳本(下面) |

## 改 `game/model.js` 一定要照這個順序

檔案裡的中文等非 ASCII 字元存成 `\uXXXX`(有些伺服器不送 charset,這樣最保險)。

```bash
python tools/unescape.py      # 1. 轉回正常文字(Windows 用 py)
# 2. 編輯
python tools/escape.py        # 3. 轉回 ASCII,commit 前必做
```

`game/index.html` 不用轉。

## 文字慣例

- 介面字串:`index.html` 用 `L('English', '中文')`;靜態文字用 `data-i18n` 鍵 + `I18N` 字典。`model.js` 的字串放 `zh` 欄位;新聞頭版用 `headline(state, id, tone, en, zh)`。
- **字少**:玩家看到的說明以一句話為原則;較長的說明與文獻放進「詳細 / 更多」(`<details>`)。不用跳出式提示視窗。
- 命名:混合溶劑寫 `A/B`(MDEA/PZ、AMP/NMP、2PE/EG),溶劑加製程寫 `A+B`(MEA+AS、PZ+AS),製程用縮寫(RPB、MCFC、IC、SF)。圖示文字一律取 `TECHS[k].short`。

## 測試(改完都要跑)

```bash
node tools/fuzz.js                          # 必須印出 "no invariant violations"
DIFF=normal REGION=taiwan node tools/sim.js # 平衡:各策略勝率
DIFF=hell PX=1 node tools/extreme.js texas  # 極端打法;PX = 電價相對可接受價格的倍數
```

- 改數值後,三個地區(taiwan / germany / texas)× 相關難度都跑一次,在 PR 寫出勝率前後變化。
  目前參考(v26,`sim.js` 的 "screen rush → best + 99"):easy 約 70 %、normal 約 60 %、hard 約 28 %;hell 台灣 4/24、德國 1/24、德州 4/24。
- 瀏覽器:在 repo 根目錄 `python -m http.server 8000`,開 `http://localhost:8000/game/?debug`。
  `?debug` 會提供 `window.__cc`:`state`、`run(frames)`、`step(months)`、`plant(id)`、`hits`。
  至少看三種尺寸:桌機 1280×720、手機橫 844×390、手機直 390×760;console 不能有錯誤。

## 介面架構重點

- 三段版面:上 `.topbar#hud`(資訊)、中 `#sceneBox` 的 canvas(城市)、下 `.ctrlbar#ticker`(研究所、蓋廠、新聞、倍速)。
- 場景裡的文字(電廠名牌、進度條、引導箭頭)一律經過 `queueLabel()` / `flushLabels()` 排版,不會互相蓋住;新增場景文字也要走這條。
- 難度在 `M.DIFFS`:easy / normal / hard,以及隱藏的 hell(彩蛋:3.5 秒內點研究所 10 次解鎖,整個畫面換成恐怖風格 `html.hell`)。
- localStorage 鍵:`cc2050-board-v10`(排行榜)、`cc2050-coach`(引導箭頭)、`cc2050-diff`、`cc2050-hell`、`cc2050-lang`、`cc2050-nick`、`cc2050-sfx`。
