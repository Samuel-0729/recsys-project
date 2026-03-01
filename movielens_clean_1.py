import pandas as pd
import numpy as np
import os

#-- 從data_csv資料夾中讀取三個csv檔案:movies、ratings、links --
Data_Dir='data_csv' 
movies = pd.read_csv(os.path.join(Data_Dir, "movies.csv"))
ratings = pd.read_csv(os.path.join(Data_Dir, "ratings.csv"))
links = pd.read_csv(os.path.join(Data_Dir, "links.csv"))


# -- 將 movies、ratings、links 三個表中的 movieId 統一轉成數字
# -- 將 ratings的 rating欄位 轉為數值型別，確保後續可以正確計算平均評分
for df in [movies, ratings, links]:
    df["movieId"] = pd.to_numeric(df["movieId"], errors="coerce").astype("Int64")
ratings["rating"] = pd.to_numeric(ratings["rating"], errors="coerce")


# --將 movies 的 title欄位，將title與年份拆開，並分為兩個欄位 
movies["year"] = movies["title"].str.extract(r"\((\d{4})\)").astype(float)
movies["title"] = movies["title"].str.replace(r"\s\(\d{4}\)", "", regex=True)


# -- 先以 movieId 分組，再算每部電影的 平均評分(avg_rating) 和 被評分次數(rating_count)
rating_stats = (
    ratings.groupby("movieId", as_index=False)
    .agg(
        avg_rating=("rating", "mean"),
        rating_count=("rating", "size")
    )
)


# -- 把三張表接成一張可用電影資料表 --
df = (
    movies
    .merge(rating_stats, on="movieId", how="left")
    .merge(links, on="movieId", how="left")
)


# -- 缺值處理 -- 把「沒有任何人評分的電影」的評分欄位，從 NaN 轉成 0，避免後續運算與排序失效。
df["avg_rating"] = df["avg_rating"].fillna(0)
df["rating_count"] = df["rating_count"].fillna(0)


# --- 欄位命名與排序 ---
# 將欄位名稱統一命名格式，以提升程式與資料庫的一致性
# 並僅保留推薦系統所需之核心欄位，依預定順序建立最終電影資料表結構。
df_final = df.rename(columns={
    "movieId": "movie_id",
    "imdbId": "imdb_id",
    "tmdbId": "tmdb_id"
})[[
    "movie_id", "title", "genres", "year",
    "avg_rating", "rating_count",
    "imdb_id", "tmdb_id"
]]



# ---新增中文片名、地區與海報欄 ---
df_final["title_zh"] = None     # 中文片名（之後可補）
df_final["region"] = None       # 地區（之後可補）
df_final["poster_url"] = None   # 海報連結（空欄位，之後可補）



# --- 將欄位順序調整 ---
df_final = df_final[
    [
        "movie_id", "title", "title_zh", "genres", "year",
        "avg_rating", "rating_count",
        "imdb_id", "tmdb_id", "region", "poster_url"
    ]
]



# --- 匯出清洗完成之電影資料（完整資料，未抽樣） ---
df_final.to_csv("movies_full.csv", index=False, encoding="utf-8-sig")
print(f"✅ 已完成電影資料清洗，共 {len(df_final)} 筆（未抽樣）")