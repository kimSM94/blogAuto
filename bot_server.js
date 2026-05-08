const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;

// 'public' 폴더 안에 있는 index.html을 화면에 띄워줍니다.
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 🤖 에이전트 실행 공통 함수
const runAgent = (scriptName, res) => {
  console.log(`[실행 명령 수신] ${scriptName} 작동 시작...`);
  
  exec(`node ${scriptName}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ 에러 발생: ${error.message}`);
      return res.status(500).json({ success: false, message: error.message });
    }
    console.log(`✅ ${scriptName} 작동 완료!`);
    res.json({ success: true, message: stdout });
  });
};

// 📍 버튼 클릭 시 요청을 받을 API 엔드포인트들
app.post('/api/run-clean', (req, res) => runAgent('clean_agent.js', res));
app.post('/api/run-gatekeeper', (req, res) => runAgent('gatekeeper_agent.js', res));
// 필요하다면 아래처럼 답방 봇도 추가 가능합니다!
// app.post('/api/run-reply', (req, res) => runAgent('reply_agent.js', res));

app.listen(PORT, () => {
  console.log(`🚀 블로그 관제 센터가 열렸습니다! 브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
});