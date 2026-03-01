import requests
import time
import pandas as pd
import os
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import glob

# ---TMDb API 設定 ---
# 1.TMDb API 金鑰 
# 2.用 tmdb_id 去 TMDb 查「這部電影的詳細資料」
# 3.電影海報圖片的網址

API_KEY = "6da8953fde88f0dc548d82c08aba2a48"
BASE_URL = "https://api.themoviedb.org/3/movie/"
IMG_BASE = "https://image.tmdb.org/t/p/w500"  # 海報圖檔網址前綴


# --- 讀取完整電影資料 ---
df_full = pd.read_csv("movies_full.csv")
print(f"📘 共 {len(df_full)} 筆電影待查詢")

# === 3️⃣ 分批參數 ===
BATCH_SIZE = 10000 #--每一批處理 10,000 筆電影--
TOTAL_BATCHES = (len(df_full) // BATCH_SIZE) + 1 #-- 算出完整可以切幾批，如果有剩下沒滿一批的資料，也要算一批 --
FINAL_OUTPUT = "movies_with_zh_poster_filtered.csv" #-- 最後處理完成後，全部資料會存成這個檔名

# === 4️⃣ 判斷繁體中文 ===

def is_traditional_chinese(text): #-- 定義一個函式，傳進來的是一段文字（例如電影中文片名) --
    """檢查是否為繁體中文（排除簡體字與非中文比例過高者）"""
    if not isinstance(text, str): #--如果不是「字串」（例如 None、數字），直接判定不是繁體中文 --
        return False
    zh_chars = re.findall(r"[\u4e00-\u9fff]", text) #--從文字中找出所有中文字--
    ratio = len(zh_chars) / len(text) if len(text) > 0 else 0 #--中文字數量 / 總字元數--
    if ratio < 0.5: #--如果中文字 不到一半，判定「不是中文為主的文字」--
        return False
    simplified_only = re.findall(r"[国马车东门风体为发后这]", text) #--檢查文字裡 有沒有典型的簡體字--

    return len(simplified_only) == 0 #-- 完全沒有出現簡體字，才回傳 True（判定為繁體中文）--


# --去 TMDb 抓電影資料（含海報）定義一個函式--  note:輸入 tmdb_id → 查 TMDb → 回傳（片名、地區、海報），失敗就回 None，不讓整個程式死掉
def fetch_tmdb_data(tmdb_id):
    """抓取 TMDb 中文片名、地區與海報連結（zh-TW）"""
    if pd.isna(tmdb_id):
        return None, None, None #-- 如果這部電影 根本沒有 tmdb_id，就不呼叫 API、直接回傳三個空值 --
    
    url = f"{BASE_URL}{int(tmdb_id)}?api_key={API_KEY}&language=zh-TW"# --查網址:查第 tmdb_id 號電影、用我的 API 金鑰、要求 繁體中文
    try:
        response = requests.get(url, timeout=10) #-- 向 TMDb 發送請求，最多等 10 秒，避免卡死 --
        if response.status_code == 200: #-- 200代表成功拿到資料 --
            data = response.json() #-- 將json轉為python字典格式 --
            title = data.get("title") or data.get("original_title") # --抓中文片名（抓不到就用原始片名）--
            region = data.get("origin_country", [None])[0] if data.get("origin_country") else None #--TMDb 的地區是「陣列」，取第一個國家代碼（例如 US, JP)，沒有就回傳 None
            poster_path = data.get("poster_path") 
            poster_url = f"{IMG_BASE}{poster_path}" if poster_path else None #TMDb 只給/abc123.jpg，把它接成完整網址，沒有海報就回傳 None
            return title, region, poster_url #--成功就回傳三個值
        elif response.status_code == 429: #--API 速率限制
            print("🚦 遭到速率限制，暫停 10 秒再繼續...")
            time.sleep(10)
            return fetch_tmdb_data(tmdb_id) #--暫停 10 秒，再試一次同一部電影
    except Exception as e:
        print(f"⚠️ TMDb ID {tmdb_id} 錯誤：{e}") #--不讓程式整個掛掉，印出錯誤訊息，繼續跑下一筆
    return None, None, None 

# --- 處理全部批次 --- note:把所有電影「分批拿去 TMDb 查資料」，用多執行緒加快速度，邊跑邊存檔，避免中途掛掉全部重來。
for batch_num in range(TOTAL_BATCHES): #--總共有幾批資料，就跑幾次
    BATCH_START = batch_num * BATCH_SIZE #-- 算這一批的開始
    BATCH_END = min(BATCH_START + BATCH_SIZE, len(df_full)) #-- 結束位置
    df_batch = df_full.iloc[BATCH_START:BATCH_END].copy() #-- 把這一批資料切出來，只處理這一批，不動全部資料

    print(f"\n🚀 處理第 {batch_num + 1}/{TOTAL_BATCHES} 批（{BATCH_START}~{BATCH_END}）") #-- 印出目前進度，跑到第幾批了
    TEMP_FILE = f"movies_temp_progress_batch_{batch_num + 1}.csv" # --讓每一批都有自己的檔案
    OUTPUT_FILE = f"movies_with_zh_poster_filtered_batch_{batch_num + 1}.csv" #--中途掛掉也能從這批接續

    #-- 把這一批的 tmdb_id 拿出來，準備三個「空盒子」:中文片名、地區、海報網址
    tmdb_ids = df_batch["tmdb_id"].tolist()
    title_zh_list, region_list, poster_list = [None]*len(tmdb_ids), [None]*len(tmdb_ids), [None]*len(tmdb_ids)
    start_time = time.time()

    #-- 用多執行緒「同時查很多筆」
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(fetch_tmdb_data, tmdb_id): idx for idx, tmdb_id in enumerate(tmdb_ids)} #-- 把每一筆 tmdb_id 丟去查
        for count, future in enumerate(as_completed(futures), 1): 
            idx = futures[future]
            try:
                title_zh, region, poster_url = future.result() #-- 查完一筆就把結果放回對的位置
                title_zh_list[idx] = title_zh
                region_list[idx] = region
                poster_list[idx] = poster_url
            except Exception as e:
                print(f"❌ 執行緒錯誤：{e}")

            # 每 500 筆暫存一次
            if count % 500 == 0:
                print(f"✅ 已完成 {count}/{len(tmdb_ids)} 筆")
                temp_df = df_batch.copy()
                temp_df["title_zh"] = title_zh_list
                temp_df["region"] = region_list
                temp_df["poster_url"] = poster_list
                temp_df.to_csv(TEMP_FILE, index=False, encoding="utf-8-sig")

    end_time = time.time()
    print(f"⏱️ 批次完成，耗時 {round((end_time - start_time)/60, 1)} 分鐘") #-- 印出這一批花多久時間 --


    # -- 把剛剛從 TMDb 查到的中文片名、地區、海報網址，一筆一筆塞回這一批電影資料裡 --
    df_batch["title_zh"] = title_zh_list
    df_batch["region"] = region_list
    df_batch["poster_url"] = poster_list

    #-- 篩選條件 -- 有中文片名、有地區資訊、有海報、2000 年後的電影、中文片名是「繁體中文」，只要有一條不符合，這部電影就被刪掉
    df_filtered = df_batch[
        df_batch["title_zh"].notna() &
        df_batch["region"].notna() &
        df_batch["poster_url"].notna() &   # ✅ 新增這條：排除無海報電影
        (df_batch["year"] >= 2000) &
        df_batch["title_zh"].apply(is_traditional_chinese)
    ].reset_index(drop=True)

    # --存這一批的「篩選後結果」(已補資料、已篩選完成，直接存成一個 CSV)
    df_filtered.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")
    print(f"📊 批次 {batch_num + 1} 篩選後保留 {len(df_filtered)}/{len(df_batch)} 筆（有繁體中文、有地區、有海報、2000年後）")


    # --清除暫存檔(這一批已經成功完成，就把中途保險用的暫存檔刪掉，避免資料夾越來越亂)
    if os.path.exists(TEMP_FILE):
        os.remove(TEMP_FILE)
        print(f"🧹 已刪除暫存檔 {TEMP_FILE}")


#--找出所有「每一批處理完成的 CSV 檔」--
batch_files = sorted(glob.glob("movies_with_zh_poster_filtered_batch_*.csv")) 
print(f"\n📂 偵測到 {len(batch_files)} 個批次檔案：")
for f in batch_files:
    print(" -", f)

# --把所有批次合併成一張表 --
df_all = pd.concat([pd.read_csv(f) for f in batch_files], ignore_index=True)


# -- 統一新增 index_id（從 1 開始）--
df_all.insert(0, "index_id", range(1, len(df_all) + 1))

# -- 匯出最終結果 --
df_all.to_csv(FINAL_OUTPUT, index=False, encoding="utf-8-sig")

print(f"\n✅ 所有批次已成功合併為 {FINAL_OUTPUT}")
print(f"📊 最終共 {len(df_all)} 筆資料（已排除無海報電影），index_id 已從 1 排到 {len(df_all)}")