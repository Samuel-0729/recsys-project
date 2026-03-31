import os
import json
import uuid
import random
import re

import psycopg2
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()  # 載入 .env

# 建立 Flask app
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")

# 允許前端呼叫後端 API
CORS(app, resources={r"/api/*": {"origins": "*"}})


# 建立資料庫連線
def get_conn():
    db_url = os.getenv("DB_URL")
    if not db_url:
        raise RuntimeError("DB_URL not set in .env")
    return psycopg2.connect(db_url)


# --------------------------------------------------------------------------------------------
# 檢查後端和資料庫有沒有正常運作
@app.get("/api/health")
def health():
    try:
        with get_conn() as conn:   #連資料庫
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM movies;")
                (movie_count,) = cur.fetchone() #取得結果

        #成功回傳
        return jsonify(
            {
                "status": "ok",
                "db": "connected",
                "movie_count": movie_count,
            }
        ), 200
    #錯誤回傳
    except Exception as e:
        return jsonify(
            {
                "status": "error",
                "db": "not_connected",
                "message": str(e),
            }
        ), 500


# --------------------------------------------------------------------------------------------
# Consent：建立受試者＋隨機分組（E/B）
@app.post("/api/consent")
def consent():
    """
    使用者按下「同意 / 開始」時呼叫
    - 建立 participant (UUID)
    - 隨機分派 grp = 'E' or 'B'
    - 寫入 participants
    - 回傳 participant_id 與 grp
    """
    try:
        participant_id = str(uuid.uuid4()) #產生一個「唯一編號」
        grp = random.choice(["E", "B"]) #隨機分組

       #寫入資料庫
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                """
                INSERT INTO participants (participant_id, grp, created_at)
                VALUES (%s, %s, now() AT TIME ZONE 'Asia/Taipei');
                """,
                (participant_id, grp),
            )
            conn.commit()

        return jsonify({"participant_id": participant_id, "grp": grp}), 201 #回傳給前端，

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# --------------------------------------------------------------------------------------------
# 幫每部電影自動產生推薦說明
def _genres_list(genres_value): #把 "Action|Sci-Fi"變成 ["Action", "Sci-Fi"] 方便後面比對
    if not genres_value:
        return []
    if isinstance(genres_value, str):
        return [g.strip() for g in genres_value.split("|") if g.strip()]
    return list(genres_value)

#找 使用者喜歡的類型 有沒有符合
def _overlap_genres(user_genres, movie_genres_str):
    mg = set(_genres_list(movie_genres_str))
    return [g for g in (user_genres or []) if g in mg]

#排序原因
def _sort_reason(sort_by, movie):
    avg = float(movie.get("avg_rating") or 0)
    cnt = int(movie.get("rating_count") or 0)
    year = movie.get("year")

    if sort_by == "評分較高優先":
        return f"再加上你選擇了「評分較高優先」，因此優先將本片推薦給你（平均 {avg:.1f} 分）"
    if sort_by == "評價人數多優先":
        return f"並依照你選擇的「評價人數多優先」優先推薦給你（評價數 {cnt:,}）"
    if sort_by == "最新上映優先":
        return f"並依照你選擇的「最新上映優先」優先推薦給你（上映年份 {year}）"
    return f"並依照你選擇的「{sort_by}」排序優先推薦給你"


