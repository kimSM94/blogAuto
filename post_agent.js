require('dotenv').config();
const { chromium } = require('playwright');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BLOG_ID = 'kakaoadd'; // 👈 회원님의 네이버 아이디

// ==========================================
// 🧠 1부: 내 '찐 말투 규칙'을 주입하여 변수 작성
// ==========================================
async function draftTemplateVariables(topicInfo) {
  console.log("📝 템플릿의 각 #{파라미터}에 들어갈 내 맞춤형 글을 작성 중입니다...");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o", 
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `너는 20~30대 감성을 가진 친근하고 솔직한 네이버 블로그 리뷰어다. 
        사용자가 주는 메모를 바탕으로 아래 지정된 템플릿 치환 변수들에 들어갈 텍스트를 작성해줘.

        [글쓰기 절대 규칙 (매우 중요)]
        1. 문체 및 어미: 기본적으로 친절하고 다정한 존댓말('~해요', '~어요')을 사용하되, 감정을 표현할 때는 '~하더라구여', '~더라구용', '~인 거 같아욥'처럼 부드럽고 귀여운 변형 어미를 종종 섞어 써라.
        2. 특수기호 띄어쓰기: 느낌표(!)와 물음표(?)를 사용할 때는 반드시 앞 단어와 한 칸 띄어쓰기를 해라 (예: 진짜 맛있어요 !, 여기 어때요 ?).
        3. 추임새와 웃음소리: 문단 중간중간 문맥에 맞게 'ㅎㅎ' 또는 'ㅎㅎㅎ'를 자연스럽게 붙여라. 화제를 전환하거나 강조할 때 '아니,', '무튼,', '넘' 같은 구어체를 사용해라.
        4. 괄호 활용: 독자에게 꿀팁을 주거나 개인적인 속마음을 말할 때 괄호 ()를 활용해서 부연 설명을 넣어라.
        5. 문단 나누기: 절대 글을 길게 뭉쳐 쓰지 마라. 1~2문장이 끝나면 반드시 줄바꿈(\\n\\n)을 해서 문단 사이에 시원한 여백을 만들어라.
        6. 금지어: '안녕하세요, 오늘은~', '결론적으로' 같은 전형적인 AI식 표현은 절대 사용하지 마라.

        [🚨 각 변수별 치환 가이드]
        - "param_title": 어그로성 없이 본인 감성에 맞는 편안하고 기대감 있는 제목
        - "param_intro": 오늘 여기를 방문하게 된 이유나 첫인상을 친근하게 2~3줄로 작성.
        - "param_info": 찾아가는 길, 주변 볼거리, 혹은 주차 정보를 괄호를 활용해 구체적으로 작성.
        - "param_exterior": 외부 및 내부 전경과 인테리어 분위기 묘사. 여유로움과 공간감을 내 말투로 길게 강조할 것.
        - "param_taste": ★가장 길고 상세하게 작성★ 메뉴 소개, 식감, 맛, 조합을 진짜 먹어본 것처럼 솔직하게 묘사.
        - "param_outro": 재방문 의사와 함께 훈훈하게 총평 및 마무리.
        
        [출력 규칙 (반드시 이 JSON 형식을 유지할 것)]
        {
          "param_title": "...",
          "param_intro": "...",
          "param_info": "...",
          "param_exterior": "...",
          "param_taste": "...",
          "param_outro": "..."
        }`
      },
      {
        role: "user",
        content: `오늘 방문한 곳 정보: "${topicInfo}"\n이 정보를 바탕으로 각 파라미터를 내 색깔로 풍부하게 채워줘.`
      }
    ],
    temperature: 0.8
  });

  return JSON.parse(response.choices[0].message.content);
}

