require('dotenv').config();
const { chromium } = require('playwright');

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; // 👈 본인 네이버 아이디

async function runPostAgent() {
  console.log("📥 Cloudflare가 넘겨준 진짜 AI 데이터를 로드합니다...");
  
  // 1. Cloudflare가 깃허브 환경변수를 통해 쏴준 데이터를 그대로 받아옵니다.
  const aiVariables = {
    param_title: process.env.AI_TITLE,
    param_intro: process.env.AI_INTRO,
    param_info: process.env.AI_INFO,
    param_exterior: process.env.AI_EXTERIOR,
    param_taste: process.env.AI_TASTE,
    param_outro: process.env.AI_OUTRO
  };

  // 만약 데이터가 안 넘어왔다면 여기서 안전하게 종료
  if (!aiVariables.param_intro) {
    console.error("❌ Cloudflare로부터 데이터를 받지 못했어욥! 신호 연동 확인이 필요합니다.");
    return;
  }

  console.log(`\n✨ [데이터 수신 완료] 제목: ${aiVariables.param_title}\n네이버 블로그 자동화를 시작합니다.\n`);

  // 2. 깃허브 서버는 화면이 없는 리눅스이므로 무조건 headless: true 로 구동!
  const browser = await chromium.launch({ headless: true }); 
  
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
    
    await page.waitForSelector('.se-documentTitle', { timeout: 30000 });
    await page.waitForTimeout(3000); 

    // ==========================================================
    // 🛡️ 팝업창 확실하게 끄기
    // ==========================================================
    console.log("🛡️ 에디터 화면을 가리는 팝업창들을 싹 치웁니다...");
    
    const cancelBtn = page.locator('.se-popup-button-cancel');
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click(); 
      console.log("💥 '작성 중이던 글 불러오기' 팝업을 닫았습니다!");
      await page.waitForTimeout(1000); 
    }

    const helpCloseBtn = page.locator('.se-help-panel-close-button');
    if (await helpCloseBtn.isVisible()) {
      await helpCloseBtn.click();
      console.log("💥 우측 도움말 패널을 닫았습니다!");
      await page.waitForTimeout(1000);
    }
    
    await page.waitForTimeout(1000);

    // ==========================================================
    // 📂 템플릿 불러오기
    // ==========================================================
    console.log("📂 [템플릿] 메뉴 접근 중...");
    await page.locator('button:has-text("템플릿"), a:has-text("템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("📂 [내 템플릿] 탭 선택 중...");
    await page.locator('button:has-text("내 템플릿"), a:has-text("내 템플릿")').first().click();
    await page.waitForTimeout(1500);

    console.log("🚀 '#{제목}' 템플릿 불러오기!");
    await page.locator('text="#{제목}"').last().click();
    
    console.log("⏳ 템플릿 레이아웃 로딩 대기 중 (5초)...");
    await page.waitForTimeout(5000);

    // ==========================================================
    // 🪄 더블클릭(Double Click) 단어 치환! (Cloudflare가 준 데이터로)
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
      
      if (await targetElement.isVisible()) {
        await targetElement.dblclick({ delay: 100 });
        await page.waitForTimeout(300);

        await page.evaluate((text) => navigator.clipboard.writeText(text), item.value);
        await page.keyboard.press('Control+V');
        
        await page.waitForTimeout(1200); 
      } else {
        console.log(`   ⚠️ 템플릿에서 ${item.target} 표시를 찾지 못했어욥.`);
      }
    }

    // ==========================================================
    // 📌 에디터 최상단 진짜 [제목] 채우기
    // ==========================================================
    console.log("✍️ 제목 칸 입력 중...");
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

    console.log("✅ [완벽 성공!] 템플릿 틀 그대로 유지하면서 본문만 깔끔하게 치환되었습니다 !");

  } catch (error) {
    console.error("❌ 실행 중 치명적인 에러 발생:", error);
  } finally {
    await browser.close();
  }
}

runPostAgent();