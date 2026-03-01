from sqlalchemy import create_engine, text
import pandas as pd

# === 1️⃣ 建立連線 ===
engine = create_engine(
    "postgresql://movielens_user:3NynBzPRPrjdT3mlByKzixFmksEN6fWx@dpg-d3m9hfl6ubrc73ek0m1g-a.oregon-postgres.render.com/movielens"
)

try:
    with engine.connect() as conn:
        print("✅ 成功連線至 Render PostgreSQL！")
except Exception as e:
    print("❌ 連線失敗：", e)


# === 2️⃣ 先刪除原本的 movies 資料表 ===
with engine.connect() as conn:
    conn.execute(text("DROP TABLE IF EXISTS movies;"))
    conn.commit()
    print("🗑️ 已刪除舊的 movies 資料表")


# === 3️⃣ 重新建立新的 movies 表（加入 region 欄位）===
with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE movies (
            movie_id INT PRIMARY KEY,
            title TEXT,
            title_zh TEXT,          
            genres TEXT,
            year INT,
            avg_rating FLOAT,
            rating_count INT,
            popularity_score FLOAT,
            imdb_id TEXT,
            tmdb_id TEXT,
            region TEXT
        );
    """))
    conn.commit()

print("✅ 新的 movies 資料表建立完成！（已含 region 欄位）")


# === 4️⃣ 驗證欄位結構 ===
query = """
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'movies';
"""

df = pd.read_sql(query, engine)
print(df)

