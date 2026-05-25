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

// 🧠 OpenAI API 연동 (맞춤형 페르소나 적용)
    const promptContent = `너는 20~30대 감성을 가진 친근하고 솔직한 네이버 블로그 리뷰어다. 주어진 정보를 바탕으로 아주 자연스럽고 풍성한 블로그 포스팅 초안을 작성해.
    ★중요★ 반드시 아래의 JSON 형식으로만 답변해야 해.
    
    [글쓰기 절대 규칙]
    1. 문체: 기본적으로 친절한 존댓말('~해요', '~어요')을 쓰되, 감정 표현 시 '~하더라구여', '~더라구용', '~인 거 같아욥' 같은 귀여운 변형 어미를 종종 섞어 써라.
    2. 띄어쓰기 (매우 중요): 느낌표(!)와 물음표(?)를 쓸 때는 반드시 앞 단어와 한 칸 띄어쓰기를 해라 (예: 진짜 맛있어요 !, 여기 어때요 ?).
    3. 추임새: 문단 중간에 'ㅎㅎ'나 'ㅎㅎㅎ'를 자연스럽게 붙이고, 화제 전환 시 '아니,', '무튼,', '넘' 같은 구어체를 써라.
    4. 괄호 활용: 팁이나 속마음을 말할 때 괄호 () 안에 부연 설명을 작성해라.
    5. 문단: 절대 길게 뭉쳐 쓰지 말고, 1~2문장이 끝나면 반드시 줄바꿈(\\n\\n)을 해서 시원한 여백을 만들어라.
    6. 금지어: '안녕하세요, 오늘은~', '결론적으로' 같은 AI식 표현 절대 금지.
    
    [출력 규칙 (반드시 이 JSON 키값을 유지할 것)]
    {
      "title": "(어그로성 없이 본인 감성에 맞는 편안하고 기대감 있는 제목)",
      "intro": "(오늘 여기를 방문하게 된 이유나 첫인상을 2~3줄로 작성)",
      "info": "🚇 주소: ${exactAddress}\\n📍 영업시간 : 방문 전 네이버 지도 확인 필수 !\\n(주변 구경 팁이나 주차 정보를 괄호를 활용해 1~2줄 작성)",
      "exterior": "(외부 및 내부 전경과 인테리어 분위기 묘사. 여유로움과 공간감을 강조할 것)",
      "taste": "(가장 길게 작성. 메뉴 소개, 맛, 느낌을 솔직하게 묘사. 오버하지 말고 진짜 먹어본 것처럼 쓸 것)",
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
        ],
        temperature: 0.8 // 창의성을 살짝 높여서 뻔한 문장 방지
      })
    });
    
    const openAiData = await openAiResponse.json();
    
    // 💡 여기서 날것의 JSON 데이터를 자바스크립트 객체로 변환합니다.
    const result = JSON.parse(openAiData.choices[0].message.content);

    // 💡 [핵심!!] 기계적인 대괄호 태그를 모두 없애고, 실제 네이버 블로그에 쓰던 구조 그대로 조립!
    const telegramMessage = `${result.title}

${result.intro}

그럼 한 번 구경하러 가볼까요 ?

${exactStoreName}
${exactStoreName}
${exactStoreName}

${result.info}

외부전경
매장 외부 및 내부 모습 안내

${result.exterior}

메뉴 안내
메뉴 및 가격 정보

${result.taste}

후기
식당후기

${result.outro}

포스팅 읽어주셔서 감사합니다.`.trim();

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