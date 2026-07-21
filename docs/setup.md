# 초기 설정 가이드 (인증정보 발급)

이 문서는 딱 한 번만 하면 됩니다. 순서대로 따라오세요.

---

## 1. Google Cloud 프로젝트 만들기

1. https://console.cloud.google.com/ 접속 (Blogger 를 만든 그 구글 계정으로 로그인)
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 아무거나(예: `blog-publish`) → 만들기

## 2. Blogger API 켜기

1. 좌측 메뉴 **API 및 서비스 → 라이브러리**
2. `Blogger API v3` 검색 → 클릭 → **사용 설정(Enable)**

## 3. OAuth 동의 화면 설정

1. **API 및 서비스 → OAuth 동의 화면**
2. User Type: **외부(External)** → 만들기
3. 앱 이름 아무거나, 사용자 지원 이메일 = 본인 이메일, 개발자 연락처 = 본인 이메일 → 저장 후 계속
4. 범위(Scopes) 단계는 그냥 **저장 후 계속**
5. 테스트 사용자 단계에서 **본인 구글 이메일을 테스트 사용자로 추가** → 저장 후 계속

> ⚠️ **중요 (7일 만료 문제):**
> 앱이 **테스트(Testing)** 상태이면 리프레시 토큰이 **7일 뒤 만료**됩니다.
> 자동 발행이 계속 돌게 하려면, OAuth 동의 화면에서 게시 상태를
> **"프로덕션(In production)"** 으로 **게시(PUBLISH APP)** 하세요.
> (개인용이라 Google 심사는 보통 필요 없고, "확인되지 않은 앱" 경고만 뜹니다 → 계속 진행 가능)

## 4. OAuth 클라이언트 ID 만들기

1. **API 및 서비스 → 사용자 인증 정보(Credentials)**
2. **사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
3. 애플리케이션 유형: **데스크톱 앱(Desktop app)** ← 반드시 이걸로
4. 만들기 → 팝업에 뜨는 **클라이언트 ID** 와 **클라이언트 보안 비밀(Secret)** 을 복사

## 5. .env 채우기

프로젝트 폴더의 `.env` 파일에 방금 복사한 값을 넣습니다:

```
GOOGLE_CLIENT_ID=여기에_클라이언트_ID
GOOGLE_CLIENT_SECRET=여기에_시크릿
```

## 6. 리프레시 토큰 + BLOG_ID 발급

터미널에서:

```bash
npm install
npm run get-token
```

- 브라우저가 열리면 본인 구글 계정으로 로그인 → 권한 허용
  - "확인되지 않은 앱" 경고가 나오면 **고급 → (안전하지 않음) 이동** 클릭
- 터미널에 `GOOGLE_REFRESH_TOKEN=...` 과 `BLOG_ID=...` 후보가 출력됩니다.
- 이 두 값을 `.env` 에 마저 채웁니다.

이제 `.env` 4개 값이 모두 채워졌습니다:

```
BLOG_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

## 7. 로컬 테스트

```bash
npm run publish:dry   # 실제 발행 없이 무엇이 올라갈지 미리보기
npm run publish       # 실제 발행 (posts/ 의 글을 Blogger 로)
```

## 8. GitHub Actions(자동 발행) 연결

저장소 **Settings → Secrets and variables → Actions → New repository secret** 에서
아래 4개를 `.env` 와 똑같은 값으로 등록:

- `BLOG_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

등록 후에는 `posts/` 에 글을 추가하고 `git push` 하면 자동 발행됩니다.

---

## 글 쓰는 법

`posts/` 폴더에 `.md` 파일을 만들고 상단에 frontmatter 를 넣습니다:

```markdown
---
title: "글 제목"
labels: [태그1, 태그2]
draft: false
date: 2026-07-21
---

본문을 **마크다운**으로 작성합니다.
```

- `draft: true` → Blogger 에 초안으로만 올라감 (검토용)
- `draft: false` → 정식 발행
- 같은 파일을 수정 후 push 하면 **덮어쓰기(업데이트)** 됩니다 (중복 발행 안 됨)

---

## 로컬 웹 관리 UI

터미널에서 글을 파일로 만들지 않고, **브라우저에서 편집·관리**할 수 있습니다.

```bash
npm run web       # http://localhost:4599 접속
# npm run dev     # 코드 수정 시 자동 재시작(개발용)
```

제공 기능:

- **글 목록 + 상태 배지** — 로컬만 / 초안 / 발행됨 / 수정됨(재발행 필요)
- **마크다운 에디터 + 실시간 프리뷰** (발행될 HTML과 동일하게 렌더)
- **제목·라벨·날짜·초안** 프론트매터 폼 편집, 자동저장(⌘S)
- **원클릭 발행 / 초안↔공개 전환** (단건·전체·dry-run 미리보기)
- **원격 가져오기** — Blogger 기존 글을 로컬 마크다운으로 임포트
- **검색·상태/라벨 필터**

> 이 서버는 파일 쓰기·발행 권한과 OAuth 토큰을 다루므로 **`127.0.0.1`(로컬 전용)** 로만 열립니다.
>
> ⚠️ **이미지**: Blogger API 는 이미지를 호스팅하지 않습니다. CMS에서 이미지를 드래그/붙여넣기하면 `assets/`에 저장되고, 발행 시 자동으로 **jsDelivr CDN 절대 URL**로 변환됩니다. 단, 이미지가 블로그에 보이려면 `assets/`를 **git push** 해야 합니다.

---

## 공개 블로그 테마 적용

`theme/news.xml` — 반응형·한글 타이포·다크모드 지원 커스텀 Blogger 테마.
(Blogger API 로는 테마를 못 바꿔서, 대시보드에서 직접 업로드합니다.)

1. https://www.blogger.com → 해당 블로그 선택
2. 좌측 **테마(Theme)** 메뉴
3. **Customize** 버튼 옆 **▾(아래 화살표)** 클릭 → **백업/복원(Backup/Restore)**
4. **먼저 현재 테마 백업(Download)** 을 받아두세요 (문제 시 즉시 복구용)
5. **업로드(Upload)** → `theme/news.xml` 선택 → 저장
6. 색상은 **테마 → Customize → 고급(Advanced)** 에서 `keycolor` 로 변경 가능

> 업로드 전 로컬 검증: `xmllint --noout theme/news.xml` (well-formed 여부가 Blogger의 첫 거부 관문)
