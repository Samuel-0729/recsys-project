import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// 後端 API（保留，雖然這支檔案目前沒用到）
const API_BASE = "https://recsys-project.onrender.com"; // eslint-disable-line no-unused-vars

// ✅ 只放「乾淨的 viewform」
const GOOGLE_FORM_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSfq7qBe9uh-HGwlIC9Ewl5aHnD2VJBqZu4afQt_qGVP9WgRgw/viewform";

// ✅ 你的表單 entry 編號（用「取得預填連結」拿）
const ENTRY_PID = "entry.1452297615"; // participant_id
const ENTRY_LOG = "entry.109337464"; // log_id

// 類型英文 → 中文
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
  "(no genres listed)": "（未分類）",
};

// 把 explanation 文字中的類型英文替換成中文
function localizeGenresInText(text) {
  if (!text) return text;
  let out = String(text);
  for (const [en, zh] of Object.entries(GENRE_LABEL)) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), zh);
  }
  return out;
}

/**
 * 清理後端 explanation 裡「不想顯示的括號片段」
 * - （上映年份 2023）/ (上映年份 2023) / （年份：2023）
 * - （本片平均 4.2 分）/ (本片平均4.2分) / （平均 4.2 分）
 * * 不會動到（+2.1）這種差值括號
 */
function stripUnwantedParens(text) {
  if (!text) return text;
  let s = String(text);

  // 年份括號
  s = s.replace(/[（(]\s*(上映\s*年份|年份|year)\s*[:：]?\s*\d{4}\s*[)）]/gi, "");

  // 平均分數括號
  s = s.replace(/[（(]\s*(本片\s*)?平均\s*[:：]?\s*\d+(?:\.\d+)?\s*分\s*[)）]/g, "");

  // 多餘空白/標點整理
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/。。+/g, "。").replace(/，\s*。/g, "。");

  return s;
}

// 國家代碼 → 中文
const COUNTRY_ZH = {
  TW: "台灣",
  CN: "中國",
  HK: "香港",
  JP: "日本",
  KR: "韓國",
  TH: "泰國",
  IN: "印度",
  ID: "印尼",
  IL: "以色列",
  IR: "伊朗",
  LB: "黎巴嫩",
  MN: "蒙古",
  PS: "巴勒斯坦",
  US: "美國",
  CA: "加拿大",
  MX: "墨西哥",
  AR: "阿根廷",
  BR: "巴西",
  CO: "哥倫比亞",
  GB: "英國",
  IE: "愛爾蘭",
  FR: "法國",
  DE: "德國",
  ES: "西班牙",
  IT: "義大利",
  NL: "荷蘭",
  BE: "比利時",
  DK: "丹麥",
  NO: "挪威",
  SE: "瑞典",
  FI: "芬蘭",
  CH: "瑞士",
  AT: "奧地利",
  PL: "波蘭",
  PT: "葡萄牙",
  GR: "希臘",
  CZ: "捷克",
  SK: "斯洛伐克",
  HU: "匈牙利",
  RO: "羅馬尼亞",
  BG: "保加利亞",
  RS: "塞爾維亞",
  BA: "波士尼亞與赫塞哥維納",
  IS: "冰島",
  AU: "澳洲",
  NZ: "紐西蘭",
  ZA: "南非",
  AE: "阿拉伯聯合大公國",
  RU: "俄羅斯",
  TR: "土耳其",
};

function toCountryZh(codeOrName) {
  if (!codeOrName) return "";
  const s = String(codeOrName).trim();
  if (s.length > 2) return s; // 已經是中文/英文國名
  const code = s.toUpperCase();
  return COUNTRY_ZH[code] || code;
}

// 評分：4.123 → 4.1
function fmt1(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

// 人數：12345 → 12,345
function fmtInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toLocaleString() : "—";
}

// 年份：保證顯示為字串
function fmtYear(x) {
  const n = Number(x);
  return Number.isFinite(n) ? String(n) : "—";
}

// 從電影物件拿 genres 並轉中文(最多3個)
function getGenresZh(m) {
  const raw = m?.genres;
  if (!raw) return [];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") arr = raw.split("|");
  else return [];
  return arr.map((g) => GENRE_LABEL[g] || g).filter(Boolean).slice(0, 3);
}

