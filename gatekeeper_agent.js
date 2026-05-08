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
          content: `당신은 네이버 블로그 서로이웃 신청을 판독하는 깐깐한 AI입니다.
          ⚠️ [매우 중요]: 신청자가 보낸 '신청 멘트(메시지)'는 완전히 무시하세요! 오직 '닉네임'과 '블로그 제목'만 보고 업체/광고 계정인지 판단해야 합니다.
          [🚨 광고(true) 판정 절대 기준]
          1. 상호명/업종명 포함: 닉네임이나 제목에 미용실, 헤어, 뷰티, 네일, 하수구, 인테리어, 부동산, 폰성지, 마케팅 등이 있으면 무조건 광고입니다.
          2. 특정 직업군 홍보: '디자이너', '원장', '팀장', '실장' 등이 포함된 업체 계정은 무조건 광고입니다. (예: 일루지안헤어 민아)
          3. 지역기반 업체: '창원 상남동', '미아', '강남' 등 지역명과 업종이 결합된 경우.

          [🛡️ 일반(false) 판정 기준]
          - 확실한 개인 아이디, 일상, 취미, IT/개발 지식 공유 등 상업적 목적이 없는 경우만 해당.

          결과는 오직 JSON {"isSpam": boolean, "reason": "사유"} 형식으로만 출력하세요.`   },
        { role: "user", content: `신청 정보: ${requestInfo}` }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (e) { return { isSpam: false }; }
}

async function runGatekeeper() {
  console.log('🏰 [서이추 문지기] 받은 신청 관리 업무 시작...');
  const browser = await chromium.launch({ headless: false }); 
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();

  page.on('dialog', dialog => dialog.accept());

  try {
    console.log('🔗 블로그 관리자 홈으로 접속합니다...');
    await page.goto(`https://admin.blog.naver.com/AdminMain.naver?blogId=${BLOG_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('🖱️ 서로이웃 신청 관리 메뉴를 직접 엽니다...');
    await page.evaluate(() => {
      adminMain.GotoPage('https://admin.blog.naver.com/BuddyInviteReceivedManage.naver', false);
    });
    await page.waitForTimeout(3000); 
    
    let frame = page.frame({ name: 'papermain' }) || page.mainFrame();

    let rows = await frame.locator('tr:has(input[type="checkbox"])').elementHandles();
    if (rows.length === 0) {
      console.log('✨ 처리할 대기 신청이 없습니다.');
      return;
    }

    console.log(`\n👥 총 ${rows.length}건의 신청을 실시간 분석합니다...`);
    let spamCount = 0;

    // ==========================================
    // 🔍 1. AI 판독 및 광고 계정 체크
    // ==========================================
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const text = await row.innerText();
      
      // 💡 [오류 해결 1] 모든 공백을 싹 지운 상태에서 '전체선택'을 찾아서 완벽하게 스킵!
      const noSpaceText = text.replace(/\s/g, ''); 
      if (!text || noSpaceText.includes('전체선택')) continue;

      const cleanText = text.replace(/\n/g, ' ').trim();
      console.log(`[${i + 1}/${rows.length}] 👀 검토 중: ${cleanText.substring(0, 50)}...`);

      const aiResult = await checkIsSpamRequest(cleanText);
      
      if (aiResult.isSpam) {
        console.log(`   🚨 [거절] 사유: ${aiResult.reason}`);
        const chk = await row.$('input[type="checkbox"]');
        if (chk) {
          await chk.evaluate(node => node.click());
          spamCount++;
        }
      } else {
        console.log(`   ✅ [보류] 정상 이웃입니다.`); 
      }
    }

    // ==========================================
    // 🗑️ 2. 광고 계정 한 번에 일괄 삭제
    // ==========================================
    if (spamCount > 0) {
      console.log(`\n🗑️ ${spamCount}명의 광고 계정을 일괄 삭제 처리합니다...`);
      
      // 💡 [오류 해결 2] Playwright 함수 대신, 브라우저 자바스크립트를 직접 실행해서 표(td) 바깥에 있는 대장 '삭제' 버튼을 찾아서 클릭!
      const isDeleted = await frame.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('a'));
        const target = btns.find(btn => (btn.innerText.includes('삭제') || btn.innerText.includes('거절')) && !btn.closest('td'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (isDeleted) {
        console.log(`🎉 광고 계정 일괄 정리 완료! 화면이 갱신되기를 기다립니다.`);
        await page.waitForTimeout(4000); 
        // 화면이 새로고침 되었으므로 프레임을 다시 잡아줍니다.
        frame = page.frame({ name: 'papermain' }) || page.mainFrame();
      } else {
        console.log(`⚠️ 일괄 삭제 버튼을 찾지 못했습니다.`);
      }
    }

    // ==========================================
    // 🤝 3. 살아남은 진짜 이웃들 일괄 수락!
    // ==========================================
    console.log(`\n✅ 남은 진짜 이웃들을 일괄 수락합니다...`);
    
    // 갱신된 화면에서 남은 행들을 다시 가져옵니다.
    const remainingRows = await frame.locator('tr:has(input[type="checkbox"])').elementHandles();
    let normalCount = 0;

    for (let i = 0; i < remainingRows.length; i++) {
      const row = remainingRows[i];
      const text = await row.innerText();
      
      const noSpaceText = text.replace(/\s/g, ''); 
      if (!text || noSpaceText.includes('전체선택')) continue;

      const chk = await row.$('input[type="checkbox"]');
      if (chk) {
        await chk.evaluate(node => node.click()); 
        normalCount++;
      }
    }

    if (normalCount > 0) {
      // 표 바깥에 있는 '수락' 버튼 찾아서 누르기
      const isAccepted = await frame.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('a'));
        const target = btns.find(btn => btn.innerText.includes('수락') && !btn.closest('td'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (isAccepted) {
        await page.waitForTimeout(2000);

        // 레이어 팝업에서 [확인] 버튼 누르기 (기본 그룹으로 저장)
        const confirmBtn = frame.locator('a.btn_confirm, button:has-text("확인")').first();
        if (await confirmBtn.count() > 0) {
          await confirmBtn.click();
          console.log(`🎉 축하합니다! ${normalCount}명의 찐 이웃을 '기본 그룹'으로 수락 완료했습니다!`);
          await page.waitForTimeout(3000);
        }
      }
    } else {
      console.log(`✨ 더 이상 처리할 찐 이웃 신청이 없습니다.`);
    }

  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    await browser.close();
  }
}

runGatekeeper();