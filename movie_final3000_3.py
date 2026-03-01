import pandas as pd

# --把電影依「被評分的次數」由多到少排序，選出前 3000 部--

# --讀取「已經整理完成」的資料 --
df = pd.read_csv("movies_with_zh_poster_filtered.csv")

# -- 依「評分次數」由高到低排序 --
df_sorted = df.sort_values(
    by='rating_count',
    ascending=False
)

# --取前 3000 筆 --
top3000 = df_sorted.head(3000).reset_index(drop=True)

# --- 重建 index_id  ---
if 'index_id' in top3000.columns:
    top3000 = top3000.drop(columns=['index_id'])

top3000.insert(0, 'index_id', range(1, len(top3000) + 1))

# ---輸出最終實驗資料---
top3000.to_csv("movies_top3000.csv", index=False, encoding='utf-8-sig')

print("✅ 已依評分次數排序並選取前 3,000 部電影！")
print(top3000.head())