import { useEffect, useState } from "react"; // 用來管理元件狀態
import { useNavigate } from "react-router-dom"; // React Router：用來做頁面跳轉

const API_BASE = "http://127.0.0.1:5000"; // 後端 API 位置

// ✅ 小工具：響應式 breakpoints（手機/平板/桌機）
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
 1. 顯示研究說明
 2️. 點擊開始 → 呼叫後端建立 participant
 3️. 儲存 participant_id 與 grp 到 localStorage
 4️. 導向偏好設定頁 /prefs
*/
export default function ConsentPage() {
  const [loading, setLoading] = useState(false); //loading:狀態
  const [err, setErr] = useState(""); //錯誤訊息
  const navigate = useNavigate(); //React Router 導航工具
  const { isMobile, isTablet } = useResponsiveBreakpoints();

  const onStart = async () => {
    if (loading) return;
    setLoading(true);
    setErr("");

    try {
      const res = await fetch(`${API_BASE}/api/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "consent failed");

      localStorage.setItem("participant_id", String(data.participant_id || ""));
      localStorage.setItem("grp", String(data.grp || ""));

      navigate("/prefs");
    } catch (e) {
      setErr(e?.message || "未知錯誤");
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    page: {
      minHeight: "100vh",
      width: "100%",
      background: "#f8fafc",
      margin: 0,
      padding: 0,
      fontFamily:
        '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, -apple-system, "Segoe UI", Arial',
      color: "#111827",
    },

    // ✅ 手機縮窄左右 padding、卡片高度更舒服
    container: {
      width: isMobile ? "calc(100vw - 24px)" : "min(1280px, calc(100vw - 64px))",
      margin: "0 auto",
      padding: isMobile ? "18px 0 28px" : isTablet ? "26px 0 46px" : "32px 0 64px",
    },

    mainCard: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      padding: isMobile ? "18px 14px 16px" : isTablet ? "22px 20px 22px" : "24px 28px 28px",
      boxShadow: isMobile ? "0 10px 26px rgba(2, 6, 23, 0.06)" : "none",
    },

    stack: {
      display: "flex",
      flexDirection: "column",
      gap: isMobile ? 16 : 20,
    },

    // ✅ 手機置中、字級下修
    title: {
      fontSize: isMobile ? 24 : isTablet ? 28 : 30,
      margin: 0,
      marginBottom: isMobile ? 6 : 8,
      fontWeight: 900,
      color: "#1e40af",
      letterSpacing: 0.2,
      lineHeight: 1.25,
      textAlign: isMobile ? "center" : "left",
    },

    introBlock: {
      maxWidth: 980,
      margin: isMobile ? "0 auto" : 0, // ✅ 手機置中區塊
    },

    introTitle: {
      fontSize: isMobile ? 14.5 : 16,
      fontWeight: 800,
      lineHeight: 1.95,
      color: "#0f172a",
      margin: "0 0 10px",
    },

    // ✅ 手機字級略降、行距保留
    introText: {
      fontSize: isMobile ? 14.5 : 16,
      fontWeight: 400,
      lineHeight: 1.95,
      color: "#374151",
      margin: 0,
    },

    introMetaRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      marginTop: 12,
      justifyContent: isMobile ? "center" : "flex-start",
    },

    introMetaText: {
      fontSize: isMobile ? 12.5 : 14,
      fontWeight: 700,
      color: "#64748b",
    },

    // ✅ 手機改成上下排（時間資訊不要擠）
    sectionHeaderRow: {
      display: "flex",
      alignItems: isMobile ? "flex-start" : "baseline",
      justifyContent: "space-between",
      gap: 10,
      flexWrap: "wrap",
      marginTop: 6,
      flexDirection: isMobile ? "column" : "row",
    },

    sectionTitle: {
      fontSize: isMobile ? 16.5 : 18,
      fontWeight: 900,
      margin: 0,
      color: "#0f172a",
      lineHeight: 1.3,
    },

    sectionMeta: {
      fontSize: isMobile ? 12.5 : 14,
      color: "#475569",
      lineHeight: 1.6,
      fontWeight: 700,
      whiteSpace: isMobile ? "normal" : "nowrap",
    },

    panel: {
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      padding: isMobile ? "14px 14px" : "16px 18px",
      background: "#ffffff",
      marginTop: 10,
    },

    noticePanel: {
      border: "1px solid #d6dee8",
      borderRadius: 14,
      padding: isMobile ? "14px 14px" : "16px 18px",
      background: "#f1f5f9",
      marginTop: 10,
    },

    text: {
      fontSize: isMobile ? 14.5 : 16,
      fontWeight: 400,
      lineHeight: 1.95,
      color: "#374151",
      margin: 0,
      maxWidth: 1100,
    },

    // ✅ 手機清單縮排小一點
    list: {
      paddingLeft: isMobile ? 18 : 22,
      margin: 0,
      color: "#374151",
      lineHeight: 1.95,
      fontSize: isMobile ? 14.5 : 16,
      fontWeight: 400,
    },

    listItem: {
      margin: "6px 0",
    },

    footer: {
      display: "flex",
      alignItems: "center",
      justifyContent: isMobile ? "center" : "flex-start",
      marginTop: 12,
      gap: 12,
      flexWrap: "wrap",
    },

    // ✅ 手機按鈕滿寬更好點
    button: {
      padding: "12px 22px",
      fontSize: 16,
      borderRadius: 12,
      border: "1px solid #1e40af",
      background: loading ? "#93c5fd" : "#1e40af",
      color: "#ffffff",
      cursor: loading ? "not-allowed" : "pointer",
      fontWeight: 900,
      transition: "transform 120ms ease, opacity 120ms ease",
      opacity: loading ? 0.9 : 1,
      width: isMobile ? "100%" : "auto",
      maxWidth: isMobile ? 520 : "none",
    },

    error: {
      marginTop: 12,
      padding: 12,
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
      borderRadius: 12,
      fontSize: 14,
      lineHeight: 1.7,
      maxWidth: 1100,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.mainCard}>
          <div style={styles.stack}>
            <div>
              <h2 style={styles.title}>系統研究參與同意說明</h2>
            </div>

            <div style={styles.introBlock}>
              <p style={styles.introText}>
                本研究旨在探討電影推薦系統之使用體驗，並了解推薦資訊呈現方式對使用者信任感受與後續使用行為之影響。
              </p>
              <p style={{ ...styles.introText, marginTop: 8 }}>
                您將依個人偏好操作系統並查看推薦結果，最後填寫一份簡短問卷。
              </p>
              <p style={{ ...styles.introText, marginTop: 8 }}>非常感謝您的參與。</p>
            </div>

            <div>
              <div style={styles.sectionHeaderRow}>
                <h3 style={styles.sectionTitle}>研究流程</h3>
                <div style={styles.sectionMeta}>預計完成時間：約 3–5 分鐘</div>
              </div>

              <div style={styles.panel}>
                <ul style={styles.list}>
                  <li style={styles.listItem}>閱讀研究參與同意說明</li>
                  <li style={styles.listItem}>填寫個人電影偏好</li>
                  <li style={styles.listItem}>查看系統提供之電影推薦結果</li>
                  <li style={styles.listItem}>填寫一份簡短問卷</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 style={styles.sectionTitle}>重要說明</h3>
              <div style={styles.noticePanel}>
                <ul style={styles.list}>
                  <li style={styles.listItem}>本研究過程中不會蒐集任何可用以識別個人身分之資訊。</li>
                  <li style={styles.listItem}>所有蒐集之資料僅供學術研究與統計分析使用，並不作其他用途。</li>
                  <li style={styles.listItem}>您可於研究進行期間隨時選擇退出，本研究不會因此對您造成任何不利影響。</li>
                </ul>
              </div>
            </div>

            <div>
              <p style={styles.text}>
                若您已瞭解上述說明並同意參與本研究，請點擊下方「開始」按鈕，以進入偏好設定頁面。
              </p>

              <div style={styles.footer}>
                <button
                  onClick={onStart}
                  disabled={loading}
                  style={styles.button}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {loading ? "處理中…" : "開始"}
                </button>
              </div>

              {err && <div style={styles.error}>發生錯誤：{err}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}