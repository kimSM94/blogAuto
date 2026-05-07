require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const fs = require('fs'); // 💡 메모장(파일)을 읽고 쓰기 위한 모듈 추가
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BLOG_ID = 'kakaoadd'; 
const MEMORY_FILE = path.join(__dirname, 'last_comment.json'); // 기억을 저장할 파일

// ==============================================================================
// 🧠 1. AI 두뇌 모듈 (기존과 동일)
// ==============================================================================
async function generateReply(commentText) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 IT 기술과 일상을 공유하는 다정한 네이버 블로거입니다. 
        [제약 조건]
        1. 1~2문장으로 짧고 담백하게 작성할 것.
        2. 이모지(이모티콘)는 절대 사용하지 말 것.
        3. 'ㅎㅎ' 나 'ㅋㅋ'를 문장 끝에 한두 번만 사용할 것.
        4. 편안하고 친근한 구어체를 사용할 것.
        5. 오직 '답글 텍스트' 하나만 출력할 것.`
      },
      { role: "user", content: `내 포스팅에 방문자가 다음과 같은 댓글을 남겼습니다: "${commentText}"` }
    ],
    temperature: 0.7, 
    max_tokens: 100,
  });
  return response.choices[0].message.content.trim();
}

async function generateNeighborComment(postText) {
  const shortText = postText.length > 800 ? postText.substring(0, 800) : postText;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 네이버 블로그 이웃의 새 글을 읽고 소통하러 온 방문자입니다. 
        [제약 조건]
        1. 본문 내용을 바탕으로 1~2문장의 담백한 댓글을 작성할 것.
        2. 이모지(이모티콘) 절대 금지. 'ㅎㅎ' 나 'ㅋㅋ'를 자연스럽게 섞을 것.
        3. 매크로성 인사는 절대 금지.
        4. 오직 '댓글 본문'만 출력할 것.`
      },
      { role: "user", content: `본문: \n\n"${shortText}"` }
    ],
    temperature: 0.7, 
    max_tokens: 100,
  });
  return response.choices[0].message.content.trim();
}

// ==============================================================================
// 💾 2. 기억력(커서) 관리 모듈 (새로 추가됨!)
// ==============================================================================
async function getLastProcessedCommentNo() {
  try {
    const { data, error } = await supabase
      .from('bot_settings')
      .select('last_comment_no')
      .eq('id', 1)
      .single();

    if (data && data.last_comment_no) {
      return parseInt(data.last_comment_no, 10);
    }
  } catch (error) { 
    console.error("DB에서 기억 불러오기 실패:", error); 
  }
  return 0; // 에러 나거나 처음이면 0
}

async function saveLastProcessedCommentNo(no) {
  try {
    // id가 1인 줄에 새로운 번호를 덮어씌웁니다(upsert)
    const { error } = await supabase
      .from('bot_settings')
      .upsert({ id: 1, last_comment_no: no.toString() });

    if (!error) {
      console.log(`💾 [Supabase 저장 완료] 다음엔 댓글 ID: ${no} 이후부터 읽습니다.`);
    }
  } catch (error) { 
    console.error("DB에 기억 저장 실패:", error); 
  }
}

