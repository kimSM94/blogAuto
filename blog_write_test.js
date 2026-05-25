const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 1. AI가 가공해서 넘겨줬다고 가정하는 가상의 데이터 세트 (Mock Data)
const mockAiData = {
  param_title: "문래에서 발견한 아늑함의 끝판왕, 신선다방 탐방기 !",
  param_intro: "오늘은 골목길에 숨겨진 보물 같은 감성카페를 다녀왔어욥 ㅎㅎ 분위기가 너무 제 스타일이더라구여 !",
  param_info: "🚇 주소: 서울 영등포구 문래동\n📍 영업시간 : 방문 전 네이버 지도 확인 필수 !",
  param_exterior: "그린이랑 브라운 톤 조화가 진짜 숲 속에 온 것처럼 편안함을 주더라구여 ! 공간 자체가 넘 매력적이에욥 ㅎㅎ",
  param_taste: "카페라떼 한 잔이랑 유기농 체리 파이를 주문해봤어욥 ! 원두 향이 진짜 깊고 부드어서 대만족이었어욧 ㅎㅎ",
  param_outro: "문래동에서 데이트하거나 혼자 쉬고 싶을 때 방문 추천합니다 ! 무조건 재방문할 거 같아용 ㅎㅎ"
};

async function startTemplateWriteTest() {
  console.log("🚀 [블로그 글쓰기 자동화] 로컬 크롬 브라우저를 가동합니다...");
  
  // 로봇의 움직임을 눈으로 실시간 확인하기 위해 headless: false 설정
  const browser = await puppeteer.launch({ 
    headless: false, 
    slowMo: 50, // 네이버 차단 및 꼬임 방지를 위해 사람 같은 속도로 조절
    args: ['--window-size=1200,900']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  try {
    // 2. 🔑 state.json 기반 쿠키 주입 로직
    console.log("🔑 state.json 파일에서 네이버 로그인 세션 로드 중...");
    const statePath = path.join(__dirname, 'state.json'); 
    
    if (!fs.existsSync(statePath)) {
      throw new Error("❌ 스크립트와 같은 폴더 내에 'state.json' 파일이 존재하지 않아욥 ! 확인해 주세요.");
    }

    const cookieData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    let cookies = [];

    // Playwright와 Puppeteer 저장 형식 유연성 예외 처리
    if (Array.isArray(cookieData)) {
      cookies = cookieData;
    } else if (cookieData.cookies && Array.isArray(cookieData.cookies)) {
      cookies = cookieData.cookies;
    } else {
      throw new Error("❌ state.json 내부 쿠키 배열 형식이 올바르지 않아욥 !");
    }

    // Puppeteer 브라우저에 쿠키 꽂아 넣기
    await page.setCookie(...cookies);
    console.log("✅ 로그인 세션 쿠키 주입 성공 !");

    // 3. 🌐 [수정] 내 블로그 메인 페이지로 접속 (사용자님 요청 방식 !)
    const naverId = process.env.NAVER_ID || "rnentkdals"; 
    console.log(`🌐 내 블로그 메인 페이지 접속 중... (https://blog.naver.com/${naverId})`);
    await page.goto(`https://blog.naver.com/${naverId}`, {
      waitUntil: 'networkidle2'
    });

    // 🔥 네이버 블로그의 핵심 함정: iframe 안으로 로봇을 밀어 넣어야 합니다.
    console.log("🔍 투명 창(#mainFrame) 내부로 진입하는 중...");
    const frameElement = await page.waitForSelector('#mainFrame');
    const mainFrame = await frameElement.contentFrame();

    // 프레임 안에서 [글쓰기] 텍스트를 가진 버튼을 찾아서 클릭합니다.
    console.log("🖱️ 프로필 영역에서 [글쓰기] 버튼을 찾아 클릭합니다...");
    await mainFrame.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      // 프로필 영역의 '글쓰기' 링크나 주소에 'postwrite'가 포함된 링크를 찾습니다.
      const writeBtn = links.find(el => el.textContent.trim() === '글쓰기' || el.href.includes('postwrite'));
      
      if (writeBtn) {
        writeBtn.click();
      } else {
        throw new Error("블로그 메인 화면에서 [글쓰기] 버튼을 찾지 못했어욥 !");
      }
    });

    // 버튼 클릭 후 진짜 에디터 창이 열릴 때까지 3초 대기
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("🚀 글쓰기 에디터 창 진입 완료 !");

    // 6. 🎯 지정하신 이름인 '#{제목}' 템플릿을 목록에서 찾아 정확히 클릭하기
    console.log("📝 저장되어 있는 ' #{제목} ' 이름의 템플릿 탐색 중...");
    const isTemplateClicked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.se-template-list-item, .se-template-item, .se-text'));
      const target = items.find(el => el.textContent.includes('#{제목}'));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (isTemplateClicked) {
      console.log("✅ 템플릿 로딩 명령 전달 완료 !");
    } else {
      console.log("⚠️ 지정한 이름의 템플릿 매칭 실패. 목록의 첫 번째 템플릿을 임의로 불러옵니다.");
      await page.evaluate(() => {
        const firstItem = document.querySelector('.se-template-list-item, .se-template-item');
        if (firstItem) firstItem.click();
      });
    }
    
    // 템플릿 레이아웃과 텍스트들이 본문에 완전히 렌더링될 때까지 여유 있게 대기
    await new Promise(resolve => setTimeout(resolve, 3000)); 

    // 7. 🔥 [핵심 요구사항] 파라미터 표시 자리를 하나씩 찾아 지우고 진짜 타이핑하기
    // 에디터 본문 템플릿 문자열과 AI 데이터 매칭 매트릭스 세팅
    const taskMatrix = [
      { target: '#{1문단}', value: mockAiData.param_intro },
      { target: '#{정보}', value: mockAiData.param_info },
      { target: '#{전경}', value: mockAiData.param_exterior },
      { target: '#{맛평가}', value: mockAiData.param_taste },
      { target: '#{마무리}', value: mockAiData.param_outro }
    ];

    for (const task of taskMatrix) {
      console.log(`[파라미터 추적] 본문 템플릿에서 ${task.target} 영역 탐색 중...`);

      // 네이버 에디터 내부의 에디터블 텍스트 노드 영역들을 모두 수집
      const textNodes = await page.$$('.se-text-paragraph, .se-editable, [contenteditable="true"]');
      let isFound = false;

      for (const node of textNodes) {
        const currentText = await page.evaluate(el => el.textContent, node);

        // 해당 문단 텍스트가 템플릿 지정 표시(예: #{1문단})를 품고 있다면
        if (currentText.includes(task.target)) {
          // ① 타겟 영역 마우스로 클릭해서 포커스 잡기
          await node.click();
          await new Promise(resolve => setTimeout(resolve, 200));

          // ② 전체 선택 (Ctrl + A)
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          
          // ③ 기존 파라미터 명칭 삭제 (Backspace)
          await page.keyboard.press('Backspace');
          await new Promise(resolve => setTimeout(resolve, 200));

          // ④ AI가 가공해 준 진짜 본문 문장 타이핑 입력 !
          await page.keyboard.type(task.value);
          console.log(`  ➡️ ${task.target} 자리에 본문 데이터를 정상 입력했어욥 !`);
          
          isFound = true;
          break; // 치환 완료 시 다음 파라미터 타겟 루프로 이동
        }
      }

      if (!isFound) {
        console.log(`  ⚠️ 알림: 현재 본문에서 ${task.target} 표시를 찾지 못해 넘어갑니다.`);
      }
      await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    // 8. 블로그 최상단 진짜 '제목' 입력 영역도 클릭하여 채우기
    console.log("📌 블로그 상단 진짜 제목 입력 영역 타이핑 중...");
    const titlePlaceholder = '.se-document-title .se-placeholder';
    await page.waitForSelector(titlePlaceholder);
    await page.click(titlePlaceholder);
    await page.keyboard.type(mockAiData.param_title);

    // 9. 에디터 상단 '저장' (임시저장) 버튼 클릭하여 최종 보관
    console.log("💾 자동 작성이 끝났습니다 ! 임시저장 버튼 클릭 중...");
    const saveBtnSelector = '.se-help-panel-save-button, .se-btn-save';
    await page.waitForSelector(saveBtnSelector);
    await page.click(saveBtnSelector);
    
    console.log("🎉 [성공] 템플릿 파라미터 추적 타이핑 완료 후 성공적으로 임시저장 되었습니다 !");

  } catch (error) {
    console.error("❌ 자동화 테스트 구동 중 에러 발생:", error);
  } finally {
    // 사람이 결과를 눈으로 관찰할 시간을 확보한 뒤 안전하게 브라우저 종료
    await new Promise(resolve => setTimeout(resolve, 6000));
    await browser.close();
    console.log("🏁 로컬 테스트를 종료합니다.");
  }
}

// 🚀 테스트 메인 함수 기동 실행
startTemplateWriteTest();