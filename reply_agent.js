require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

// =====================================================================
// 💡 DB에서 마지막 번호 가져오기 / 덮어쓰기 함수
// =====================================================================
async function getLastProcessedCommentNo() {
  try {
    const { data } = await supabase.from('bot_settings').select('last_comment_no').eq('id', 1).single();
    if (data && data.last_comment_no) return parseInt(data.last_comment_no, 10);
  } catch (e) {}
  return 0; 
}

async function saveLastProcessedCommentNo(no) {
  try {
    await supabase.from('bot_settings').upsert({ id: 1, last_comment_no: no.toString() });
    console.log(`💾 [Supabase 저장] 다음엔 댓글 ID: ${no} 이후부터 읽습니다.`);
  } catch (e) {}
}

// =====================================================================
// 🧠 AI 두뇌 로직
// =====================================================================
async function generateReply(commentText) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 이 블로그 포스팅을 직접 다녀오고 작성한 '블로그 주인'입니다. 
        방문자가 내 글을 보고 남긴 댓글에 다정하게 답글을 달아주세요.
        
        [절대 지켜야 할 제약 조건]
        1. (가장 중요) '답글:' 이나 따옴표("") 같은 불필요한 형식은 절대 붙이지 마세요. 오직 답글 본문 텍스트만 출력하세요.
        2. 내가 포스팅을 쓴 '주인'이라는 상황에 맞게 대답하세요. (예: 방문자가 가고 싶다고 하면 "저도 가고싶네요"가 아니라 "기회 되시면 꼭 한번 방문해보세요!" 라고 답변)
        3. 1문장으로 짧고 담백하게 작성하세요.
        4. 이모지(이모티콘) 사용 금지. 'ㅎㅎ' 나 'ㅋㅋ'를 자연스럽게 쓸 것.`
      },
      { role: "user", content: `방문자 댓글: "${commentText}"` }
    ],
    temperature: 0.7, 
    max_tokens: 100, 
  });
  
  let resultText = response.choices[0].message.content.trim();
  
  // 💡 [안전망] 혹시라도 AI가 말귀를 못 알아듣고 '답글: "내용"' 형태로 뱉으면, 정규식으로 껍데기를 강제 철거합니다!
  resultText = resultText.replace(/^답글:\s*/i, '').replace(/^"|"$/g, '');
  
  return resultText;
}

async function generateNeighborComment(postText) {
  const shortText = postText.length > 800 ? postText.substring(0, 800) : postText;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 블로그 이웃입니다. 본문을 읽고 1문장의 공감 댓글을 담백하게 작성하세요. 매크로성 인사는 절대 금지. 오직 댓글 본문만 출력.`
      },
      { role: "user", content: `본문: "${shortText}"` }
    ],
    temperature: 0.7, 
    max_tokens: 100, 
  });
  return response.choices[0].message.content.trim();
}