// 排序規則提示
const SORT_RULE_TEXT = {
  評分較高優先: "排序提醒：先依評分排序；若相同，則比較評價人數；最後依上映年份排序。",
  評價人數多優先: "排序提醒：先依評價人數排序；若相同，則比較評分；最後依上映年份排序。",
  最新上映優先: "排序提醒：先依上映年份排序；若相同，則比較評分；最後比較評價人數。",
};

function getSortRuleText(sortBy) {
  return SORT_RULE_TEXT[sortBy] || "";
}

// 依 sortBy 決定「主要依據」要顯示什麼
function getSortMustLine(sortBy, m) {
  if (sortBy === "評價人數多優先") return `評價人數：${fmtInt(m?.rating_count)} 人`;
  if (sortBy === "最新上映優先") return `上映年份：${fmtYear(m?.year)} 年`;
  return `評分：${fmt1(m?.avg_rating)} 分`;
}

// 依 sortBy 決定「主要依據」要顯示什麼（用在 explanation 補充）
function getSortMustLineShort(sortBy, m) {
  if (sortBy === "評價人數多優先") return `評價人數：${fmtInt(m?.rating_count)} 人`;
  if (sortBy === "最新上映優先") return `上映年份：${fmtYear(m?.year)} 年`;
  return `評分：${fmt1(m?.avg_rating)} 分`;
}

/**
 * 前端 fallback：如果後端沒有 m.explanation，就用這段產生自然語言
 * ✅ 手機：換行條列更好讀
 * ✅ 桌機：一句話精簡
 */
function buildNaturalExplanation({ idx, titleZh, sortBy, m, genresZh, regionZh, minRating, isMobile }) {
  const regionText = regionZh ? `地區「${regionZh}」` : "你的地區設定";
  const gText = genresZh?.length ? genresZh.join("、") : "（未特別指定）";

  const rating = Number.isFinite(Number(m?.avg_rating)) ? Number(m.avg_rating) : null;
  const mr = Number.isFinite(Number(minRating)) ? Number(minRating) : null;

  const ratingStr = rating != null ? fmt1(rating) : "—";

  let diffPart = "";
  if (rating != null && mr != null) {
    const diff = (rating - mr).toFixed(1);
    const sign = Number(diff) >= 0 ? "+" : "";
    diffPart = `（門檻 ${fmt1(mr)}：${sign}${diff}）`;
  }

  const sortText =
    sortBy === "評價人數多優先"
      ? "評價人數優先"
      : sortBy === "最新上映優先"
      ? "最新上映優先"
      : "評分優先";

  const tone =
    idx === 1
      ? "所以我把它放在第一名。"
      : idx === 2
      ? "也很值得排進前幾名。"
      : idx === 3
      ? "如果你想找同調性的片，這部很適合。"
      : idx === 4
      ? "當作前五名的穩妥選擇剛剛好。"
      : "想換口味時可以收進備選。";

  if (isMobile) {
    return [
      `第 ${idx} 名：推薦「${titleZh}」`,
      `• 你選的偏好：${regionText}＋${gText}`,
      `• 評分：${ratingStr} ${diffPart}`.trim(),
      `• 排序：你選了「${sortText}」`,
      `• ${tone}`,
    ].join("\n");
  }

  return `第 ${idx} 名「${titleZh}」：符合 ${regionText}＋${gText}，評分 ${ratingStr}${
    diffPart ? " " + diffPart : ""
  }；你選的是「${sortText}」，${tone}`;
}

