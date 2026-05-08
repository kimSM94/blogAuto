require('dotenv').config();
const { chromium } = require('playwright');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BLOG_ID = 'kakaoadd'; 

async function checkIsSpamRequest(requestInfo) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 네이버 블로그 서로이웃 신청을 판독하는 매우 깐깐한 AI입니다.
          ⚠️ [매우 중요]: 신청자가 보낸 '신청 멘트(메시지)'는 완전히 무시하세요! 오직 '닉네임'과 '블로그 제목'만 보고 업체/광고 계정인지 판단해야 합니다.

          [🚨 광고(true) 판정 기준]
          1. 지역명 + 업체/시공명 (예: 목포행복장식, 진주종합하수구, 누수, 청소 등)
          2. 전문 상업용 (중고차, 대출, 보험, 부동산, 리딩방, 마케팅 업체 등)
          3. 닉네임이나 제목이 사람 이름이 아닌 확연한 '상호명/업체명'인 경우
          4. 특정 직업군 홍보: '디자이너', '원장', '팀장', '실장' 등이 포함된 업체 계정 (예: 일루지안헤어 민아)

          결과는 오직 JSON {"isSpam": boolean, "reason": "사유"} 형식으로만 출력하세요.`
        },
        { role: "user", content: `신청 정보: ${requestInfo}` }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (e) { return { isSpam: false }; }
}

async function runGatekeeper() {
  console.log('🏰 [서이추 문지기] 업무를 시작합니다...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();

  page.on('dialog', dialog => dialog.accept());

  try {
    await page.goto(`https://admin.blog.naver.com/AdminMain.naver?blogId=${BLOG_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      adminMain.GotoPage('https://admin.blog.naver.com/BuddyInviteReceivedManage.naver', false);
    });
    await page.waitForTimeout(3000); 
    
    let frame = page.frame({ name: 'papermain' }) || page.mainFrame();

    await frame.waitForSelector('tr:has(input[type="checkbox"])', { timeout: 5000 }).catch(() => {});

    const rowLocator = frame.locator('tr:has(input[type="checkbox"])');
    let rowCount = await rowLocator.count();
    
    if (rowCount === 0) {
      console.log('✨ 처리할 대기 신청이 없습니다.');
      return;
    }

    console.log(`\n👥 총 ${rowCount}건의 신청(헤더 포함)을 실시간 분석합니다...`);
    let spamCount = 0;

    for (let i = 0; i < rowCount; i++) {
      const row = rowLocator.nth(i);
      const text = await row.innerText();
      
      if (!text || text.includes('신청한 사람') || text.replace(/\s/g, '').includes('전체선택')) continue;

      const cleanText = text.replace(/\n/g, ' ').trim();
      console.log(`[분석 중] 👀: ${cleanText.substring(0, 50)}...`);

      const aiResult = await checkIsSpamRequest(cleanText);
      
      if (aiResult.isSpam) {
        console.log(`   🚨 [거절 대상] 사유: ${aiResult.reason}`);
        const chk = row.locator('input[type="checkbox"]');
        if (await chk.count() > 0) {
          await chk.check({ force: true });
          spamCount++;
        }
      } else {
        console.log(`   ✅ [정상 이웃] 통과`); 
      }
    }

    // =========================================================
    // 🗑️ 2. 체크된 광고 계정 일괄 거절
    // =========================================================
    if (spamCount > 0) {
      console.log(`\n🗑️ ${spamCount}명의 광고 계정을 "한 번에" 일괄 거절합니다...`);
      
      const denyBtn = frame.locator('._denyMultiBuddy').first();
      
      if (await denyBtn.count() > 0) {
        await denyBtn.click();
        console.log(`✅ 거절 버튼 클릭 완료! 화면 갱신을 기다립니다.`);
        await page.waitForTimeout(4000); 
        frame = page.frame({ name: 'papermain' }) || page.mainFrame(); 
        await frame.waitForSelector('tr:has(input[type="checkbox"])', { timeout: 5000 }).catch(() => {});
      } else {
        console.log(`⚠️ 거절 버튼을 찾지 못했습니다.`);
      }
    } else {
      console.log(`\n✨ 삭제할 광고 계정이 없습니다.`);
    }

    // =========================================================
    // 🤝 3. 남은 정상 이웃 일괄 수락
    // =========================================================
    const remainLocator = frame.locator('tr:has(input[type="checkbox"])');
    let remainCount = await remainLocator.count();
    let normalCount = 0;

    for (let i = 0; i < remainCount; i++) {
      const row = remainLocator.nth(i);
      const text = await row.innerText();
      
      if (!text || text.includes('신청한 사람') || text.replace(/\s/g, '').includes('전체선택')) continue;
      
      const chk = row.locator('input[type="checkbox"]');
      if (await chk.count() > 0) {
        await chk.check({ force: true });
        normalCount++;
      }
    }

    if (normalCount > 0) {
      console.log(`\n🤝 ${normalCount}명의 정상 이웃을 "한 번에" 일괄 수락 처리합니다...`);
      
      const acceptBtn = frame.locator('._acceptMultiBuddy').first();
      
      if (await acceptBtn.count() > 0) {
        console.log(`💬 수락 버튼 클릭 및 팝업 대기 중...`);
        
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
          acceptBtn.click()
        ]);
        
        if (popup) {
          console.log(`🎉 팝업 창 발견! 버튼이 화면에 나타날 때까지 기다립니다...`);
          
          try {
            // 💡 [핵심 수정] 찰나의 순간을 기다려주도록 waitFor()를 사용합니다. (최대 5초 대기)
            const confirmBtn = popup.locator('input[src*="btn_cfm2.gif"]');
            await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
            await confirmBtn.click();
            console.log(`✅ 팝업 [확인] 버튼 클릭 성공! 모든 수락 완료!`);
            await page.waitForTimeout(3000); 
          } catch (e) {
            console.log(`⚠️ 팝업은 떴지만 대기 시간 안에 [확인] 버튼이 화면에 그려지지 않았습니다.`);
          }
        } else {
          console.log(`⚠️ 새 창 팝업이 감지되지 않아 현재 화면에서 탐색합니다.`);
          try {
            const inlineConfirm = frame.locator('input[src*="btn_cfm2.gif"]');
            await inlineConfirm.waitFor({ state: 'visible', timeout: 5000 });
            await inlineConfirm.click();
            console.log(`✅ 현재 화면에서 [확인] 클릭 완료!`);
          } catch (e) {
            console.log(`⚠️ 현재 화면에서도 [확인] 버튼을 찾지 못했습니다.`);
          }
        }
      } else {
        console.log(`⚠️ 수락 버튼을 찾지 못했습니다.`);
      }
    } else {
      console.log(`\n✨ 처리할 남은 이웃 신청이 없습니다.`);
    }

  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    await browser.close();
  }
}

runGatekeeper();