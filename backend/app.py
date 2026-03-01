import os
import json
import uuid
import random

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
# 健康檢查：確認 Flask + DB + movies 表
@app.get("/api/health")
def health():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM movies;")
                (movie_count,) = cur.fetchone()

        return jsonify(
            {
                "status": "ok",
                "db": "connected",
                "movie_count": movie_count,
            }
        ), 200

    except Exception as e:
        return jsonify(
            {
                "status": "error",
                "db": "not_connected",
                "message": str(e),
            }
        ), 500


# --------------------------------------------------------------------------------------------
# Consent：建立 participant + 隨機分組
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
        participant_id = str(uuid.uuid4())
        grp = random.choice(["E", "B"])

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO participants (participant_id, grp)
                    VALUES (%s, %s);
                    """,
                    (participant_id, grp),
                )
            conn.commit()

        return jsonify({"participant_id": participant_id, "grp": grp}), 201

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# --------------------------------------------------------------------------------------------
# Explanation helpers
def _genres_list(genres_value):
    # DB genres 可能是 "Action|Sci-Fi"
    if not genres_value:
        return []
    if isinstance(genres_value, str):
        return [g.strip() for g in genres_value.split("|") if g.strip()]
    return list(genres_value)


def _overlap_genres(user_genres, movie_genres_str):
    mg = set(_genres_list(movie_genres_str))
    return [g for g in (user_genres or []) if g in mg]


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


def build_explanation(rank: int, movie: dict, prefs: dict) -> str:
    """
    rank: 1~5（第幾名）
    movie: 單部電影 dict
    prefs: 使用者偏好 dict
    """

    title = movie.get("title_zh") or movie.get("title") or "這部電影"
    avg = float(movie.get("avg_rating") or 0)
    cnt = int(movie.get("rating_count") or 0)

    # ✅ 用 region_group（你前面 preferences 已不存 region 了）
    region_group = prefs.get("region_group")
    y_min = prefs.get("year_min")
    y_max = prefs.get("year_max")
    min_rating = float(prefs.get("min_rating") or 0)
    user_genres = prefs.get("genres") or []
    sort_by = prefs.get("sort_by") or "評分較高優先"

    # 類型交集
    overlap = _overlap_genres(user_genres, movie.get("genres"))
    overlap_str = "、".join(overlap) if overlap else "你選擇的類型"

    # 年份範圍
    year_range = f"{y_min or '不限'}–{y_max or '不限'}"

    # 地區文字（若沒選就不硬塞）
    region_txt = f"地區「{region_group}」" if region_group else "你選擇的地區"

    # 排序原因
    sort_reason = _sort_reason(sort_by, movie)

    # ✅ 門檻文字：避免「超過/+0.0」尷尬
    # 以 1 位小數比較，符合你 UI
    avg1 = round(avg, 1)
    min1 = round(min_rating, 1)

    if avg1 > min1:
        rating_clause = f"評分 {avg1:.1f} 高於門檻（+{(avg1 - min1):.1f}）"
    else:
        # avg1 == min1 或 avg1 < min1（理論上不會低於，因為你有篩選）
        rating_clause = f"評分 {avg1:.1f} 已達到你的最低門檻"

    # ✅ 讓 1~5 名語氣更自然、漸進式，且都會提到「類型」
    templates = [
        # 1
        "這部片符合{region_txt} 與 {overlap_str}類型，{rating_clause}，{sort_reason}。",
        # 2
        "這部片落在你設定的條件內（年份 {year_range}、最低評分 {minr:.1f}），且符合 {overlap_str}類型，因此也很適合你（評價人數：{cnt:,} 人）。",
        # 3
        "這部片口碑表現穩定（評分 {avg1:.1f}／{cnt:,} 人評價），同時符合你偏好的 {overlap_str}類型 與 年份範圍，是一部值得你考慮觀看的作品。",
        # 4
        "這部片符合 {overlap_str}類型，且{rating_clause}，加上評價數也不少（{cnt:,}），因此也可能符合你的觀影偏好。。",
        # 5 ✅ 修正：符合門檻 + 補類型
        "這部片同樣符合{region_txt} 與 {overlap_str}類型，年份也在 {year_range} 範圍內，且{rating_clause}，因此很適合作為備選（評價人數：{cnt:,} 人）。",
    ]

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
@app.post("/api/recommend")
def recommend():
    try:
        data = request.get_json(silent=True) or {}

        participant_id = data.get("participant_id")
        if not participant_id:
            return jsonify({"status": "error", "message": "participant_id is required"}), 400

        # ==== 偏好 ====
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

        # ✅ preferences：不存 region（避免 region=null）
        original_prefs = {
            "region_group": region_group,
            "year_min": year_min0,
            "year_max": year_max0,
            "genres": genres,
            "min_rating": min_rating0,
            "sort_by": sort_by,
        }

        # sort_by 防呆
        allowed_sort = {"評分較高優先", "評價人數多優先", "最新上映優先"}
        sort_key = original_prefs["sort_by"]
        if sort_key not in allowed_sort:
            sort_key = "評分較高優先"
            original_prefs["sort_by"] = sort_key

        # ==== 查組別 ====
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT grp FROM participants WHERE participant_id=%s;", (participant_id,))
                row = cur.fetchone()
                if not row:
                    return jsonify({"status": "error", "message": "participant_id not found"}), 404
                grp = row[0]

        # ==== 地區群組 ====
        ASIA = ["TW","CN","HK","JP","KR","TH","IN","ID","IL","IR","LB","MN","PS"]
        EUROPE = ["GB","IE","FR","DE","ES","IT","NL","BE","DK","NO","SE","FI","CH","AT","PL","PT","GR","CZ","SK","HU","RO","BG","RS","BA","IS"]
        AMERICAS = ["US","CA","MX","AR","BR","CO"]
        OTHER = ["AU","NZ","ZA","AE","RU","TR"]
        WEST = EUROPE + AMERICAS

        REGION_GROUPS = {
            "亞洲": ASIA, "歐美": WEST, "其他地區": OTHER,
            "Asia": ASIA, "ASIA": ASIA,
            "West": WEST, "WEST": WEST, "Europe+Americas": WEST,
            "Other": OTHER, "OTHER": OTHER,
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
            "AU": "澳洲","NZ": "紐西蘭","ZA": "南非","AE": "阿聯","RU": "俄羅斯","TR": "土耳其",
        }

        # =========================================================
        # ✅ 排序規則：完全符合 UI（不再用 AR_RAW）
        # 1) ROUND(avg_rating,1)
        # 2) rating_count
        # 3) year
        # 4) movie_id（穩定排序）
        # =========================================================
        RC = "COALESCE(NULLIF(regexp_replace(rating_count::text, '[^0-9]', '', 'g'), ''), '0')::int"
        AR_ROUND = "ROUND(COALESCE(avg_rating, 0)::numeric, 1)"
        YR = "COALESCE(year, 0)::int"
        STABLE = "movie_id ASC"

        order_map = {
            "評分較高優先": f"{AR_ROUND} DESC, {RC} DESC, {YR} DESC, {STABLE}",
            "評價人數多優先": f"{RC} DESC, {AR_ROUND} DESC, {YR} DESC, {STABLE}",
            "最新上映優先": f"{YR} DESC, {AR_ROUND} DESC, {RC} DESC, {STABLE}",
        }
        order_sql = order_map.get(sort_key, order_map["評分較高優先"])

        # ==== WHERE ====
        where = []
        params = []

        if region_group:
            codes = REGION_GROUPS.get(region_group)
            if not codes:
                return jsonify({"status": "error", "message": "invalid region_group (allowed: 亞洲/歐美/其他地區)"}), 400
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

        # ✅ min_rating：也用 ROUND(1) 比較，保持「UI顯示一致」
        if min_rating0 is not None:
            where.append(f"{AR_ROUND} >= %s")
            params.append(min_rating0)

        if genres:
            clauses = []
            for g in genres:
                clauses.append("genres ~* %s")
                params.append(rf"(^|\|){g}(\||$)")
            where.append("(" + " OR ".join(clauses) + ")")

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        # ==== 查資料 ====
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM movies {where_sql};", tuple(params))
                (found,) = cur.fetchone()

                cur.execute(
                    f"""
                    SELECT movie_id, title, title_zh, genres, year,
                           avg_rating, rating_count, region, poster_url,
                           {RC} AS rating_count_sort,
                           {AR_ROUND} AS avg_rating_round_sort
                    FROM movies
                    {where_sql}
                    ORDER BY {order_sql}
                    LIMIT 5;
                    """,
                    tuple(params),
                )
                rows = cur.fetchall()

        need_retry = found == 0
        insufficient = (0 < found < 5)

        # ==== 整理結果 ====
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
            })

        if grp == "E":
            for i, m in enumerate(results, start=1):
                m["explanation"] = build_explanation(i, m, original_prefs)

        # ==== 寫 log（強制驗證版）====
        log_id = str(uuid.uuid4())
        recommended_ids = [int(m["movie_id"]) for m in results]

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO recommendation_logs
                    (log_id, participant_id, grp, preferences, recommended_movie_ids)
                    VALUES (%s, %s, %s, %s::jsonb, %s);
                    """,
                    (log_id, participant_id, grp, json.dumps(original_prefs), recommended_ids),
                )

                cur.execute("SELECT COUNT(*) FROM recommendation_logs WHERE log_id=%s;", (log_id,))
                (written_cnt,) = cur.fetchone()

                cur.execute("SELECT current_database(), current_schema(), current_user;")
                db_name, schema_name, db_user = cur.fetchone()

            conn.commit()

        return jsonify({
            "api_version": "2026-02-28-ui-consistent-v1",
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
        with get_conn() as conn:
            with conn.cursor() as cur:
                # 年份 & 評分範圍
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

                # 類型清單
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

        region_groups = ["亞洲", "歐美", "其他地區"]
        sort_options = ["評分較高優先", "評價人數多優先", "最新上映優先"]

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

