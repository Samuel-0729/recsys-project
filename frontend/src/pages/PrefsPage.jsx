import { useEffect, useMemo, useState } from "react"; //引入 React hooks
import { useNavigate } from "react-router-dom"; //路由跳轉

//統一後端 API 的 base URL，後面呼叫 /api/options、/api/recommend 會用到
const API_BASE = "http://127.0.0.1:5000";

// 確保中文顯示正常
const FONT_TC =
  '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",system-ui,-apple-system,"Segoe UI",Arial,sans-serif';

// 用來產生「地區下拉選單」
const REGION_GROUP_OPTIONS = [
  { value: "亞洲", label: "亞洲" },
  { value: "歐美", label: "歐美" },
  { value: "其他地區", label: "其他地區" },
];

//類型中英對照
const GENRE_LABEL = {
  Action: "動作",
  Adventure: "冒險",
  Animation: "動畫",
  Children: "兒童",
  Comedy: "喜劇",
  Crime: "犯罪",
  Documentary: "紀錄片",
  Drama: "劇情",
  Fantasy: "奇幻",
  "Film-Noir": "黑色電影",
  Horror: "恐怖",
  IMAX: "IMAX",
  Musical: "音樂/歌舞",
  Mystery: "懸疑",
  Romance: "愛情",
  "Sci-Fi": "科幻",
  Thriller: "驚悚",
  War: "戰爭",
};

//排序顯示文字
const SORT_LABEL = {
  評分較高優先: "評分最高優先",
  評價人數多優先: "評價人數多優先",
  最新上映優先: "最新上映優先",
};

//類型最多 3 個
const MAX_GENRES = 3;