// ==============================================================================
// 🚶‍♂️ 3. 이웃 답방 자동화 모듈 (복잡한 로직을 밖으로 빼냈습니다)
// ==============================================================================
async function visitNeighborAndReply(context, neighborId) {
  console.log(`🚀 [답방 출발] 이웃(${neighborId})의 블로그로 이동합니다...`);
  
  const { data: visitedData } = await supabase.from('visited_neighbors').select('neighbor_id').eq('neighbor_id', neighborId);
  if (visitedData && visitedData.length > 0) {
    console.log(`[답방 패스] 이미 답방을 다녀온 이웃입니다. (ID: ${neighborId})`);
    return;
  }

  const neighborPage = await context.newPage();
  try {
    await neighborPage.goto(`https://m.blog.naver.com/${neighborId}`, { waitUntil: 'networkidle' });
    await neighborPage.waitForTimeout(3000); 
    
    let postBodyLocator = neighborPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
    let isAlreadyInPost = await postBodyLocator.count() > 0;

    // 최신 글 찾기
    if (!isAlreadyInPost) {
      const latestPostUrl = await neighborPage.evaluate((id) => {
        const links = Array.from(document.querySelectorAll('a'));
        const targetId = id.toLowerCase();
        let maxLogNo = 0, bestHref = null;
        for (const a of links) {
          const href = (a.getAttribute('href') || '').toLowerCase();
          if (href.includes(`/${targetId}/`) || href.includes(`blogid=${targetId}`)) {
            if (!href.includes('comment') && !href.includes('profile')) {
              const numberMatch = href.match(/(\d{10,})/); 
              if (numberMatch && parseInt(numberMatch[1], 10) > maxLogNo) {
                maxLogNo = parseInt(numberMatch[1], 10);
                bestHref = a.getAttribute('href');
              }
            }
          }
        }
        return bestHref;
      }, neighborId);

      if (latestPostUrl) {
        const fullUrl = latestPostUrl.startsWith('http') ? latestPostUrl : `https://m.blog.naver.com${latestPostUrl}`;
        await neighborPage.goto(fullUrl, { waitUntil: 'networkidle' });
        await neighborPage.waitForTimeout(3000);
        postBodyLocator = neighborPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
      }
    }

    if (await postBodyLocator.count() > 0) {
      const postText = await postBodyLocator.innerText();
      const neighborComment = await generateNeighborComment(postText);
      console.log(`💬 [이웃 블로그 AI 댓글] ${neighborComment}`);

      await neighborPage.evaluate(() => window.scrollBy(0, 2000));
      await neighborPage.waitForTimeout(1500);

      // 공감 누르기 로직
      let skipBecauseAlreadyLiked = false;
      try {
        const likeBtn = neighborPage.locator('a.u_likeit_list_btn, button.u_likeit_list_btn').first();
        if (await likeBtn.count() > 0) {
          const isLiked = await likeBtn.evaluate(el => el.getAttribute('aria-pressed') === 'true' || el.classList.contains('on'));
          if (isLiked) {
            console.log(`🚫 [공감 체크] 이미 공감 상태입니다. 도망칩니다.`);
            skipBecauseAlreadyLiked = true;
          } else {
            await likeBtn.click({ force: true });
            console.log(`❤️ [공감 완료] 하트를 눌렀습니다.`);
            await neighborPage.waitForTimeout(1000);
          }
        }
      } catch (e) { }

      // 댓글 남기기 로직
      if (skipBecauseAlreadyLiked) {
        await supabase.from('visited_neighbors').insert([{ neighbor_id: neighborId }]);
      } else {
        const neighborCommentBtn = neighborPage.locator('.icon__seNf8, .num__OVfhz').first();
        if (await neighborCommentBtn.count() > 0) {
          await neighborCommentBtn.click();
          await neighborPage.waitForTimeout(3000); 

          const myCommentCount = await neighborPage.$$eval('.u_cbox_comment', els => els.filter(el => el.getAttribute('data-info')?.includes('mine:true')).length);
          if (myCommentCount > 0) {
            console.log(`🚫 [답방 패스] 이미 내가 남긴 댓글이 존재합니다!`);
          } else {
            await neighborPage.fill('.u_cbox_text', neighborComment);
            await neighborPage.click('.u_cbox_btn_upload');
            console.log(`✅ [답방 완료] 이웃 블로그에 댓글을 남겼습니다.`);
          }
          await supabase.from('visited_neighbors').insert([{ neighbor_id: neighborId }]);
        }
      }
    } else {
      console.log(`⚠️ [답방 패스] 텍스트를 읽을 수 없는 글입니다.`);
    }
  } catch (err) {
    console.log(`⚠️ [답방 에러] 무시하고 넘어갑니다.`);
  } finally {
    await neighborPage.close();
    console.log(`[답방 복귀] 내 블로그로 무사히 돌아왔습니다. 10초 대기 ☕`);
    await neighborPage.waitForTimeout(10000 + Math.random() * 5000);
  }
}