function ensureSortInfoInExplanation(explain, sortBy, m) {
  const base = (explain ?? "").toString().trim();
  const mustLine = getSortMustLineShort(sortBy, m);

  if (!base) return `（${mustLine}）`;

  if (sortBy === "評價人數多優先") {
    const countVal = Number(m?.rating_count);
    const countStr = Number.isFinite(countVal) ? fmtInt(countVal) : "";

    const hasCountKeyword = /評價人數|評價數|評論數|人評價|rating_count/i.test(base);
    const hasCountNumber = countStr ? base.includes(countStr) : false;
    if (hasCountKeyword || hasCountNumber) return base;

    if (base.endsWith("。")) return `${base.slice(0, -1)}（${mustLine}）。`;
    return `${base}（${mustLine}）`;
  }

  const hasAnyNumber = /\d/.test(base);
  if (hasAnyNumber) return base;

  const hasRatingKeyword = /評分|分數|平均.*分/.test(base);
  const hasYearKeyword = /上映|年份/.test(base);

  const needMain = sortBy === "最新上映優先" ? !hasYearKeyword : !hasRatingKeyword;
  return needMain ? `${base}（${mustLine}）` : base;
}

function ensureCountShown(explain, m) {
  const base = (explain ?? "").toString().trim();

  const countVal = Number(m?.rating_count);
  if (!Number.isFinite(countVal)) return base;

  const countStr = fmtInt(countVal);
  const hasCountKeyword = /評價人數|評價數|評論數|人評價|rating_count/i.test(base);
  const hasCountNumber = countStr ? base.includes(countStr) : false;
  if (hasCountKeyword || hasCountNumber) return base;

  const tail = `評價人數：${countStr} 人`;
  if (!base) return `（${tail}）`;
  if (base.endsWith("。")) return `${base.slice(0, -1)}（${tail}）。`;
  return `${base}（${tail}）`;
}

// ✅ 小工具：判斷螢幕寬度（手機/平板/桌機）
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

