require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🧠 [기능 1] 이웃의 위키(기억)를 DB에서 불러오는 함수
async function getNeighborWiki(blogId) {
  const { data, error } = await supabase
    .from('neighbor_wiki')
    .select('*')
    .eq('blog_id', blogId)
    .single();

  if (error && error.code !== 'PGRST116') { // 데이터가 없는 에러(첫 방문)는 무시
    console.error('위키 조회 에러:', error.message);
  }
  return data || { persona: '첫 방문', interaction_history: '기록 없음', last_visited_at: null };
}

// 🧠 [기능 2] 이웃의 위키(기억)를 최신화하여 DB에 덮어쓰는 함수
async function updateNeighborWiki(blogId, newPersona, newHistory) {
  const { error } = await supabase
    .from('neighbor_wiki')
    .upsert({ 
      blog_id: blogId, 
      persona: newPersona, 
      interaction_history: newHistory,
      last_visited_at: new Date().toISOString()
    });
  if (error) console.error('위키 업데이트 에러:', error.message);
}

// 🤖 [기능 3] LLM을 이용해 기억 기반 댓글 생성 + 위키 요약
async function generateWikiComment(wiki, postContent) {
  // 1. 진짜 사람처럼 과거 기억을 바탕으로 댓글 쓰기
  const commentResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini", // 혹은 gpt-3.5-turbo
    messages: [
      {
        role: "system",
        content: `너는 내 블로그의 다정하고 센스 있는 소통 에이전트야. 방문한 이웃의 위키(기억)를 참고해서 친근하게 댓글을 달아줘.
        
        [이웃 위키 정보]
        - 이웃 특징(관심사): ${wiki.persona}
        - 과거 소통 기록: ${wiki.interaction_history}
        
        [작성 규칙]
        1. 과거 소통 기록에 있는 말(예: 첫인사)은 절대 반복하지 말 것.
        2. 이웃의 특징이나 과거 맥락을 살짝 언급하며 이어갈 것.
        3. 새 글 내용에 공감하는 반응을 보일 것.
        4. 로봇처럼 보이지 않게 2~3문장으로 짧고 자연스럽게 작성할 것.`
      },
      { role: "user", content: `새 글 내용: ${postContent}` }
    ]
  });

  const myComment = commentResponse.choices[0].message.content.trim();

  // 2. 방금 단 댓글과 글 내용을 바탕으로 위키(기억) 업데이트용 요약 만들기
  const wikiUpdateResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `방금 이웃의 글을 읽고 댓글을 달았어. 이 이웃에 대한 위키(기억)를 최신화해줘.
        출력은 반드시 JSON 형식으로 해줘.
        {"persona": "이웃의 주요 관심사 (누적해서 업데이트)", "interaction_history": "지금까지 나눈 소통 핵심 요약 (방금 단 댓글 내용 포함)"}`
      },
      { role: "user", content: `기존 위키: ${JSON.stringify(wiki)}\n이번 글 내용: ${postContent}\n내가 방금 단 댓글: ${myComment}` }
    ]
  });

  const updatedWiki = JSON.parse(wikiUpdateResponse.choices[0].message.content);

  return { myComment, updatedWiki };
}

// ... (Playwright 브라우저 실행 및 이웃 새글 목록 순회하는 기존 코드는 그대로 유지) ...

async function processNeighborPost(page, blogId, postContent) {
  console.log(`\n🔍 [${blogId}] 이웃의 위키(기억)를 조회합니다...`);
  const wiki = await getNeighborWiki(blogId);

  // 🛡️ [방어 로직] 12시간 이내에 방문한 적이 있다면 스킵! (도배 방지)
  if (wiki.last_visited_at) {
    const lastVisit = new Date(wiki.last_visited_at);
    const hoursSinceLastVisit = Math.abs(new Date() - lastVisit) / 36e5;
    if (hoursSinceLastVisit < 12) {
      console.log(`⏳ ${blogId}님은 ${Math.round(hoursSinceLastVisit)}시간 전에 방문했습니다. 스킵합니다.`);
      return; 
    }
  }

  console.log(`📝 [${blogId}] 위키 정보를 바탕으로 맞춤형 댓글을 고민 중...`);
  const { myComment, updatedWiki } = await generateWikiComment(wiki, postContent);

  // ... (여기에 page.fill() 등을 이용해 myComment를 실제 네이버 블로그 창에 입력하고 등록하는 기존 코드 삽입) ...
  console.log(`✅ [댓글 작성 완료] ${myComment}`);

  console.log(`💾 [${blogId}] 이웃 위키(기억)를 업데이트하여 DB에 저장합니다.`);
  await updateNeighborWiki(blogId, updatedWiki.persona, updatedWiki.interaction_history);
}

// runAgent() 등 메인 함수 실행