export default {
  async fetch(request, env, ctx) {
    // 🛡️ 1. CORS 보안 설정 (웹 브라우저 폼에서 안전하게 서버를 호출하기 위해 필수)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // 나중에 회원님의 토스 폼 주소로 바꾸면 더 안전합니다.
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 브라우저가 먼저 찔러보는 OPTIONS 요청(Preflight) 통과시키기
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 🛣️ 2. 라우팅: 정확히 POST /api/send-telegram 주소로 왔을 때만 실행
    if (request.method === "POST" && url.pathname === "/api/send-telegram") {
      try {
        const body = await request.json();
        const { storeName, experience } = body;

        let exactAddress = "주소 정보 없음";
        let exactStoreName = storeName;

        // =======================================================
        // 🗺️ 3. 카카오맵 API (axios 대신 내장 fetch 사용!)
        // =======================================================
        const kakaoSearchUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(storeName)}`;
        // process.env 대신 Cloudflare 전용인 env.변수명 을 사용합니다.
        const kakaoResponse = await fetch(kakaoSearchUrl, {
          headers: { 'Authorization': `KakaoAK ${env.KAKAO_API_KEY}` }
        });
        
        const kakaoData = await kakaoResponse.json();
        if (kakaoData.documents && kakaoData.documents.length > 0) {
          const place = kakaoData.documents[0];
          exactAddress = place.road_address_name || place.address_name;
          exactStoreName = place.place_name;
        }

        // =======================================================
        // 🧠 4. OpenAI API (무거운 openai 패키지 없이 직접 통신!)
        // =======================================================
        const promptContent = `당신은 방문자 수 1만 명이 넘는 인기 맛집 블로거입니다. 주어진 정보를 바탕으로 아주 자연스럽고 풍성한 블로그 포스팅 초안을 작성해주세요.

[작성 가이드]
1. 말투: "~해요", "~습니다", "~더라구요 ㅎㅎ" 등 친근하고 호들갑스러운 대화체를 사용하세요.
2. 가독성: 모바일로 읽기 편하도록 문장 사이사이에 엔터를 넉넉히 넣고, 적절한 이모티콘을 사용해주세요.
3. 내용 뻥튀기: 사용자가 제공한 짧은 경험담을 바탕으로, 마치 본인이 직접 먹고 감동한 것처럼 아주 디테일하고 길게 살을 붙여서 작성하세요.

[포스팅 양식]
[제목] (지역명과 키워드가 들어간 어그로성(?) 있는 센스있는 제목)
[인사말] (오늘 여기를 방문하게 된 이유나 기대감을 2~3줄로 작성)
[가게이름] ${exactStoreName}
[주소 및 정보] 📍 주소: ${exactAddress} \n⏰ 영업시간: (방문 전 네이버 지도 확인 필수!) \n(주소를 바탕으로 찾아가는 길이나 주차에 대한 팁을 그럴싸하게 2~3줄 작성)
[외부 및 내부 전경] (분위기 묘사)
[메뉴 및 맛 평가] ★이 부분을 가장 길고 침샘 자극하게 작성하세요★ (경험을 바탕으로 식감, 첫입의 감동 등 묘사)
[총평 및 마무리] (재방문 의사와 함께 훈훈하게 마무리)`;

        const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: promptContent },
              { role: "user", content: `[나의 실제 경험담]: ${experience}` }
            ]
          })
        });
        
        const openAiData = await openAiResponse.json();
        const draftText = openAiData.choices[0].message.content;

        // =======================================================
        // 🚀 5. 텔레그램 전송
        // =======================================================
        const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const tgResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `📝 [Cloudflare 광속 초안 도착!]\n\n${draftText}` })
        });

        if (!tgResponse.ok) throw new Error("텔레그램 전송 실패");

        // 성공 응답 보내기
        return new Response(JSON.stringify({ success: true, message: "텔레그램 전송 완료" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (error) {
        // 에러 응답 보내기
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 엉뚱한 주소로 접속하면 404 뱉기
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};