#整段推薦說明的生成器
def build_explanation(rank: int, movie: dict, prefs: dict) -> str:
    """
    rank: 1~5（第幾名）
    movie: 單部電影 dict
    prefs: 使用者偏好 dict
    """
    #抓電影資料
    title = movie.get("title_zh") or movie.get("title") or "這部電影"
    avg = float(movie.get("avg_rating") or 0)
    cnt = int(movie.get("rating_count") or 0)


    # 抓使用者偏好
    region_group = prefs.get("region_group")
    y_min = prefs.get("year_min")
    y_max = prefs.get("year_max")
    min_rating = float(prefs.get("min_rating") or 0)
    user_genres = prefs.get("genres") or []
    sort_by = prefs.get("sort_by") or "評分較高優先"

    # 算類型符合
    overlap = _overlap_genres(user_genres, movie.get("genres"))
    overlap_str = "、".join(overlap) if overlap else "你選擇的類型"

    # 年份範圍
    year_range = f"{y_min or '不限'}–{y_max or '不限'}"

    # 地區文字
    region_txt = f"「{region_group}」" if region_group else "你選擇的地區"

    # 排序原因
    sort_reason = _sort_reason(sort_by, movie)

    # 門檻文字：避免「超過/+0.0」
    # 以 1 位小數比較
    avg1 = round(avg, 1)
    min1 = round(min_rating, 1)

    if avg1 > min1:
        rating_clause = f"評分 {avg1:.1f} 高於門檻（+{(avg1 - min1):.1f}）"
    else:
        # avg1 == min1 或 avg1 < min1
        rating_clause = f"評分 {avg1:.1f} 已達到你的最低門檻"

    # 漸進式模板
    templates = [
        # 1
        "這部片來自你偏好的{region_txt} 且屬於 {overlap_str}類型，{rating_clause}，{sort_reason}。",
        # 2
        "這部片落在你設定的條件內（年份 {year_range}、最低評分 {minr:.1f}），且符合 {overlap_str}類型，因此也很適合你（評價人數：{cnt:,} 人）。",
        # 3
        "這部片口碑表現穩定（評分 {avg1:.1f}／{cnt:,} 人評價），同時符合你偏好的 {overlap_str}類型 與年份範圍，是一部值得你考慮觀看的作品。",
        # 4
        "這部片符合 {overlap_str}類型，且{rating_clause}，加上評價數也不少（{cnt:,}），因此也可能符合你的觀影偏好。。",
        # 5 
        "這部片同樣符合你偏好的{region_txt} 且屬於 {overlap_str}類型，年份也在 {year_range} 範圍內，且{rating_clause}，因此很適合作為備選（評價人數：{cnt:,} 人）。",
    ]

    #把資料塞進句子，變成：完整推薦說明
    t = templates[min(max(rank, 1), 5) - 1]
    return t.format(
        title=title,
        region_txt=region_txt,
        overlap_str=overlap_str,
        year_range=year_range,
        avg1=avg1,
        minr=min_rating,
        rating_clause=rating_clause,
        cnt=cnt,
        sort_reason=sort_reason,
    )

