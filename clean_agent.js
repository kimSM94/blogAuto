require('dotenv').config();
const { chromium } = require('playwright');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BLOG_ID = 'kakaoadd'; 
const TARGET_GROUP_NAME = '광고'; 

// 🧠 초강력 AI 판독기 (블랙/화이트리스트 완벽 결합)
async function checkIsAd(blogInfo) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 네이버 블로그 스팸/광고 필터링 AI입니다. 
          아래 [블랙리스트]에 해당하면 무조건 광고(true)로 판정하세요.
          
          [🚨 블랙리스트 - 무조건 true 판정]
          1. 지역명 + 업체명 조합 (예: 목포행복장식, 진주종합하수구 등 오프라인 시공/설비/청소 업체 전부)
          2. 투자, 금융, 부동산, 마케팅 업체 (예: 스마트머니랩, 주식 리딩, 대출, 분양, 보험 등)
          3. 닉네임이나 블로그 제목이 '사람 이름'이나 '별명'이 아닌, 확실한 '회사명/상호명'인 경우
          
          [🛡️ 화이트리스트 - 절대 건드리지 말 것 (false)]
          1. 개인의 일상, 소통, 육아, 여행, 맛집 탐방 블로그
          2. 순수 IT/테크, 코딩, 개발, 전자기기 리뷰 블로거
          
          결과는 오직 JSON {"isAd": boolean, "reason": "판독 사유"} 형식으로만 출력하세요.`
        },
        { role: "user", content: `이웃 정보: ${blogInfo}` }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (e) { 
    return { isAd: false, reason: "판독 오류" }; 
  }
}

async function runCleaner() {
  console.log('🧹 [이웃 대청소 봇] 작동을 시작합니다...');
  const browser = await chromium.launch({ headless: false }); 
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();

  // 네이버 컨펌 알림창(이동 완료 등) 자동 확인
  page.on('dialog', dialog => dialog.accept());

  try {
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`\n🔗 [${pageNum} 페이지] 접속 중...`);
      // 💡 항상 정문(Buddyinfo)으로 입장하여 꼬임을 방지합니다.
      await page.goto(`https://admin.blog.naver.com/AdminMain.naver?blogId=${BLOG_ID}&Redirect=Buddyinfo`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      
      let frame = page.frame({ name: 'papermain' }) || page.mainFrame();

      // 1단계: 현재 작업해야 할 페이지 번호로 이동 (1페이지가 아닐 경우)
      if (pageNum > 1) {
        console.log(`⏭️ 이전 작업 지점인 ${pageNum} 페이지로 이동합니다...`);
        const targetPageBtn = frame.locator(`.paginate_re a[href*="goPage(${pageNum})"]`);
        if (await targetPageBtn.count() > 0) {
          await targetPageBtn.click();
          await page.waitForTimeout(2500);
          frame = page.frame({ name: 'papermain' }) || page.mainFrame(); // 프레임 갱신
        } else {
          console.log('🎉 더 이상 이동할 페이지가 없습니다.');
          break;
        }
      }

      // 2단계: 이웃 목록 분석 및 체크
      const rows = await frame.locator('tr:has(input[type="checkbox"])').elementHandles();
      let adInThisPage = 0;

      if (rows.length === 0) {
         console.log('✨ 이 페이지에 이웃이 없습니다. 종료합니다.');
         break;
      }

      console.log(`\n총 ${rows.length}명의 이웃을 하나씩 검사합니다...`); 

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const text = await row.innerText();
        
        if (!text || text.includes('전체선택') || text.includes(TARGET_GROUP_NAME)) continue;

        const cleanText = text.replace(/\n/g, ' ').trim();
        const shortText = cleanText.length > 50 ? cleanText.substring(0, 50) + "..." : cleanText;
        
        // 💡 실시간 중계
        console.log(`[${i + 1}/${rows.length}] 👀 읽는 중: ${shortText}`);

        const aiResult = await checkIsAd(cleanText);
        
        if (aiResult.isAd) {
          console.log(`   🚨 [광고 적발!] 사유: ${aiResult.reason}`);
          const chk = await row.$('input[type="checkbox"]');
          if (chk && !(await chk.isChecked())) {
            await chk.click();
            adInThisPage++;
          }
        } else {
          console.log(`   ✅ [통과] 일반 이웃입니다.`); 
        }
      }

      // 3단계: 광고 발견 시 그룹 이동 실행 및 목록 복귀
      if (adInThisPage > 0) {
        console.log(`\n📦 ${adInThisPage}명을 [${TARGET_GROUP_NAME}] 그룹으로 이동합니다.`);
        
        // 💡 1. 회원님이 찾아주신 정확한 그룹이동 버튼 클래스 클릭!
        await frame.locator('button.btn_movegroup').first().click();
        await page.waitForTimeout(1500);

        // 💡 2. '광고' a태그 클릭!
        const groupLink = frame.locator(`a:has-text("${TARGET_GROUP_NAME}")`).first();
        if (await groupLink.count() > 0) {
          await groupLink.click(); 
          console.log(`✅ '${TARGET_GROUP_NAME}' 그룹으로 이동 완료.`);
          await page.waitForTimeout(3000); // 화면 전환 대기
          
          // 💡 3. 회원님이 찾아주신 진짜 핵심! 다시 '전체 이웃 목록'으로 돌아가기
          console.log(`🔙 다시 전체 이웃 목록으로 복귀합니다.`);
          const returnBtn = frame.locator('a[href*="/BuddyListManage.naver?blogId=kakaoadd"]').first();
          if (await returnBtn.count() > 0) {
            await returnBtn.click();
            await page.waitForTimeout(2000); // 목록 불러오기 대기
          } else {
            console.log(`⚠️ 전체 목록 복귀 버튼을 찾지 못했습니다.`);
          }
        }
      } else {
        console.log(`\n✨ 이 페이지에는 격리할 광고 이웃이 없습니다.`);
      }

      // 4단계: 다음 페이지가 존재하는지 미리 확인
      pageNum++;
      const nextBtnExist = await frame.locator(`.paginate_re a[href*="goPage(${pageNum})"], .paginate_re a.next`).count();
      if (nextBtnExist === 0) {
        console.log('🎉 모든 페이지를 확인했습니다. 대청소가 완료되었습니다!');
        hasNextPage = false;
      }
    }

  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    await browser.close();
  }
}

runCleaner();