import 'dotenv/config';
import http from 'node:http';
import { exec } from 'node:child_process';

// 로컬에서 한 번만 실행해서 리프레시 토큰과 BLOG_ID 를 발급받는 도우미 스크립트.
const PORT = 4573;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/blogger';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('먼저 .env 에 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 를 채워주세요.');
  console.error('발급 방법: docs/setup.md');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'select_account consent', // 계정 선택 창을 항상 표시
  });

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`인증 취소됨: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end('code 파라미터가 없습니다.');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2>인증 완료! 터미널로 돌아가세요.</h2>');
  server.close();

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const token = await tokenRes.json();

    if (!token.refresh_token) {
      console.error('\n⚠️  리프레시 토큰이 발급되지 않았습니다.');
      console.error('https://myaccount.google.com/permissions 에서 기존 앱 권한을 제거한 뒤 다시 실행하세요.');
      console.error(token);
      process.exit(1);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('아래 값을 .env 와 GitHub Secrets 에 저장하세요:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}`);

    // 내 블로그 목록을 조회해서 BLOG_ID 를 안내
    const blogsRes = await fetch('https://www.googleapis.com/blogger/v3/users/self/blogs', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const blogs = await blogsRes.json();
    if (blogs.items?.length) {
      console.log('\n내 블로그 목록 (아래 BLOG_ID 중 원하는 것을 사용):');
      for (const b of blogs.items) {
        console.log(`  BLOG_ID=${b.id}   ← ${b.name} (${b.url})`);
      }
    } else {
      console.log('\n(블로그 목록을 불러오지 못했습니다. Blogger 에서 블로그를 먼저 생성했는지 확인하세요.)');
    }
    console.log('────────────────────────────────────────────');
    process.exit(0);
  } catch (err) {
    console.error('토큰 발급 실패:', err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('브라우저에서 Google 로그인 창을 엽니다...');
  console.log(`창이 안 열리면 아래 URL 을 직접 방문하세요:\n${authUrl}\n`);
  openBrowser(authUrl);
});