# --------------------------------------------------------------------------------------------
# 根據使用者偏好 → 找電影 → 排序 → 回傳推薦結果
@app.post("/api/recommend")
def recommend():
    try:
        data = request.get_json(silent=True) or {} #接收使用者資料

        participant_id = data.get("participant_id") #確認 participant_id
        if not participant_id:
            return jsonify({"status": "error", "message": "participant_id is required"}), 400

        # 偏好 
        region_group = data.get("region_group")
        region = data.get("region")
        year_min = data.get("year_min")
        year_max = data.get("year_max")
        genres = data.get("genres") or []
        min_rating = data.get("min_rating")
        sort_by = data.get("sort_by") or "評分較高優先"

        # 轉型
        year_min0 = int(year_min) if year_min is not None else None
        year_max0 = int(year_max) if year_max is not None else None
        min_rating0 = float(min_rating) if min_rating is not None else None

        original_prefs = {
            "region_group": region_group,
            "year_min": year_min0,
            "year_max": year_max0,
            "genres": genres,
            "min_rating": min_rating0,
            "sort_by": sort_by,
        }

        # sort_by 
        allowed_sort = {"評分較高優先", "評價人數多優先", "最新上映優先"}
        sort_key = original_prefs["sort_by"]
        if sort_key not in allowed_sort:
            sort_key = "評分較高優先"
            original_prefs["sort_by"] = sort_key

        # 查此人是哪一組
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT grp FROM participants WHERE participant_id=%s;",
                    (participant_id,)
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"status": "error", "message": "participant_id not found"}), 404
                grp = row[0]

        # 地區分組 
        ASIA = ["TW","CN","HK","JP","KR","TH","IN","ID","IL","IR","LB","MN","PS"]
        EUROPE = ["GB","IE","FR","DE","ES","IT","NL","BE","DK","NO","SE","FI","CH","AT","PL","PT","GR","CZ","SK","HU","RO","BG","RS","BA","IS"]
        AMERICAS = ["US","CA","MX","AR","BR","CO"]
        OTHER = ["AU","NZ","ZA","AE","RU","TR"]
        WEST = EUROPE + AMERICAS

        REGION_GROUPS = {
            "亞洲": ASIA,
            "歐美": WEST,
            "其他地區": OTHER,
            "Asia": ASIA,
            "ASIA": ASIA,
            "West": WEST,
            "WEST": WEST,
            "Europe+Americas": WEST,
            "Other": OTHER,
            "OTHER": OTHER,
        }

        COUNTRY_ZH = {
            "TW": "台灣","CN": "中國","HK": "香港","JP": "日本","KR": "韓國","TH": "泰國",
            "IN": "印度","ID": "印尼","IL": "以色列","IR": "伊朗","LB": "黎巴嫩","MN": "蒙古","PS": "巴勒斯坦",
            "GB": "英國","IE": "愛爾蘭","FR": "法國","DE": "德國","ES": "西班牙","IT": "義大利",
            "NL": "荷蘭","BE": "比利時","DK": "丹麥","NO": "挪威","SE": "瑞典","FI": "芬蘭",
            "CH": "瑞士","AT": "奧地利","PL": "波蘭","PT": "葡萄牙","GR": "希臘","CZ": "捷克",
            "SK": "斯洛伐克","HU": "匈牙利","RO": "羅馬尼亞","BG": "保加利亞","RS": "塞爾維亞",
            "BA": "波士尼亞與赫塞哥維納","IS": "冰島",
            "US": "美國","CA": "加拿大","MX": "墨西哥","AR": "阿根廷","BR": "巴西","CO": "哥倫比亞",
            "AU": "澳洲","NZ": "紐西蘭","ZA": "南非","AE": "阿拉伯聯合大公國","RU": "俄羅斯","TR": "土耳其",
        }

       
        RC = "COALESCE(NULLIF(regexp_replace(rating_count::text, '[^0-9]', '', 'g'), ''), '0')::int"
        AR_ROUND = "ROUND(COALESCE(avg_rating, 0)::numeric, 1)"
        YR = "COALESCE(year, 0)::int"

        # 設定排序邏輯
        order_map = {
            "評分較高優先": "genre_match_count DESC, avg_rating_round_sort DESC, rating_count_sort DESC, year_sort DESC, movie_id ASC",
            "評價人數多優先": "genre_match_count DESC, rating_count_sort DESC, avg_rating_round_sort DESC, year_sort DESC, movie_id ASC",
            "最新上映優先": "genre_match_count DESC, year_sort DESC, avg_rating_round_sort DESC, rating_count_sort DESC, movie_id ASC",
        }
        order_sql = order_map.get(sort_key, order_map["評分較高優先"])


        # 硬條件 WHERE（地區 / 年份 / 最低評分）
        where = []
        params = []

        if region_group:
            codes = REGION_GROUPS.get(region_group)
            if not codes:
                return jsonify({
                    "status": "error",
                    "message": "invalid region_group (allowed: 亞洲/歐美/其他地區)"
                }), 400
            where.append("region = ANY(%s)")
            params.append(codes)
        elif region:
            where.append("region = %s")
            params.append(region)

        if year_min0 is not None:
            where.append("year >= %s")
            params.append(year_min0)

        if year_max0 is not None:
            where.append("year <= %s")
            params.append(year_max0)

        if min_rating0 is not None:
            where.append(f"{AR_ROUND} >= %s")
            params.append(min_rating0)

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        rows = []

        with get_conn() as conn:
            with conn.cursor() as cur:

                # 類型匹配
                if not genres:
                    cur.execute(f"SELECT COUNT(*) FROM movies {where_sql};", tuple(params))
                    (found,) = cur.fetchone()

                    raw_order_sql = {
                        "評分較高優先": f"{AR_ROUND} DESC, {RC} DESC, {YR} DESC, movie_id ASC",
                        "評價人數多優先": f"{RC} DESC, {AR_ROUND} DESC, {YR} DESC, movie_id ASC",
                        "最新上映優先": f"{YR} DESC, {AR_ROUND} DESC, {RC} DESC, movie_id ASC",
                    }[sort_key]

                    cur.execute(
                        f"""
                        SELECT
                            movie_id, title, title_zh, genres, year,
                            avg_rating, rating_count, region, poster_url,
                            {RC} AS rating_count_sort,
                            {AR_ROUND} AS avg_rating_round_sort,
                            {YR} AS year_sort,
                            NULL::int AS genre_match_count
                        FROM movies
                        {where_sql}
                        ORDER BY {raw_order_sql}
                        LIMIT 5;
                        """,
                        tuple(params),
                    )
                    rows = cur.fetchall()

                # =====================================================
                # 有選 genres
                # - 計算每部電影符合幾個使用者選的類型
                # - 至少符合 1 個類型才進候選
                # - 排序時 genre_match_count 優先
                # =====================================================
                else:
                    genre_patterns = [
                        rf"(^|\|){re.escape(g)}(\||$)"
                        for g in genres
                    ]

                    genre_match_expr_parts = []
                    for p in genre_patterns:
                        safe_p = p.replace("'", "''")
                        genre_match_expr_parts.append(
                            f"CASE WHEN genres ~* '{safe_p}' THEN 1 ELSE 0 END"
                        )

                    genre_match_expr = " + ".join(genre_match_expr_parts)

                    base_sql = f"""
                        SELECT
                            movie_id, title, title_zh, genres, year,
                            avg_rating, rating_count, region, poster_url,
                            {RC} AS rating_count_sort,
                            {AR_ROUND} AS avg_rating_round_sort,
                            {YR} AS year_sort,
                            ({genre_match_expr}) AS genre_match_count
                        FROM movies
                        {where_sql}
                    """

                    base_params = list(params)

                    # 只要至少中 1 個類型就納入候選
                    min_match_required = 1

                    cur.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM (
                            {base_sql}
                        ) t
                        WHERE genre_match_count >= %s;
                        """,
                        tuple(base_params + [min_match_required]),
                    )
                    (found,) = cur.fetchone()

                    cur.execute(
                        f"""
                        SELECT *
                        FROM (
                            {base_sql}
                        ) t
                        WHERE genre_match_count >= %s
                        ORDER BY {order_sql}
                        LIMIT 5;
                        """,
                        tuple(base_params + [min_match_required]),
                    )
                    rows = cur.fetchall()

        need_retry = (found == 0)
        insufficient = (0 < found < 5)

        # 整理結果
        results = []
        for r in rows:
            country_code = r[7]
            results.append({
                "movie_id": r[0],
                "title": r[1],
                "title_zh": r[2],
                "genres": r[3],
                "year": int(r[4]) if r[4] is not None else None,
                "avg_rating": float(r[5]) if r[5] is not None else None,
                "avg_rating_round_sort": float(r[10]) if r[10] is not None else None,
                "rating_count_raw": r[6],
                "rating_count": int(r[9]) if r[9] is not None else 0,
                "rating_count_sort": int(r[9]) if r[9] is not None else 0,
                "region": country_code,
                "country": country_code,
                "country_zh": COUNTRY_ZH.get(country_code, country_code),
                "poster_url": r[8],
                "genre_match_count": int(r[12]) if r[12] is not None else None,
            })

        # E組才加 explanation
        if grp == "E":
            for i, m in enumerate(results, start=1):
                m["explanation"] = build_explanation(i, m, original_prefs)

        # 寫 log 
        log_id = str(uuid.uuid4())
        recommended_ids = [int(m["movie_id"]) for m in results]

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO recommendation_logs
                    (log_id, participant_id, grp, preferences, recommended_movie_ids, created_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s, now() AT TIME ZONE 'Asia/Taipei');
                    """,
                    (
                        log_id,
                        participant_id,
                        grp,
                        json.dumps(original_prefs),
                        recommended_ids
                    ),
                )

                cur.execute(
                    "SELECT COUNT(*) FROM recommendation_logs WHERE log_id=%s;",
                    (log_id,)
                )
                (written_cnt,) = cur.fetchone()

                cur.execute("SELECT current_database(), current_schema(), current_user;")
                db_name, schema_name, db_user = cur.fetchone()

            conn.commit()

        #回傳給前端
        return jsonify({
            "api_version": "2026-03-29-genre-match-score-v1",
            "participant_id": participant_id,
            "grp": grp,
            "log_id": log_id,
            "log_written_cnt": int(written_cnt),
            "log_db_name": db_name,
            "log_schema": schema_name,
            "log_db_user": db_user,
            "need_retry": need_retry,
            "insufficient": insufficient,
            "found": int(found),
            "preferences": original_prefs,
            "results": results,
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

# --------------------------------------------------------------------------------------------
# Options：給前端 PrefsPage 用
@app.get("/api/options")
def options():
    """
    提供前端偏好頁需要的動態選項：
    - 洲別群組（固定）
    - 年份範圍
    - 評分範圍
    - 類型清單
    - 排序選項
    """
    try:
        with get_conn() as conn: #連資料庫
            with conn.cursor() as cur:
                # 找 年份 & 評分範圍
                cur.execute(
                    """
                    SELECT
                        MIN(year)::int,
                        MAX(year)::int,
                        MIN(avg_rating)::float,
                        MAX(avg_rating)::float
                    FROM movies;
                    """
                )
                year_min, year_max, rating_min, rating_max = cur.fetchone()

                # 找 所有電影類型
                cur.execute(
                    """
                    SELECT DISTINCT
                        unnest(string_to_array(genres, '|')) AS g
                    FROM movies
                    WHERE genres IS NOT NULL
                      AND genres <> ''
                    ORDER BY g;
                    """
                )
                genres = [r[0] for r in cur.fetchall()]

        # 固定選項
        region_groups = ["亞洲", "歐美", "其他地區"]
        sort_options = ["評分較高優先", "評價人數多優先", "最新上映優先"]

        # 回傳給前端
        return jsonify(
            {
                "region_groups": region_groups,
                "year_min": year_min or 2000,
                "year_max": year_max or 2023,
                "rating_min": float(rating_min) if rating_min is not None else 0.0,
                "rating_max": float(rating_max) if rating_max is not None else 5.0,
                "genres": genres,
                "sort_options": sort_options,
            }
        ), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# --------------------------------------------------------------------------------------------
# 啟動
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

