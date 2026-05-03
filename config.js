// config.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1. 내 블로그용 AI 두뇌
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
        3. 자연스러운 한국어 웃음 표현인 'ㅎㅎ' 나 'ㅋㅋ'를 문장 끝에 한두 번만 사용할 것.
        4. 편안하고 친근한 구어체(~해요, ~맞아요 등)를 사용할 것.
        5. (매우 중요) 부연 설명 없이 오직 '답글 텍스트' 하나만 출력할 것.`
      },
      {
        role: "user",
        content: `내 포스팅에 방문자가 다음과 같은 댓글을 남겼습니다: "${commentText}"`
      }
    ],
    temperature: 0.7, 
  });
  return response.choices[0].message.content.trim();
}

// 2. 이웃 블로그용 AI 두뇌
async function generateNeighborComment(postText) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 네이버 블로그 이웃의 새 글을 읽고 소통하러 온 다정한 방문자입니다. 
        [제약 조건]
        1. 본문 내용을 바탕으로 1~2문장의 공감하는 댓글을 담백하게 작성할 것.
        2. 이모지(이모티콘) 절대 금지. 'ㅎㅎ' 나 'ㅋㅋ'를 자연스럽게 섞어 쓸 것.
        3. 매크로성 인사(잘보고 갑니다 등)는 절대 금지.
        4. (매우 중요) 부연 설명 없이 오직 '댓글 본문'만 출력할 것.`
      },
      {
        role: "user",
        content: `다음은 이웃 블로그의 최신 포스팅 본문입니다. 읽고 공감하는 댓글을 달아주세요: \n\n"${postText.substring(0, 1500)}"` 
      }
    ],
    temperature: 0.7, 
  });
  return response.choices[0].message.content.trim();
}

// 다른 파일에서 쓸 수 있도록 내보내기
module.exports = {
  supabase,
  generateReply,
  generateNeighborComment
};