// ==============================================================================
// 🚀 4. 메인 실행 함수 (오케스트레이터)
// ==============================================================================
async function runAgent() {
  console.log('🤖 네이버 블로그 자동화 에이전트 시작...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();

  try {
    // 1. 내 블로그 최신 글 찾기
    await page.goto(`https://m.blog.naver.com/${BLOG_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const latestLogNo = await page.evaluate((id) => {
      const links = Array.from(document.querySelectorAll('a'));
      let maxLogNo = 0;
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (href.toLowerCase().includes(id.toLowerCase()) && /\d{10,}/.test(href) && !href.includes('comment')) {
          const numMatch = href.match(/(\d{10,})/);
          if (numMatch && parseInt(numMatch[1], 10) > maxLogNo) maxLogNo = parseInt(numMatch[1], 10);
        }
      }
      return maxLogNo > 0 ? maxLogNo.toString() : null;
    }, BLOG_ID);

    if (!latestLogNo) return console.log('❌ 최신 게시글을 못 찾았습니다.');
    
    await page.goto(`https://m.blog.naver.com/${BLOG_ID}/${latestLogNo}`, { waitUntil: 'networkidle' });
    
    try {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000); 
      await page.locator('.icon__seNf8, .num__OVfhz').first().click();
      await page.waitForTimeout(2500); 
    } catch (e) { console.log('⚠️ 댓글 버튼을 찾지 못했습니다.'); }

    await page.waitForSelector('.u_cbox_comment', { timeout: 10000 });
    
    // 댓글 데이터 추출
    const rawDataInfos = await page.$$eval('.u_cbox_comment', elements => elements.map(el => el.getAttribute('data-info')).filter(Boolean));
    console.log(`총 ${rawDataInfos.length}개의 댓글 데이터를 분석합니다...`);

    const repliedParentIds = new Set();
    const parsedComments = [];

    for (const dataInfo of rawDataInfos) {
      const commentNo = dataInfo.match(/commentNo:'(\d+)'/)?.[1];
      const parentNo = dataInfo.match(/parentCommentNo:'(\d+)'/)?.[1];
      const replyLevel = parseInt(dataInfo.match(/replyLevel:(\d+)/)?.[1] || 1);
      const isMine = dataInfo.match(/mine:(true|false)/)?.[1] === 'true';
      const isDeleted = dataInfo.match(/deleted:(true|false)/)?.[1] === 'true';
      
      if (isMine && replyLevel > 1 && parentNo) repliedParentIds.add(parentNo);
      parsedComments.push({ commentNo, parentNo, replyLevel, isMine, isDeleted });
    }

    // 💡 [기억 장착] 어제 확인한 마지막 댓글 번호 불러오기
    const lastProcessedNo = getLastProcessedCommentNo();
    let currentSessionMaxNo = lastProcessedNo;
    let index = 1;

    // 2. 내 블로그 댓글 답글 달기 & 답방 루프
    for (const comment of parsedComments) {
      const { commentNo, replyLevel, isMine, isDeleted } = comment;
      console.log(`\n--- [${index++}]번째 댓글 확인 중 (ID: ${commentNo}) ---`);

      if (!commentNo || isDeleted || isMine || replyLevel > 1) continue;

      const currentNoInt = parseInt(commentNo, 10);

      // 💡 [초고속 건너뛰기] 어제 한 것보다 번호가 작거나 같으면 DB 조회조차 안 하고 즉시 스킵!
      if (currentNoInt <= lastProcessedNo) {
        console.log(`⏩ [스킵] 이미 예전에 확인했던 옛날 댓글입니다. (DB 조회 생략)`);
        continue;
      }

      // 최대 번호 갱신
      if (currentNoInt > currentSessionMaxNo) {
        currentSessionMaxNo = currentNoInt;
      }

      const commentLocator = page.locator(`.u_cbox_comment[data-info*="commentNo:'${commentNo}'"]`).first();
      if (await commentLocator.count() === 0) continue;
      
      let alreadyReplied = repliedParentIds.has(commentNo);
      if (!alreadyReplied) {
        const { data } = await supabase.from('processed_comments').select('comment_id').eq('comment_id', commentNo);
        if (data && data.length > 0) alreadyReplied = true;
      }

      // [답글 로직]
      if (!alreadyReplied) {
        const commentText = await commentLocator.locator('.u_cbox_contents').first().innerText();
        const aiReplyText = await generateReply(commentText);
        console.log(`💬 [내 블로그 AI 답글] ${aiReplyText}`);

        await commentLocator.locator('.u_cbox_btn_reply').first().click();
        await page.waitForTimeout(1000); 
        await page.fill('.u_cbox_text', aiReplyText);
        await page.click('.u_cbox_btn_upload');
        
        await supabase.from('processed_comments').insert([{ comment_id: commentNo }]);
        await page.waitForTimeout(3000 + Math.random() * 1000);
      }

      // [이웃 답방 로직]
      const profileHref = await commentLocator.locator('a.u_cbox_name, a.u_cbox_thumb_wrap').first().getAttribute('href').catch(() => null);
      let neighborId = null;
      if (profileHref && profileHref !== '#' && !profileHref.includes('javascript')) {
        try {
          const urlObj = new URL(profileHref, 'https://m.blog.naver.com');
          neighborId = urlObj.searchParams.get('blogId');
          if (!neighborId) neighborId = urlObj.pathname.split('/').filter(Boolean)[0];
        } catch (e) {}
      }

      if (neighborId) {
        await visitNeighborAndReply(context, neighborId); // 분리한 함수 호출
      } else {
        console.log(`⚠️ [답방 패스] 이웃 아이디를 찾을 수 없습니다.`);
      }
    }

    // 💡 [기억 저장] 오늘 새롭게 확인한 가장 최신 댓글 번호를 메모장에 저장
    saveLastProcessedCommentNo(currentSessionMaxNo);

  } catch (error) {
    console.error('❌ 실행 중 에러 발생:', error);
  } finally {
    console.log('\n✅ 작업을 마치고 브라우저를 종료합니다.');
    await browser.close();
  }
}

runAgent();