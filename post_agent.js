require('dotenv').config();
const { chromium } = require('playwright');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BLOG_ID = 'kakaoadd'; // 👈 회원님의 네이버 아이디

// ==========================================
// 🧠 1부: AI가 [변수]에 들어갈 내용을 각각 작성합니다.
// ==========================================
async function draftTemplateVariables(topicInfo) {
  console.log("📝 템플릿의 각 [변수]에 들어갈 맞춤형 내용을 작성 중입니다...");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o", 
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `당신은 맛집을 사랑하고 솔직한 리뷰를 남기는 트렌디한 네이버 블로거입니다. 
        사용자가 주는 메모를 바탕으로 아래 변수들에 들어갈 텍스트를 작성해주세요.

        [말투 가이드]
        1. "~해요", "~습니다", "~더라구요 ㅎㅎ" 등 편안한 구어체 사용.
        2. 엔터를 적절히 사용하여 읽기 편하게 작성할 것 (마크다운 특수기호 절대 금지).

        [🚨 각 변수별 작성 가이드 (블로그 최적화를 위해 아주 길게 작성)]
        - "[제목]": 지역명과 맛집 키워드가 포함된 클릭을 유도하는 센스 있는 제목.
        - "[인사말]": 요즘 꽂힌 음식이나 방문 이유를 친근하게 2~3줄로 작성.
        - "[가게이름]": 제공된 가게 이름만 정확히 출력.
        - "[주소]": 찾아가는 길이나 주차 팁 상세 설명.
        - "[영업시간]": 시간 및 웨이팅 팁.
        - "[외부전경]": 매장 인테리어, 분위기, 주조색 등을 아주 구체적으로 상상하여 길게 묘사.
        - "[메뉴설명]": 먹은 메뉴의 맛, 식감, 향, 소스 조합 등을 매우매우 상세하게 묘사 (가장 길게 작성).
        - "[후기]": 총평, 재방문 의사, 누구와 오면 좋은지 추천.
        
        [출력 규칙 (반드시 JSON 형식)]
        {"[제목]": "...", "[인사말]": "...", "[가게이름]": "...", "[주소]": "...", "[영업시간]": "...", "[외부전경]": "...", "[메뉴설명]": "...", "[후기]": "..."}`
      },
      {
        role: "user",
        content: `오늘 방문한 곳 정보: "${topicInfo}"\n이 정보를 바탕으로 각 변수를 풍부하게 채워줘.`
      }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

// ==========================================
// 🏃‍♂️ 2부: 템플릿 불러오기 및 내용 치환 (Find + Ctrl&V)
// ==========================================
async function runPostAgent() {
  // 💡 [수정 완료] 다시 혜정닭갈비로 롤백했습니다!
  const myMemo = `
    가게 이름: 혜정닭갈비
    위치: 춘천 닭갈비 거리
    특징: 웨이팅이 길고 사람이 많음.
    먹은 메뉴: 닭갈비(고기가 큼직하고 양배추가 달달함), 볶음밥(무조건 먹어야 함)
  `;

  const aiVariables = await draftTemplateVariables(myMemo);
  console.log(`\n✨ [AI 내용 생성 완료] 적용할 변수 개수: ${Object.keys(aiVariables).length}개\n`);

  const browser = await chromium.launch({ headless: false }); 
  
  // 클립보드 권한 필수 (Ctrl+V 마법을 위해)
  const context = await browser.newContext({ 
    storageState: 'state.json',
    permissions: ['clipboard-read', 'clipboard-write'] 
  });
  const page = await context.newPage();

  // 시스템 팝업 자동 승인
  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  try {
    console.log("🌐 네이버 블로그 글쓰기 창으로 이동합니다...");
    await page.goto(`https://blog.naver.com/${BLOG_ID}/postwrite`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.se-documentTitle', { timeout: 30000 });
    await page.waitForTimeout(2000); 

    // 💡 [에러 해결 1] 악명 높은 '도움말' 팝업창을 확실하게 끄는 폭격 코드
    console.log("🛡️ 화면을 가리는 도움말이나 팝업을 모두 끕니다...");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    try {
      // 닫기 버튼이 보이면 무조건 강제 클릭
      await page.locator('button[title="닫기"], .se-help-panel-close-button, .se-popup-button-cancel').click({ force: true, timeout: 2000 });
    } catch (e) {}
    await page.waitForTimeout(1000);

    // ==========================================================
    // 📂 템플릿 불러오기
    // ==========================================================
    console.log("📂 [템플릿] 메뉴를 엽니다...");
    await page.locator('button:has-text("템플릿"), a:has-text("템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("📂 [내 템플릿]을 선택합니다...");
    await page.locator('button:has-text("내 템플릿"), a:has-text("내 템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("🚀 '테스트' 템플릿을 불러옵니다!");
    await page.locator('text="테스트"').last().click();
    
    console.log("⏳ 템플릿 로딩 대기 중 (5초)...");
    await page.waitForTimeout(5000);

    // ==========================================================
    // 🪄 [핵심 에러 해결 2] Find & Ctrl+V 방식의 완벽 치환!
    // ==========================================================
    console.log("🪄 템플릿 내의 빈칸([변수])을 AI가 작성한 글로 채웁니다...");
    
    for (const [variableName, aiText] of Object.entries(aiVariables)) {
      if (variableName === '[제목]') continue; // 제목은 맨 밑에서 따로 처리

      console.log(` - 🔍 치환 중: ${variableName}`);
      
      // 1. 브라우저 내부 기능으로 텍스트를 찾아 블록(드래그)을 씌웁니다.
      const isFound = await page.evaluate((text) => {
        const selection = window.getSelection();
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('.se-main-container, .se-viewer') || document.body);
        range.collapse(true); 
        selection.addRange(range);

        // 찾으면 true 반환, 동시에 해당 텍스트에 파란 블록이 씌워짐
        return window.find(text, false, false, false, false, true, false);
      }, variableName);

      if (isFound) {
        // 2. 블록이 씌워진 상태에서 봇의 클립보드에 AI 텍스트를 복사합니다.
        await page.evaluate((text) => navigator.clipboard.writeText(text), aiText);
        
        // 3. 사람처럼 Ctrl+V를 누릅니다! (네이버 에디터가 완벽하게 인식함)
        await page.keyboard.press('Control+V');
        await page.waitForTimeout(1000); // 렉 방지
      } else {
        console.log(`   ⚠️ 템플릿에서 ${variableName} 위치를 찾지 못했습니다.`);
      }
    }

    // 제목 업데이트
    console.log("✍️ 제목을 업데이트합니다...");
    await page.locator('.se-documentTitle').first().click();
    await page.keyboard.press('Control+A'); 
    await page.evaluate((text) => navigator.clipboard.writeText(text), aiVariables['[제목]']);
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1500);

    // 저장 버튼 클릭
    console.log("💾 임시저장 버튼을 누릅니다...");
    await page.locator('span:has-text("저장"), button:has-text("저장")').first().click({ force: true });
    await page.waitForTimeout(4000);

    console.log("✅ [완벽 성공!] 스크린샷과 똑같은 레이아웃에 혜정닭갈비 글씨만 완벽하게 갈아끼워졌습니다!");

  } catch (error) {
    console.error("❌ 실행 중 에러 발생:", error);
  } finally {
    await browser.close();
  }
}

runPostAgent();