export default function ResultPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const { isMobile, isTablet } = useResponsiveBreakpoints();

  const prefs = useMemo(() => {
    try {
      const raw = localStorage.getItem("last_prefs");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("last_recommend_response");
      if (!raw) {
        setErr("找不到推薦結果（last_recommend_response 不存在），請回偏好頁重新產生推薦。");
        setData(null);
        return;
      }
      const parsed = JSON.parse(raw);
      setData(parsed);
      setErr("");
    } catch (e) {
      setErr("讀取推薦結果失敗：" + e.message);
      setData(null);
    }
  }, []);

  const participantId = data?.participant_id || localStorage.getItem("participant_id") || "";
  const grp = data?.grp || localStorage.getItem("grp") || "";
  const isBaseline = grp === "B";
  const logId = data?.log_id || "";

  const results = Array.isArray(data?.results) ? data.results : [];
  const top5 = results.slice(0, 5);

  const needRetry = !!data?.need_retry;
  const insufficient = !!data?.insufficient;
  const found = Number.isFinite(Number(data?.found)) ? Number(data.found) : results.length;

  const prefsUsed = data?.preferences || prefs || {};
  const sortKey = prefsUsed?.sort_by || "評分較高優先";
  const minRating = prefsUsed?.min_rating;

  const tieMap = useMemo(() => {
    const m = Object.create(null);
    for (const x of top5) {
      const y = Number(x?.year);
      const r = Number(x?.avg_rating);
      if (!Number.isFinite(y) || !Number.isFinite(r)) continue;
      const key = `${y}|${r.toFixed(1)}`;
      m[key] = (m[key] || 0) + 1;
    }
    return m;
  }, [top5]);

  const ratingTieMap = useMemo(() => {
    const m = Object.create(null);
    for (const x of top5) {
      const r = Number(x?.avg_rating);
      if (!Number.isFinite(r)) continue;
      const key = r.toFixed(1);
      m[key] = (m[key] || 0) + 1;
    }
    return m;
  }, [top5]);

  const goToSurvey = () => {
    const pid = participantId || localStorage.getItem("participant_id") || "";
    const lid = logId || "";

    if (!pid) {
      alert("缺少 participant_id，請回到首頁重新開始。");
      return;
    }
    if (!lid) {
      alert("缺少 log_id（系統紀錄編號），請回偏好頁重新產生推薦結果。");
      return;
    }

    const u = new URL(GOOGLE_FORM_BASE);
    u.searchParams.set("usp", "pp_url");
    u.searchParams.set(ENTRY_PID, pid);
    u.searchParams.set(ENTRY_LOG, lid);
    u.searchParams.set("t", String(Date.now()));

    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  // ===== Styles（維持原樣：flex 版面不動；只加「右邊不要貼邊」）=====
  const styles = {
    page: {
      minHeight: "100vh",
      width: "100%",
      background: "#f7fafc",
      margin: 0,
      padding: 0,
      fontFamily:
        '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, -apple-system, "Segoe UI", Arial',
      color: "#0f172a",
    },
    container: {
      width: "min(1200px, calc(100vw - 32px))",
      margin: "0 auto",
      padding: isMobile ? "18px 0 28px" : "40px 0 64px",
    },
    mainCard: {
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: 18,
      padding: isMobile ? "18px 16px" : "26px 26px",
      boxShadow: "0 10px 30px rgba(2, 6, 23, 0.05)",
    },
    headerRow: {
      display: "flex",
      alignItems: isMobile ? "flex-start" : "baseline",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    title: {
      fontSize: isMobile ? 30 : 40,
      margin: 0,
      marginBottom: isMobile ? 10 : 18,
      fontWeight: 950,
      color: "#1d4ed8",
      letterSpacing: 0.2,
      textAlign: isMobile ? "center" : "left",
      width: isMobile ? "100%" : "auto",
    },
    metaTopRight: {
      fontSize: 13,
      color: "#64748b",
      fontWeight: 800,
      display: "flex",
      gap: 14,
      alignItems: "center",
      flexWrap: "wrap",
    },
    sortTipBox: {
      marginTop: 8,
      border: "1px solid #e2e8f0",
      background: "#f8fafc",
      color: "#334155",
      padding: "12px 14px",
      borderRadius: 14,
      fontSize: 13.5,
      lineHeight: 1.75,
      fontWeight: 850,
    },
    divider: { height: 1, background: "#eef2f7", margin: "18px 0 22px" },
    errorBox: {
      marginTop: 12,
      padding: 12,
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
      borderRadius: 12,
      fontSize: 14,
      lineHeight: 1.7,
      fontWeight: 800,
    },
    dangerNotice: {
      marginTop: 12,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#991b1b",
      padding: "14px 16px",
      borderRadius: 14,
      fontSize: 14.5,
      lineHeight: 1.85,
      fontWeight: 900,
    },
    notice: {
      marginTop: 12,
      border: "1px solid #fde68a",
      background: "#fffbeb",
      color: "#92400e",
      padding: "12px 14px",
      borderRadius: 12,
      fontSize: 14,
      lineHeight: 1.75,
      fontWeight: 850,
    },

    list: { display: "grid", gridTemplateColumns: "1fr", gap: 18 },

    movieCard: {
      border: "1px solid #e5e7eb",
      borderRadius: 18,
      background: "#ffffff",
      overflow: "hidden",
    },
    movieHeader: {
      padding: "14px 16px",
      background: "#f8fafc",
      borderBottom: "1px solid #eef2f7",
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    movieTitle: { margin: 0, fontSize: 18.5, fontWeight: 950, color: "#0f172a" },
    movieRank: { fontSize: 12.5, color: "#94a3b8", fontWeight: 900, whiteSpace: "nowrap" },

    // ✅ 維持原樣：flex（不要改 grid）
    movieBody: {
      padding: isMobile ? "16px" : isTablet ? "18px 20px" : "18px",
      display: "flex",
      gap: isTablet ? 18 : 16,
      alignItems: "flex-start",
      flexDirection: isMobile ? "column" : "row",
    },

    posterWrap: {
      width: isMobile ? "100%" : 150,
      flexShrink: 0,
      display: "flex",
      justifyContent: isMobile ? "center" : "flex-start",
    },
    posterImg: {
      width: isMobile ? "min(260px, 100%)" : 150,
      height: isMobile ? "auto" : 225,
      aspectRatio: isMobile ? "2 / 3" : undefined,
      objectFit: "cover",
      borderRadius: 16,
      display: "block",
      border: "1px solid #e5e7eb",
      background: "#fff",
    },
    posterPlaceholder: {
      width: isMobile ? "min(260px, 100%)" : 150,
      height: isMobile ? 360 : 225,
      borderRadius: 16,
      border: "1px solid #e5e7eb",
      background: "#f1f5f9",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      color: "#64748b",
      fontWeight: 800,
    },

    // ✅ 只修這裡：右側加一點 paddingRight，避免文字貼到最右邊
    right: {
      flex: 1,
      minWidth: 0,
      width: "100%",
      paddingRight: isMobile ? 0 : 16, // ⭐ 小幅留白（你要的就是這個）
      boxSizing: "border-box",
    },

    // ✅ 只修這裡：限制說明盒最大寬度，右邊自然會空出來
    explainBox: {
      width: "100%",
      maxWidth: isMobile ? "100%" : 860, // ⭐ 桌機留白（不改整體版面）
      marginRight: "auto", // ⭐ 右側留白關鍵
      boxSizing: "border-box",
      borderRadius: 18,
      border: isBaseline ? "1px solid transparent" : "1px solid #e5e7eb",
      background: isBaseline ? "transparent" : "#f8fafc",
      padding: isBaseline ? 0 : isMobile ? "14px 14px" : isTablet ? "16px 18px" : "16px 16px",
    },
    explainTitle: {
      fontSize: 13.5,
      fontWeight: 950,
      color: "#0f172a",
      marginBottom: 10,
      letterSpacing: 0.2,
    },
    explainText: {
      fontSize: isMobile ? 15 : 15.5,
      color: "#334155",
      whiteSpace: "pre-wrap",
      lineHeight: 1.95,
      fontWeight: 700,
      wordBreak: "break-word",
      overflowWrap: "anywhere",
    },
    explainDivider: {
      height: 1,
      background: "#e8edf5",
      marginTop: 14,
      marginBottom: 12,
    },
    chipsRow: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center",
    },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderRadius: 999,
      border: "1px solid #e2e8f0",
      background: "#ffffff",
      color: "#0f172a",
      fontSize: 13.5,
      fontWeight: 900,
      letterSpacing: 0.2,
    },
    chipLabel: { color: "#64748b", fontWeight: 900 },

    footerRow: {
      marginTop: 22,
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "flex-start",
    },
    btn: {
      padding: "12px 18px",
      fontSize: 15,
      borderRadius: 14,
      border: "1px solid #1e40af",
      background: "#ffffff",
      color: "#1e40af",
      cursor: "pointer",
      fontWeight: 900,
    },
    btnPrimary: {
      padding: "12px 18px",
      fontSize: 15,
      borderRadius: 14,
      border: "1px solid #1e40af",
      background: "#1e40af",
      color: "#ffffff",
      cursor: "pointer",
      fontWeight: 900,
      opacity: needRetry ? 0.6 : 1,
    },
    hint: { marginTop: 10, fontSize: 12, color: "#64748b", lineHeight: 1.7 },
    emptyState: { marginTop: 10, fontSize: 14, color: "#64748b", fontWeight: 800 },
  };

  if (!data) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.mainCard}>
            <div style={styles.headerRow}>
              <h1 style={styles.title}>推薦結果</h1>
            </div>

            {err ? (
              <>
                <div style={styles.errorBox}>{err}</div>
                <div style={styles.footerRow}>
                  <button style={styles.btn} onClick={() => navigate("/prefs")}>
                    回偏好頁
                  </button>
                </div>
              </>
            ) : (
              <div style={styles.emptyState} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.mainCard}>
          <div style={styles.headerRow}>
            <h1 style={styles.title}>推薦結果</h1>

            <div style={styles.metaTopRight}>
              <span>
                參與者：{" "}
                <span translate="no">
                  {participantId ? `${participantId.slice(0, 6)}...${participantId.slice(-4)}` : "—"}
                </span>
              </span>
              <span>
                組別： <span translate="no">{grp || "—"}</span>
              </span>
              <span style={{ opacity: 0.7 }}>{isMobile ? "手機" : isTablet ? "平板" : "桌機"}</span>
            </div>
          </div>

          {!isBaseline && !needRetry && <div style={styles.sortTipBox}>{getSortRuleText(sortKey)}</div>}

          {err ? <div style={styles.errorBox}>{err}</div> : null}

          {needRetry ? (
            <div style={styles.dangerNotice}>
              目前沒有找到符合你條件的電影（0 部）。
              <br />
              請返回偏好頁放寬條件後再試（例如：降低最低評分、放寬年份範圍或修改類型）。
            </div>
          ) : null}

          {!needRetry && insufficient ? (
            <div style={styles.notice}>
              符合你設定條件的電影不足 5 部（目前找到：{found} 部）。
              <br />
              下方已列出符合條件的電影；若想要 5 部，請回偏好頁放寬條件後重試。
            </div>
          ) : null}

          <div style={styles.divider} />

          {!needRetry ? (
            <div style={styles.list}>
              {top5.map((m, idx) => {
                const titleZh = m.title_zh || m.title || "(untitled)";
                const yearVal = fmtYear(m.year);
                const ratingVal = fmt1(m.avg_rating);
                const regionZh = m.country_zh || toCountryZh(m.region || m.country || "");
                const genresZh = getGenresZh(m);

                const fallbackExplain = buildNaturalExplanation({
                  idx: idx + 1,
                  titleZh,
                  sortBy: sortKey,
                  m,
                  genresZh,
                  regionZh,
                  minRating,
                  isMobile,
                });

                const rawExplain = m.explanation
                  ? stripUnwantedParens(localizeGenresInText(m.explanation))
                  : fallbackExplain;

                let finalExplain = ensureSortInfoInExplanation(rawExplain, sortKey, m);

                if (sortKey === "評分較高優先") {
                  const r = Number(m?.avg_rating);
                  if (Number.isFinite(r)) {
                    const key = r.toFixed(1);
                    if ((ratingTieMap[key] || 0) > 1) {
                      finalExplain = ensureCountShown(finalExplain, m);
                    }
                  }
                }

                if (sortKey === "最新上映優先") {
                  const y = Number(m?.year);
                  const r = Number(m?.avg_rating);
                  if (Number.isFinite(y) && Number.isFinite(r)) {
                    const key = `${y}|${r.toFixed(1)}`;
                    if ((tieMap[key] || 0) > 1) {
                      finalExplain = ensureCountShown(finalExplain, m);
                    }
                  }
                }

                return (
                  <div key={m.movie_id || `${titleZh}-${idx}`} style={styles.movieCard}>
                    <div style={styles.movieHeader}>
                      <h3 style={styles.movieTitle}>
                        <span style={{ fontWeight: 950 }}>{idx + 1}.</span> {titleZh}
                      </h3>
                      <div style={styles.movieRank}>Top {idx + 1}</div>
                    </div>

                    <div style={styles.movieBody}>
                      <div style={styles.posterWrap}>
                        {m.poster_url ? (
                          <img src={m.poster_url} alt={titleZh} style={styles.posterImg} />
                        ) : (
                          <div style={styles.posterPlaceholder}>No Poster</div>
                        )}
                      </div>

                      <div style={styles.right}>
                        {!isBaseline ? (
                          <div style={styles.explainBox}>
                            <div style={styles.explainTitle}>推薦說明</div>
                            <div style={styles.explainText}>{finalExplain || "（系統未提供推薦說明）"}</div>

                            <div style={styles.explainDivider} />
                            <div style={styles.chipsRow}>
                              <span style={styles.chip}>
                                <span style={styles.chipLabel}>年份</span> {yearVal}
                              </span>
                              <span style={styles.chip}>
                                <span style={styles.chipLabel}>評分</span> {ratingVal}
                              </span>
                              <span style={styles.chip}>
                                <span style={styles.chipLabel}>地區</span> {regionZh || "—"}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyState}>（目前沒有可顯示的推薦清單）</div>
          )}

          <div style={styles.footerRow}>
            <button style={styles.btn} onClick={() => navigate("/prefs")}>
              回偏好頁
            </button>

            <button
              style={styles.btnPrimary}
              onClick={goToSurvey}
              disabled={needRetry}
              title={needRetry ? "目前沒有推薦結果，請先回偏好頁調整條件" : ""}
            >
              前往問卷
            </button>
          </div>

          <div style={styles.hint}>
            {logId ? (
              <span>
                日誌ID：<span translate="no">{logId}</span>
              </span>
            ) : (
              <span>（未取得日誌ID）</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}