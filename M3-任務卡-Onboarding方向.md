# M3 任務卡 — Onboarding + 真正的方向選擇

> 用法：連同 v0.3 規格一起貼給 Claude Code。**這次只做 M3**，把 M2 寫死的 `DIRECTION = 'courage'` 換成玩家真正選的方向。

---

## 指令（範圍）

附件是完整規格 v0.3，**這次只實作 M3**。前置：M1（王國渲染 + `addElement`）、M2（三卡迴圈 + 信心圖鑑 + IndexedDB）已完成。

M3 的任務是加一段 **首次開啟的 onboarding 流程**：阿光打招呼 → 玩家選一個方向 → 種下第一格土地 → 進首頁；並把選到的方向 **接進抽卡邏輯**，取代 M2 寫死的 `courage`。

**請依規格：** §4.4 方向→屬性對照、§10 Onboarding 畫面、§2.1 甦醒的世界（非修復）、§1.3 鐵則。

**這次不要做**：PWA / service worker（M4）、Supabase / Auth（M5）、阿光完整語庫（之後）、不要動成長系統 / 卡片邏輯 / 圖鑑 / IndexedDB 結構（只加一個欄位，見下）。

---

## 要建的東西

1. **Onboarding 流程**：只在「尚未完成 onboarding」時出現，兩三個輕步驟、可快速通過（受眾是會放棄東西的人，**不要做成冗長問卷**）。
2. **方向選擇**：5 選 1，對照 §4.4。
3. **存方向**：寫進持久化狀態，新增 `onboarded` 旗標。
4. **接線**：抽卡的方向改讀 `state.direction`，**移除 M2 的 `const DIRECTION = 'courage'`**。
5. **第一格土地**：選完方向後種下第一格（世界醒來的第一步），進首頁。
6. **回訪略過**：已 onboarded 的使用者重開 App 直接進首頁。

---

## 方向 → 屬性（§4.4）

```js
const DIRECTIONS = [
  { id: 'vitality',  label: '動起來' },
  { id: 'focus',     label: '讀點書' },
  { id: 'courage',   label: '勇敢一點' },
  { id: 'warmth',    label: '對人好一點' },
  { id: 'curiosity', label: '多看看世界' },
];
```

---

## 流程（pseudocode）

```
async function boot():
    state = await idb.kingdom.get() ?? newState()   // newState().onboarded = false
    if !state.onboarded: showOnboarding()
    else: showHome()

// Onboarding 畫面：
//  Step 1  阿光打招呼 + 一句世界觀（甦醒、不是修復），按「繼續」
//  Step 2  「你想先往哪個方向？」→ 顯示 DIRECTIONS 五個選項
async function chooseDirection(attr):
    state.direction = attr
    state.onboarded = true
    if state.land is empty: state.land = [[0,0]]    // 第一格土地：世界醒來
    state.firstDay = today(); state.lastActive = today()
    await idb.kingdom.put(state)
    playFirstTileAnimation()                        // 第一格亮起的小動畫（可選）
    showHome()
```

抽卡改動（M2 的 `drawDailyCards`）：

```
// 移除： const DIRECTION = 'courage'
// 改為讀 state.direction：
mainPool = (rng() < MAIN_OFF_DIRECTION_RATE)
             ? pool.main
             : pool.main.filter(c => c.attribute == state.direction)
```

> 文案（阿光台詞、世界觀那句）目前是 **placeholder 即可**，跟卡片內容一樣之後再補。先求流程跑通。

---

## 阿光開場（placeholder，之後替換）

語氣：溫柔、表面帶點輕鬆，不沉重（§12）。例如：

- 「嗨，你來了。這裡有一座還在沉睡的小王國，正等著醒過來。」
- 「不用一次做很多，每天一點點，它就會慢慢亮起來。你想先往哪個方向走走？」

> 注意（§2.1）：說「沉睡 / 醒來」，**不要說「壞掉 / 需要你修復 / 曾經失去」** 這種帶愧疚的框架。

---

## 可選（不強制做，做了也別違反鐵則）

之後若要在設定裡讓玩家**改方向**：改方向只影響**往後抽的主線卡**，**不得移除或改動已長出的王國**（呼應只增不減）。M3 不要求做。

---

## 驗收條件

1. 清空 IndexedDB / 首次開啟 → 看到 onboarding：阿光打招呼 → 選方向（5 選 1）。
2. 選方向後 → 方向存入 state、種下第一格土地、進首頁。
3. **今日主線卡的屬性 = 你選的方向**（不再固定 courage）。用不同方向重跑驗證會變。
4. 已 onboarded 的使用者重開 App → **直接進首頁**，不再出現 onboarding。
5. `direction`、`onboarded`、第一格土地都持久化，重開仍在。
6. 成長系統、卡片完成、圖鑑、既有 IndexedDB 資料行為不變（只多了 `onboarded` 與 `direction` 的使用）。

對得上就過。後續：M4（PWA 殼層 + 離線 + 卡池快取）。