// ==========================================
// 🏃‍♂️ 2부: 템플릿 불러오기 및 내용 치환
// ==========================================
async function runPostAgent() {
  const myMemo = `
    가게 이름: 혜정닭갈비
    위치: 춘천 닭갈비 거리
    특징: 웨이팅이 길고 사람이 많음.
    먹은 메뉴: 닭갈비(고기가 큼직하고 양배추가 달달함), 볶음밥(무조건 먹어야 함)
  `;

  const aiVariables = await draftTemplateVariables(myMemo);
  console.log(`\n✨ [AI 내용 생성 완료] 내 말투 변환이 끝났어욥 !\n`);

  const browser = await chromium.launch({ headless: false }); 
  
  const context = await browser.newContext({ 
    storageState: 'state.json',
    permissions: ['clipboard-read', 'clipboard-write'] 
  });
  const page = await context.newPage();

  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  try {
    console.log("🌐 네이버 블로그 글쓰기 창으로 접속합니다...");
    await page.goto(`https://blog.naver.com/${BLOG_ID}/postwrite`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // 에디터가 렌더링될 때까지 충분히 대기
    await page.waitForSelector('.se-documentTitle', { timeout: 30000 });
    await page.waitForTimeout(3000); // 팝업이 뜰 시간을 충분히 줌

    // ==========================================================
    // 🛡️ [사진 에러 해결] 팝업창 확실하게 눈으로 보고 끄기
    // ==========================================================
    console.log("🛡️ 에디터 화면을 가리는 팝업창들을 싹 치웁니다...");
    
    // 1. '작성 중인 글이 있습니다' 팝업창 (force: true 제거)
    const cancelBtn = page.locator('.se-popup-button-cancel');
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click(); 
      console.log("💥 '작성 중이던 글 불러오기' 팝업을 닫았습니다!");
      await page.waitForTimeout(1000); 
    }

    // 2. 우측 '도움말' 사이드바 창 닫기
    const helpCloseBtn = page.locator('.se-help-panel-close-button');
    if (await helpCloseBtn.isVisible()) {
      await helpCloseBtn.click();
      console.log("💥 우측 도움말 패널을 닫았습니다!");
      await page.waitForTimeout(1000);
    }
    
    await page.waitForTimeout(1000); // 화면 정리 후 1초 숨고르기

    // ==========================================================
    // 📂 템플릿 불러오기
    // ==========================================================
    console.log("📂 [템플릿] 사이드바 메뉴를 엽니다...");
    await page.locator('button:has-text("템플릿"), a:has-text("템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("📂 [내 템플릿] 탭 선택 중...");
    await page.locator('button:has-text("내 템플릿"), a:has-text("내 템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("🚀 저장해두신 '#{제목}' 템플릿을 본문으로 불러옵니다!");
    await page.locator('text="#{제목}"').last().click();
    
    console.log("⏳ 템플릿 레이아웃 로딩 대기 중 (5초)...");
    await page.waitForTimeout(5000);

    // ==========================================================
    // 🪄 [사진 에러 해결] 더블클릭(Double Click) 단어 치환!
    // ==========================================================
    console.log("🪄 본문에 박혀있는 #{변수} 위치를 로봇이 더블클릭하여 정확히 교체합니다...");
    
    const replaceMatrix = [
      { target: '#{1문단}', value: aiVariables.param_intro },
      { target: '#{정보}', value: aiVariables.param_info },
      { target: '#{전경}', value: aiVariables.param_exterior },
      { target: '#{맛평가}', value: aiVariables.param_taste },
      { target: '#{마무리}', value: aiVariables.param_outro }
    ];

    for (const item of replaceMatrix) {
      console.log(` - 🔍 추적 및 치환 중: ${item.target}`);
      
      const targetElement = page.locator(`text="${item.target}"`).first();
      
      // 글씨가 화면에 보일 때만 실행
      if (await targetElement.isVisible()) {
        
        // 💡 핵심: 마우스를 2번 연속 클릭(더블클릭)하면 딱 #{1문단} 단어 하나만 블록 지정됩니다!
        await targetElement.dblclick({ delay: 100 });
        await page.waitForTimeout(300);

        // 클립보드에 복사 후 붙여넣기 (기존 글자 덮어쓰기)
        await page.evaluate((text) => navigator.clipboard.writeText(text), item.value);
        await page.keyboard.press('Control+V');
        
        await page.waitForTimeout(1200); 
      } else {
        console.log(`   ⚠️ 템플릿에서 ${item.target} 표시를 찾지 못했어욥.`);
      }
    }

    // ==========================================================
    // 📌 에디터 최상단 진짜 [제목] 입력 칸 채우기
    // ==========================================================
    console.log("✍️ 에디터 최상단 진짜 제목 칸 입력 중...");
    await page.locator('.se-documentTitle').first().click();
    await page.keyboard.press('Control+A'); 
    await page.evaluate((text) => navigator.clipboard.writeText(text), aiVariables.param_title);
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1500);

    // ==========================================================
    // 💾 '저장' 버튼 강제 클릭!
    // ==========================================================
    console.log("💾 임시저장 버튼을 찾는 중입니다...");
    
    const saveButton = page.locator('button').filter({ hasText: /^저장/ }).first();
    await saveButton.waitFor({ state: 'visible', timeout: 5000 });
    await saveButton.click();
    
    console.log("⏳ 네이버 서버에 임시저장 요청 중 (4초 대기)...");
    await page.waitForTimeout(4000); 

    console.log("✅ [완벽 성공!] 템플릿 틀 그대로 유지하면서 본문만 내 말투로 깔끔하게 치환되었습니다 !");

  } catch (error) {
    console.error("❌ 실행 중 치명적인 에러 발생:", error);
  } finally {
    // 닫히기 전 결과 확인할 시간 5초
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

// 자동화 스크립트 메인 실행
runPostAgent();