/** ✅ 小工具：響應式 breakpoints（手機/平板/桌機） */
function useResponsiveBreakpoints() {
  const getW = () => (typeof window !== "undefined" ? window.innerWidth : 1200);
  const [w, setW] = useState(getW());

  useEffect(() => {
    const onResize = () => setW(getW());
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    width: w,
    isMobile: w <= 640,
    isTablet: w > 640 && w <= 960,
  };
}

/*
「偏好設定頁」，負責：
 1.檢查使用者是否已建立 participant（沒建立就回首頁）
 2.抓後端 options（genres、年份範圍、評分範圍、排序選項）
 3.讓使用者選偏好
 4.送出 /api/recommend，成功後跳到結果頁
*/
export default function PrefsPage() {
  const navigate = useNavigate();
  const { isMobile, isTablet } = useResponsiveBreakpoints();

  // 身分狀態：participantId / grp
  const [participantId, setParticipantId] = useState(""); //受試者編號（從 consent page 生成並存到 localStorage）
  const [grp, setGrp] = useState(""); // 分組（Explainable 組/Control 組）

  // options 狀態：抓 /api/options 用
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsErr, setOptionsErr] = useState("");
  const [genresOptions, setGenresOptions] = useState([]);
  const [sortOptions, setSortOptions] = useState([
    "評分較高優先",
    "評價人數多優先",
    "最新上映優先",
  ]);

  // DB 範圍狀態：後端回傳的可用範圍
  const [yearMinDb, setYearMinDb] = useState(2000);
  const [yearMaxDb, setYearMaxDb] = useState(2023);
  const [ratingMinDb, setRatingMinDb] = useState(0);
  const [ratingMaxDb, setRatingMaxDb] = useState(5);

  // 使用者偏好狀態：實際要送給後端的條件
  const [regionGroup, setRegionGroup] = useState("亞洲");
  const [yearMin, setYearMin] = useState(2010);
  const [yearMax, setYearMax] = useState(2023);
  const [minRating, setMinRating] = useState(3.5);
  const [genres, setGenres] = useState([]);
  const [sortBy, setSortBy] = useState("評分較高優先");

  // ---------- UI 狀態 ----------
  const [loading, setLoading] = useState(false); //避免連點
  const [err, setErr] = useState(""); //推薦 API 失敗顯示

  // 類型相關訊息：最多3個 / 至少1個
  const [genreWarn, setGenreWarn] = useState("");
  const [genreReqErr, setGenreReqErr] = useState("");

  // 條件太嚴提示（noticePanel）
  const [strictHint, setStrictHint] = useState("");

  //讀 localStorage 的 participant_id、grp、last_prefs
  useEffect(() => {
    const pid = localStorage.getItem("participant_id");
    const g = localStorage.getItem("grp") || "";

    if (!pid) {
      navigate("/", { replace: true });
      return;
    }

    setParticipantId(pid);
    setGrp(g);

    // 回來頁面保留使用者上次選擇
    try {
      const raw = localStorage.getItem("last_prefs");
      if (!raw) return;

      const p = JSON.parse(raw);
      if (p?.region_group) setRegionGroup(String(p.region_group));
      if (Number.isFinite(Number(p?.year_min))) setYearMin(Number(p.year_min));
      if (Number.isFinite(Number(p?.year_max))) setYearMax(Number(p.year_max));
      if (Number.isFinite(Number(p?.min_rating))) setMinRating(Number(p.min_rating));
      if (Array.isArray(p?.genres)) setGenres(p.genres);
      if (p?.sort_by) setSortBy(String(p.sort_by));
    } catch {
      // ignore
    }
  }, [navigate]);

  //useEffect（抓 options）：GET /api/options
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setOptionsLoading(true);
      setOptionsErr("");

      try {
        const res = await fetch(`${API_BASE}/api/options`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "options failed");
        if (cancelled) return;

        // genres（移除未分類與 Western）
        const gen = (data.genres || []).filter((g) => g !== "(no genres listed)" && g !== "Western");

        // sort options（若後端沒給就用預設）
        const sorts = data.sort_options || ["評分較高優先", "評價人數多優先", "最新上映優先"];

        const yMin = Number(data.year_min ?? 2000);
        const yMax = Number(data.year_max ?? 2023);
        const rMin = Number(data.rating_min ?? 0);
        const rMax = Number(data.rating_max ?? 5);

        setGenresOptions(gen);
        setSortOptions(sorts);

        setYearMinDb(yMin);
        setYearMaxDb(yMax);
        setRatingMinDb(rMin);
        setRatingMaxDb(rMax);

        // 清掉 Western（保險）
        setGenres((prev) => (prev || []).filter((x) => x !== "Western"));

        // 把目前偏好校正到 DB 範圍
        setYearMin((prev) => clampInt(prev, yMin, yMax));
        setYearMax((prev) => clampInt(prev, yMin, yMax));

        // 評分 slider 校正（1位小數）
        setMinRating((prev) => clampToOneDecimal(prev, floor1(rMin), floor1(rMax)));

        // 若目前 genres 是空的：給一個預設（Action）
        setGenres((prev) => {
          const cleaned = (prev || []).filter((x) => x !== "Western");
          if (cleaned.length > 0) return cleaned;
          return gen.includes("Action") ? ["Action"] : [];
        });

        // sortBy 校正(預設)
        setSortBy((prev) => (sorts.includes(prev) ? prev : sorts[0] || "評分較高優先"));

        // regionGroup 校正
        setRegionGroup((prev) =>
          REGION_GROUP_OPTIONS.some((x) => x.value === prev) ? prev : "亞洲"
        );
      } catch (e) {
        if (!cancelled) setOptionsErr(e?.message || "options failed");
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  //產生年份下拉選單 yearOptions
  const yearOptions = useMemo(() => {
    const arr = [];
    for (let y = yearMinDb; y <= yearMaxDb; y++) arr.push(y);
    return arr;
  }, [yearMinDb, yearMaxDb]);

  //把 DB rating 範圍變成「1 位小數」的 slider 範圍
  const sliderMin = useMemo(() => floor1(ratingMinDb), [ratingMinDb]);
  const sliderMax = useMemo(() => floor1(ratingMaxDb), [ratingMaxDb]);

  // 如果後端回傳 rating 上下限有變，避免 minRating 超出 slider 範圍
  useEffect(() => {
    setMinRating((prev) => clampToOneDecimal(prev, sliderMin, sliderMax));
  }, [sliderMin, sliderMax]);

  //年份範圍提示
  const yearSpan = useMemo(() => Number(yearMax) - Number(yearMin), [yearMin, yearMax]);
  const showYearNarrowHint = useMemo(() => Number.isFinite(yearSpan) && yearSpan <= 3, [yearSpan]);

  // strictHint：條件太嚴提示
  useEffect(() => {
    const isNarrowYears = Number.isFinite(yearSpan) && yearSpan <= 2;
    const isHighRating = Number(minRating) >= 4.0;

    if (!isNarrowYears && !isHighRating) return setStrictHint("");

    if (isNarrowYears && isHighRating) {
      return setStrictHint(
        "你目前 年份範圍很窄、評分門檻也偏高，可能找不到 5 部；若推薦結果不足，請回來此頁面 放寬評分 / 年份 或 修改類型。"
      );
    }
    if (isHighRating) {
      return setStrictHint(
        "你目前 最低評分門檻偏高，可能找不到 5 部；若推薦結果不足，請回來此頁面 放寬評分 或 修改類型。"
      );
    }
    return setStrictHint(
      "你目前 年份範圍偏窄，可能找不到 5 部；若推薦結果不足，請回來此頁面 放寬年份範圍 或 修改類型。"
    );
  }, [yearSpan, minRating]);

  //toggleGenre：勾選類型 + 限制最多 3 個
  const toggleGenre = (g) => {
    setGenreWarn("");
    setGenreReqErr("");

    setGenres((prev) => {
      const cur = prev || [];
      if (cur.includes(g)) return cur.filter((x) => x !== g);

      if (cur.length >= MAX_GENRES) {
        setGenreWarn(`最多只能選 ${MAX_GENRES} 個類型`);
        return cur;
      }
      return [...cur, g];
    });
  };

  //onRecommend：按下產生推薦
  const onRecommend = async () => {
    if (loading) return;

    const safeGenresNow = (genres || []).filter((g) => g !== "Western");
    if (safeGenresNow.length === 0) {
      setGenreReqErr("請至少選擇 1 種電影類型");
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const lastPrefs = {
        region_group: regionGroup,
        year_min: Number(yearMin),
        year_max: Number(yearMax),
        min_rating: Number(minRating),
        genres: safeGenresNow,
        sort_by: sortBy,
      };
      localStorage.setItem("last_prefs", JSON.stringify(lastPrefs));

      const payload = {
        participant_id: participantId,
        region_group: regionGroup,
        year_min: Number(yearMin),
        year_max: Number(yearMax),
        genres: safeGenresNow,
        min_rating: Number(minRating),
        sort_by: sortBy,
      };

      const res = await fetch(`${API_BASE}/api/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rec = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(rec?.message || "recommend failed");

      if (rec?.grp) {
        localStorage.setItem("grp", String(rec.grp));
        setGrp(String(rec.grp));
      }

      localStorage.setItem("last_recommend_response", JSON.stringify(rec));
      navigate("/result");
    } catch (e) {
      setErr(e?.message || "recommend failed");
    } finally {
      setLoading(false);
    }
  };

  // UI helpers
  const selectedGenresText =
    (genres || []).length
      ? (genres || [])
          .filter((g) => g !== "Western")
          .map((g) => GENRE_LABEL[g] || g)
          .join("、")
      : "（未選）";

  const shortId = (id) => {
    if (!id) return "";
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  };

  // ✅ Styles（加入響應式）
  const styles = {
    page: {
      minHeight: "100vh",
      width: "100%",
      background: "#f8fafc",
      margin: 0,
      padding: 0,
      fontFamily: FONT_TC,
      color: "#111827",
    },
    container: {
      width: isMobile ? "calc(100vw - 24px)" : "min(1280px, calc(100vw - 64px))",
      margin: "0 auto",
      padding: isMobile ? "18px 0 28px" : isTablet ? "34px 0 50px" : "44px 0 64px",
    },
    mainCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      padding: isMobile ? "18px 14px 16px" : isTablet ? "28px 20px 20px" : "36px 28px 28px",
      boxShadow: isMobile ? "0 8px 22px rgba(2,6,23,0.06)" : "none",
    },

    titleRow: {
      display: "flex",
      alignItems: isMobile ? "flex-start" : "baseline",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
      marginBottom: 10,
    },
    title: {
      fontSize: isMobile ? 28 : isTablet ? 32 : 36,
      margin: 0,
      fontWeight: 900,
      color: "#1e40af",
      letterSpacing: 0.2,
      lineHeight: 1.2,
      paddingTop: 4,
      fontFamily: FONT_TC,

      // ✅ 手機置中 + 佔滿一行
      textAlign: isMobile ? "center" : "left",
      width: isMobile ? "100%" : "auto",
    },
    idLine: {
      fontSize: 13,
      color: "#64748b",
      fontWeight: 800,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      whiteSpace: "nowrap",
      width: isMobile ? "100%" : "auto",
      textAlign: isMobile ? "center" : "right",
    },
    lead: {
      marginTop: 12,
      marginBottom: 8,
      fontSize: isMobile ? 14.5 : 16,
      lineHeight: 1.95,
      color: "#334155",
      maxWidth: 980,
      fontFamily: FONT_TC,
      textAlign: isMobile ? "center" : "left",
    },
    divider: { height: 1, background: "#e2e8f0", margin: isMobile ? "16px 0 18px" : "22px 0 28px" },
    formGrid: { display: "grid", gridTemplateColumns: "1fr", gap: isMobile ? 14 : 20 },

    sectionCard: {
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      background: "#ffffff",
      overflow: "hidden",
    },
    sectionHeader: {
      padding: isMobile ? "14px 14px" : "16px 18px",
      background: "#f8fafc",
      borderBottom: "1px solid #e2e8f0",
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 10,
      flexWrap: "wrap",
      fontFamily: FONT_TC,
    },
    sectionTitle: {
      margin: 0,
      fontSize: isMobile ? 16 : 18,
      fontWeight: 900,
      color: "#0f172a",
      fontFamily: FONT_TC,
    },
    sectionMeta: {
      fontSize: isMobile ? 12.5 : 14,
      color: "#64748b",
      fontWeight: 800,
      fontFamily: FONT_TC,
    },
    sectionBody: { padding: isMobile ? "14px 14px 16px" : "16px 18px 18px", fontFamily: FONT_TC },

    help: {
      fontSize: 13,
      color: "#64748b",
      marginTop: 10,
      lineHeight: 1.7,
      fontFamily: FONT_TC,
    },

    select: {
      width: "100%",
      maxWidth: 760,
      border: "1px solid #cbd5e1",
      borderRadius: 12,
      padding: "12px 14px",
      background: "#fff",
      fontSize: 15,
      outline: "none",
      fontFamily: FONT_TC,
    },

    yearWrap: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(220px, 260px))",
      gap: 14,
      marginTop: 12,
      alignItems: "start",
    },
    tiny: {
      fontSize: 13,
      color: "#475569",
      fontWeight: 800,
      marginBottom: 6,
      fontFamily: FONT_TC,
    },

    genresWrap: {
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(110px, 1fr))",
      gap: "10px 14px",
      marginTop: 12,
    },

    checkboxLabel: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      fontSize: 15,
      color: "#0f172a",
      lineHeight: 1.2,
      whiteSpace: "nowrap",
      fontFamily: FONT_TC,
    },

    slider: { width: "100%", maxWidth: 860, marginTop: 12 },

    radiosWrap: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
      gap: "10px 14px",
      marginTop: 12,
    },

    noticePanel: {
      border: "1px solid #d6dee8",
      borderRadius: 12,
      padding: "14px 16px",
      background: "#f1f5f9",
      color: "#334155",
      fontSize: 14,
      lineHeight: 1.7,
      marginTop: 18,
      fontFamily: FONT_TC,
    },

    footer: {
      marginTop: 22,
      display: "flex",
      alignItems: "center",
      justifyContent: isMobile ? "center" : "flex-start",
      gap: 14,
      flexWrap: "wrap",
    },
    button: {
      padding: isMobile ? "12px 18px" : "12px 20px",
      fontSize: 16,
      borderRadius: 14,
      border: "1px solid #1e40af",
      background: loading ? "#93c5fd" : "#1e40af",
      color: "#ffffff",
      cursor: loading ? "not-allowed" : "pointer",
      fontWeight: 900,
      transition: "transform 120ms ease, opacity 120ms ease",
      fontFamily: FONT_TC,
      width: isMobile ? "100%" : "auto",
      maxWidth: isMobile ? 520 : "none",
    },
    error: {
      marginTop: 14,
      padding: 12,
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
      borderRadius: 12,
      fontSize: 14,
      lineHeight: 1.7,
      fontFamily: FONT_TC,
    },
    warn: {
      marginTop: 10,
      color: "#b91c1c",
      fontSize: 13,
      fontWeight: 900,
      fontFamily: FONT_TC,
    },
  };

  //Loading / Error 畫面
  if (optionsLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.mainCard}>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>偏好設定</h1>
            </div>
            <p style={styles.lead}>載入選項中...</p>
          </div>
        </div>
      </div>
    );
  }

  if (optionsErr) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.mainCard}>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>偏好設定</h1>
            </div>
            <div style={styles.error}>載入 options 失敗：{optionsErr}</div>
            <p style={{ ...styles.lead, marginTop: 12 }}>請確認後端有在跑：GET {API_BASE}/api/options</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.mainCard}>
          <div style={styles.titleRow}>
            <h1 style={styles.title}>偏好設定</h1>
            <div style={styles.idLine}>
              {participantId ? `參與者：${shortId(participantId)}` : ""}
              {grp ? `　組別：${grp}` : ""}
            </div>
          </div>

          <p style={styles.lead}>請選擇您偏好的條件，系統將產生最多 5 部推薦電影。</p>

          <div style={styles.divider} />

          <div style={styles.formGrid}>
            {/* 地區 */}
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>地區</h3>
              </div>
              <div style={styles.sectionBody}>
                <select value={regionGroup} onChange={(e) => setRegionGroup(e.target.value)} style={styles.select}>
                  {REGION_GROUP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 年份 */}
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>上映年份</h3>
                <div style={styles.sectionMeta}>
                  選取範圍：<span translate="no">{yearMin}～{yearMax}</span>
                </div>
              </div>
              <div style={styles.sectionBody}>
                <div style={styles.yearWrap}>
                  <div>
                    <div style={styles.tiny}>開始年份</div>
                    <select
                      value={yearMin}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setYearMin(v);
                        if (v > yearMax) setYearMax(v);
                      }}
                      style={styles.select}
                    >
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={styles.tiny}>結束年份</div>
                    <select
                      value={yearMax}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setYearMax(v);
                        if (v < yearMin) setYearMin(v);
                      }}
                      style={styles.select}
                    >
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!strictHint && showYearNarrowHint && (
                  <div style={styles.help}>你目前選的年份範圍較窄，可能無法產生 5 部推薦（可放寬年份範圍）。</div>
                )}
              </div>
            </div>

            {/* 類型 */}
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>類型</h3>
                <div style={styles.sectionMeta}>可複選，最多 {MAX_GENRES} 個（至少 1 個）</div>
              </div>
              <div style={styles.sectionBody}>
                <div style={styles.genresWrap}>
                  {genresOptions
                    .filter((g) => g !== "(no genres listed)" && g !== "Western")
                    .map((g) => {
                      const labelZh = GENRE_LABEL[g] || g;
                      const checked = (genres || []).includes(g);

                      return (
                        <label key={g} style={styles.checkboxLabel}>
                          <input type="checkbox" checked={checked} onChange={() => toggleGenre(g)} />
                          {labelZh}
                        </label>
                      );
                    })}
                </div>

                <div style={styles.help}>
                  已選： <span style={{ fontWeight: 900, color: "#334155" }}>{selectedGenresText}</span>
                </div>

                {genreWarn && <div style={styles.warn}>{genreWarn}</div>}
                {genreReqErr && <div style={styles.warn}>{genreReqErr}</div>}
              </div>
            </div>

            {/* 最低評分 */}
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>最低評分</h3>
                <div style={styles.sectionMeta}>
                  <span translate="no">{minRating.toFixed(1)}</span>（範圍{" "}
                  <span translate="no">
                    {sliderMin.toFixed(1)}～{sliderMax.toFixed(1)}
                  </span>
                  ）
                </div>
              </div>
              <div style={styles.sectionBody}>
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step="0.1"
                  value={minRating}
                  onChange={(e) => setMinRating(Number(e.target.value))}
                  style={styles.slider}
                />
                <div style={styles.help}>分數越高，條件越嚴格。</div>
              </div>
            </div>

            {/* 排序方式 */}
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>排序方式</h3>
                <div style={styles.sectionMeta}>（單選）</div>
              </div>
              <div style={styles.sectionBody}>
                <div style={styles.radiosWrap}>
                  {sortOptions.map((s) => (
                    <label key={s} style={styles.checkboxLabel}>
                      <input type="radio" name="sort_by" value={s} checked={sortBy === s} onChange={() => setSortBy(s)} />
                      {SORT_LABEL[s] || s}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {strictHint && <div style={styles.noticePanel}>{strictHint}</div>}

          <div style={styles.footer}>
            <button
              onClick={onRecommend}
              disabled={loading}
              style={styles.button}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {loading ? "產生中..." : "產生推薦"}
            </button>
          </div>

          {err && <div style={styles.error}>錯誤：{err}</div>}
        </div>
      </div>
    </div>
  );
}

/*
1.floor1：取到 1 位小數的下界（做 slider min/max）
2.clampToOneDecimal：把評分限制在範圍內並四捨五入 1 位小數
3.clampInt：把年份限制在範圍內
*/
function floor1(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.floor(v * 10) / 10;
}

function clampToOneDecimal(value, min, max) {
  let v = Number(value);
  if (!Number.isFinite(v)) v = Number(min);

  if (Number.isFinite(min) && v < min) v = min;
  if (Number.isFinite(max) && v > max) v = max;

  return Math.round(v * 10) / 10;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}