// =====================================================================
// 🚀 메인 봇 실행 로직
// =====================================================================
async function runAgent() {
  console.log('🤖 네이버 블로그 답글 자동화 에이전트 시작...');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  // 💡 잘 돌아가는 feed_agent.js와 동일한 순정 컨텍스트 사용 (아이폰 위장 X)
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    console.log(`🔍 [탐색] 최신 글 번호를 찾고 있습니다...`);
    await page.goto(`https://m.blog.naver.com/${BLOG_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); 

    const latestLogNo = await page.evaluate((id) => {
      const links = Array.from(document.querySelectorAll('a'));
      let maxLogNo = 0;
      for (const a of links) {
        const href = a.getAttribute('href');
        if (href && href.toLowerCase().includes(id.toLowerCase()) && /\d{10,}/.test(href) && !href.includes('comment') && !href.includes('profile')) {
          const numMatch = href.match(/(\d{10,})/);
          if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (num > maxLogNo) maxLogNo = num;
          }
        }
      }
      return maxLogNo > 0 ? maxLogNo.toString() : null;
    }, BLOG_ID);

    if (!latestLogNo) {
      console.log('❌ 최신 게시글을 찾지 못했습니다.');
      return;
    }

    const POST_NO = latestLogNo;
    const targetUrl = `https://m.blog.naver.com/${BLOG_ID}/${POST_NO}`;
    console.log(`[이동] 내 블로그 최신 포스트: ${targetUrl}`);
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); 

    // 🚨 [핵심 해결책] 인간형 스크롤 탐지기 (사진이 많은 맛집 글 완벽 대응)
    // 🚨 [수정된 스크롤 로직] 하단 플로팅 바에 속지 않고, 무조건 끝까지 스크롤합니다!
    console.log('[동작] 하단 플로팅 바를 무시하고 본문 끝까지 스크롤을 내립니다...');
    
    await page.evaluate(async () => {
      // 1000px씩 20번(총 20,000px) 무조건 내려서 지연 로딩된 사진과 진짜 댓글창을 모두 끌어냅니다.
      for (let i = 0; i < 20; i++) {
        window.scrollBy(0, 1000);
        await new Promise(r => setTimeout(r, 400)); // 네이버가 사진을 그릴 시간
      }
    });
    
    await page.waitForTimeout(2000); // 다 내리고 숨 고르기

    // 💡 [수정된 클릭 로직] 플로팅 바가 아닌, "진짜 본문 밑 댓글 영역(comment_area)"을 콕 집어 타격!
    try {
      const isClicked = await page.evaluate(() => {
        // 1순위: 예전에 캡처해주신 '진짜 본문 하단 댓글 영역' 껍데기 찾기
        const commentArea = document.querySelector('div[class*="comment_area"]');
        if (commentArea) {
          const btn = commentArea.querySelector('button');
          if (btn) {
            btn.click();
            return true;
          }
        }
        
        // 2순위: 혹시 못 찾았다면, 화면에 있는 모든 댓글 버튼 중 '맨 마지막 것(가장 아래쪽 본문 밑)'을 강제 타격
        const allBtns = document.querySelectorAll('.icon__seNf8, button[data-click-area*="re"], button[class*="comment_btn"]');
        if (allBtns.length > 0) {
          const lastBtn = allBtns[allBtns.length - 1]; 
          const target = lastBtn.closest('button') || lastBtn;
          target.click();
          return true;
        }
        
        return false;
      });

      if (isClicked) {
        console.log('✅ 본문 하단 진짜 댓글 버튼 타격 완료! 댓글창이 열릴 때까지 기다립니다...');
        
        // 무작정 대기하지 않고, 댓글이 있든(comment) 비었든(empty) 요소가 뜰 때까지 최대 10초 끈질기게 추적!
        await page.waitForSelector('.u_cbox_comment, .u_cbox_empty', { state: 'attached', timeout: 10000 });
        await page.waitForTimeout(1500); 
        console.log('✅ 댓글창 로딩 완벽 확인!');
      } else {
        console.log('⚠️ 스크롤을 끝까지 내렸지만 버튼을 찾지 못했습니다.');
      }
    } catch (e) {
      console.log('⚠️ 10초를 기다렸지만 댓글창이 열리지 않았습니다. (클릭 씹힘 의심)');
    }

    // 💡 댓글 데이터 추출
    const rawDataInfos = await page.$$eval('.u_cbox_comment', elements => 
      elements.map(el => el.getAttribute('data-info')).filter(info => info)
    ).catch(() => []); 

    console.log(`총 ${rawDataInfos.length}개의 댓글 데이터를 분석합니다...`);

    const repliedParentIds = new Set();
    const parsedComments = [];

    for (const dataInfo of rawDataInfos) {
      const commentNoMatch = dataInfo.match(/commentNo:'(\d+)'/);
      const parentMatch = dataInfo.match(/parentCommentNo:'(\d+)'/);
      const replyLevelMatch = dataInfo.match(/replyLevel:(\d+)/);
      const mineMatch = dataInfo.match(/mine:(true|false)/);
      const deletedMatch = dataInfo.match(/deleted:(true|false)/);

      const commentNo = commentNoMatch ? commentNoMatch[1] : null;
      const parentNo = parentMatch ? parentMatch[1] : null;
      const replyLevel = replyLevelMatch ? parseInt(replyLevelMatch[1]) : 1;
      const isMine = mineMatch ? mineMatch[1] === 'true' : false;
      const isDeleted = deletedMatch ? deletedMatch[1] === 'true' : false;
      
      if (isMine && replyLevel > 1 && parentNo) repliedParentIds.add(parentNo);
      parsedComments.push({ commentNo, parentNo, replyLevel, isMine, isDeleted });
    }

    const lastProcessedNo = await getLastProcessedCommentNo();
    let currentSessionMaxNo = lastProcessedNo;

    for (const comment of parsedComments) {
      const { commentNo, replyLevel, isMine, isDeleted } = comment;
      
      if (!commentNo || isDeleted || isMine || replyLevel > 1) continue;

      const currentNoInt = parseInt(commentNo, 10);
      if (currentNoInt <= lastProcessedNo) continue;
      if (currentNoInt > currentSessionMaxNo) currentSessionMaxNo = currentNoInt;

      const commentLocator = page.locator(`.u_cbox_comment[data-info*="commentNo:'${commentNo}'"]`).first();
      if (await commentLocator.count() === 0) continue;
      
      let alreadyReplied = repliedParentIds.has(commentNo);
      if (!alreadyReplied) {
        const { data } = await supabase.from('processed_comments').select('comment_id').eq('comment_id', commentNo);
        if (data && data.length > 0) alreadyReplied = true;
      }

      if (alreadyReplied) {
        console.log(`[내 블로그] 이미 답글이 달린 댓글입니다.`);
      } else {
        const commentText = await commentLocator.locator('.u_cbox_contents').first().innerText();
        console.log(`✨ [새 댓글] ${commentText}`);

        const aiReplyText = await generateReply(commentText);
        console.log(`💬 [AI 답글] ${aiReplyText}`);

        await commentLocator.locator('.u_cbox_btn_reply').first().click({ force: true });
        await page.waitForTimeout(1000); 
        await page.fill('.u_cbox_text', aiReplyText);
        
        const replyUploadBtn = page.locator('.u_cbox_btn_upload').first();
        await replyUploadBtn.click({ force: true, delay: 150 });
        await page.waitForTimeout(1500);
        
        await supabase.from('processed_comments').insert([{ comment_id: commentNo }]);
        console.log(`✅ [답글 완료]`);
        await page.waitForTimeout(2000);
      }
    }

    if (currentSessionMaxNo > lastProcessedNo) {
      await saveLastProcessedCommentNo(currentSessionMaxNo);
    }
    
  } catch (error) {
    console.error('❌ 실행 중 에러 발생:', error);
  } finally {
    console.log('\n✅ 모든 작업을 마치고 브라우저를 종료합니다.');
    await browser.close();
  }
}

runAgent();