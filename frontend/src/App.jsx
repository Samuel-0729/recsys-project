import { Routes, Route, Navigate } from "react-router-dom";  //用 React Router 來做『多頁面』的前端

//把三個「實驗頁面」載進來
import ConsentPage from "./pages/ConsentPage.jsx";
import PrefsPage from "./pages/PrefsPage.jsx";
import ResultPage from "./pages/ResultPage.jsx";

//整個前端的「總控制器」，你之後加的任何頁面，都要在這裡註冊，使用者才進得去。
export default function App() {
  return (
    <Routes>
      {/* 
        首頁路由：
        使用者一進系統（https://recsys-project.onrender.com）會先看到「研究說明／同意頁」
      */}
      <Route path="/" element={<ConsentPage />} />   
      {/* 
        偏好輸入頁：
        使用者同意後，導向 /prefs
      */}
      <Route path="/prefs" element={<PrefsPage />} />
       {/* 
        推薦結果頁：
        使用者送出偏好後，導向 /result
      */}
      <Route path="/result" element={<ResultPage />} />
      {/* 
        萬用路由（fallback）：
        如果使用者輸入不存在的網址，一律重新導回首頁（/）
      */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}