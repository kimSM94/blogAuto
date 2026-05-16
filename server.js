require('dotenv').config(); // .env 파일에서 환경변수 불러오기
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

// 💡 핵심 1: 서버가 index.html을 마음대로 첫 화면으로 띄우지 못하게 막습니다.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(express.json());

// 💡 핵심 2: 처음에 접속( / )하면 무조건 대문(home.html)을 보여주도록 설정합니다!
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =======================================================
// 🍔 1. 맛집 텔레그램 알리미 API (완벽 조립 버전)
// =======================================================
app.post('/api/send-telegram', async (req, res) => {
  try {
    const { storeName, experience } = req.body;
    let exactAddress = "주소 정보 없음";
    let exactStoreName = storeName;

    console.log(`[맛집 수신] 검색 중: ${storeName}`);

    // 🗺️ 카카오맵 API 연동
    const kakaoSearchUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(storeName)}`;
    const kakaoResponse = await fetch(kakaoSearchUrl, {
      headers: { 'Authorization': `KakaoAK ${process.env.KAKAO_API_KEY}` }
    });
    
    const kakaoData = await kakaoResponse.json();
    if (kakaoData.documents && kakaoData.documents.length > 0) {
      const place = kakaoData.documents[0];
      exactAddress = place.road_address_name || place.address_name;
      exactStoreName = place.place_name;
    }

    // 🧠 OpenAI API 연동
    const promptContent = `당신은 방문자 수 1만 명이 넘는 인기 맛집 블로거입니다. 주어진 정보를 바탕으로 아주 자연스럽고 풍성한 블로그 포스팅 초안을 작성해주세요.
    ★중요★ 반드시 아래의 JSON 형식으로만 답변해야 합니다.
    
    [작성 가이드]
    1. 말투: "~해요", "~습니다", "~더라구요 ㅎㅎ" 등 친근하고 호들갑스러운 대화체를 사용하세요.
    2. 가독성: 모바일로 읽기 편하도록 문장 사이사이에 줄바꿈(\\n)을 넉넉히 넣고, 적절한 이모티콘을 사용해주세요.
    3. 내용 뻥튀기: 사용자가 제공한 짧은 경험담을 바탕으로, 마치 본인이 직접 먹고 감동한 것처럼 아주 디테일하고 길게 살을 붙여서 작성하세요.
    
    [출력 규칙 (반드시 이 JSON 키값을 유지할 것)]
    {
      "title": "(지역명과 키워드가 들어간 어그로성(?) 있는 센스있는 제목)",
      "intro": "(오늘 여기를 방문하게 된 이유나 기대감을 2~3줄로 작성)",
      "info": "📍 주소: ${exactAddress}\\n⏰ 영업시간: (방문 전 네이버 지도 확인 필수!)\\n(주소를 바탕으로 찾아가는 길이나 주차에 대한 팁을 그럴싸하게 2~3줄 작성)",
      "exterior": "(외부 및 내부 전경과 분위기 묘사)",
      "taste": "★이 부분을 가장 길고 침샘 자극하게 작성하세요★ (경험을 바탕으로 메뉴 소개, 식감, 첫입의 감동 등 디테일하게 묘사)",
      "outro": "(재방문 의사와 함께 훈훈하게 총평 및 마무리)"
    }`;

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" }, 
        messages: [
          { role: "system", content: promptContent },
          { role: "user", content: `[가게이름]: ${exactStoreName}\n[나의 실제 경험담]: ${experience}` }
        ]
      })
    });
    
    const openAiData = await openAiResponse.json();
    
    // 💡 여기서 날것의 JSON 데이터를 자바스크립트 객체로 변환합니다.
    const result = JSON.parse(openAiData.choices[0].message.content);

    // 💡 [핵심!!] 여기서 우리가 원하는 예쁜 괄호 모양으로 다시 조립합니다!!
    const telegramMessage = `📝 [맛집 포스팅 초안]

[제목] 
${result.title}

[인사말] 
${result.intro}

[가게이름] 
${exactStoreName}

[주소 및 정보] 
${result.info}

[외부 및 내부 전경] 
${result.exterior}

[메뉴 및 맛 평가] 
${result.taste}

[총평 및 마무리] 
${result.outro}`.trim();

    // 🚀 텔레그램 전송 (draftText가 아니라 예쁘게 조립한 telegramMessage를 쏩니다!)
    const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: telegramMessage })
    });

    if (!tgResponse.ok) throw new Error("텔레그램 전송 실패");

    console.log(`✅ 텔레그램 전송 완료: ${exactStoreName}`);
    res.json({ success: true, message: "텔레그램 전송 완료!" });

  } catch (error) {
    console.error(`❌ 에러 발생: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =======================================================
// 🤖 2. 블로그 자동화 에이전트 실시간 스트리밍 API (새로운 방식)
// =======================================================
app.get('/api/stream-bot', (req, res) => {
  const botType = req.query.type;
  let scriptName = '';
  
  if (botType === 'gatekeeper') scriptName = 'gatekeeper_agent.js';
  else if (botType === 'clean') scriptName = 'clean_agent.js';
  else return res.status(400).send('잘못된 봇 타입입니다.');

  // 실시간 중계용 헤더
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`[실행 명령] ${scriptName} 실시간 스트리밍 시작...`);
  res.write(`data: [시스템] ${scriptName} 기동을 준비합니다...\n\n`);

  const child = spawn('node', [scriptName]);

  // 터미널 로그를 화면으로 쏘기
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if(line.trim()) res.write(`data: ${line}\n\n`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if(line.trim()) res.write(`data: [에러] ${line}\n\n`);
    });
  });

  child.on('close', (code) => {
    res.write(`data: [시스템] 봇 작업 종료 (코드: ${code})\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`✨ 종합 관제 센터가 열렸습니다! http://localhost:${PORT}`);
});