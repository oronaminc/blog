# ✍️ blog — 마크다운 → 여러 플랫폼 자동 발행

`posts/` 의 마크다운을 **Blogger·WordPress·Dev.to** 에 발행하고,
로컬 웹 UI(`:4599`)에서 쓰고 고치고 발행 상태를 본다.

```bash
npm run web                # 관리 UI → http://localhost:4599
npm run publish:dry        # 무엇이 올라갈지 미리보기 (발행 안 함)
npm run publish            # 실제 발행
```

> 🚨 **자동 발행은 현재 꺼져 있습니다.** 2026-07-24 봇 차단 사건 이후 GitHub Actions
> 워크플로를 `publish.yml.disabled` 로 비활성화했습니다. 발행은 지금 **사람이
> 속도를 보면서 수동으로만** 합니다. 반드시 [발행 속도 규칙](#-발행-속도-규칙-반드시-읽을-것)
> 을 읽고 나서 발행하세요.

처음 설치라면 → [`docs/setup.md`](docs/setup.md) (인증정보 발급, 한 번만).

---

## 📁 무엇이 어디에

```
blog/
├── posts/              # 발행 대상 마크다운 (91편)
├── drafts/             # 아직 발행 대상이 아닌 초안
├── assets/             # 본문 이미지 — 발행 시 jsDelivr CDN URL 로 변환
├── .publish-state.json # 파일별 발행 상태·원격 ID·본문 해시 (중복 발행 방지)
├── server/index.mjs    # 로컬 관리 UI (Express, 127.0.0.1 전용)
├── scripts/
│   ├── publish.mjs         # 전체 발행 (--dry-run · --only= · --targets=)
│   ├── publish-one.mjs     # 딱 한 편만 발행 (드립용)
│   ├── drip-publish.sh     # ⚠️ 구식 — 고정 간격 루프. 아래 경고 참고
│   ├── reconcile.mjs       # 원격 글과 로컬을 제목으로 매칭해 상태 파일 복구
│   ├── get-token.mjs       # OAuth 리프레시 토큰 발급 (최초 1회)
│   └── lib/
│       ├── adapters/       # 플랫폼별 어댑터 (blogger · wordpress · devto)
│       ├── publisher.mjs   # 발행 오케스트레이션
│       ├── posts.mjs content.mjs render.mjs   # 파일 읽기 · 마크다운 → HTML
│       └── state.mjs       # .publish-state.json 읽기/쓰기
└── docs/
    ├── setup.md                    # 초기 인증 설정
    └── blogger-bot-block-guide.md  # 봇 차단 사건 분석 + 재발 방지
```

---

## 🔌 멀티플랫폼 어댑터

각 플랫폼은 `scripts/lib/adapters/` 의 어댑터 하나다. 계약:

```
{ id, kind, contentFormat, capabilities, requiredEnv,
  hashPayload(post), publish(post, ctx), update(prev, post, ctx) }
```

| 어댑터 | 필요한 환경변수 | 상태 |
|---|---|---|
| `blogger` | `BLOG_ID` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` | 사용 중 |
| `wordpress` | `WP_URL` · `WP_USER` · `WP_APP_PASSWORD` | 미설정 |
| `devto` | `DEVTO_API_KEY` | 미설정 |

**설정된 어댑터만 자동으로 켜진다** — `requiredEnv` 가 전부 채워져 있으면 활성, 아니면
조용히 건너뛴다. 그래서 `.env` 에 키를 넣는 것만으로 대상이 늘어난다.
(`.env.example` 에는 아직 Blogger 항목만 있으니 나머지는 직접 추가해야 한다.)

**canonical 우선순위는 `wordpress > blogger > devto`.** 앞쪽이 먼저 발행되어 canonical
URL 을 확보하고, 나머지 플랫폼에 그 URL 을 주입한다 — 중복 콘텐츠로 취급되지 않게 하려는 것.

```bash
npm run publish -- --targets=blogger        # 특정 플랫폼만
npm run publish -- --only=2026-07-25-foo.md # 특정 글만
```

`Hatena·Matters·Naver` 는 어댑터 레지스트리에 자리만 있고 아직 구현되지 않았다.

---

## ✍️ 글 쓰는 법

`posts/` 에 `.md` 파일을 만들고 프론트매터를 넣는다:

```markdown
---
title: "글 제목"
labels: [태그1, 태그2]
draft: false
date: 2026-07-21
---

본문을 **마크다운**으로.
```

- `draft: true` → 초안으로만 올라감 · `draft: false` → 정식 발행
- 같은 파일을 고쳐 다시 발행하면 **덮어쓰기**된다 (`.publish-state.json` 의 본문 해시로
  판단하므로 중복 발행되지 않는다)
- **이미지**: Blogger API 는 이미지를 호스팅하지 않는다. UI 에서 드래그/붙여넣기하면
  `assets/` 에 저장되고 발행 시 **jsDelivr CDN 절대 URL** 로 변환된다.
  → 이미지가 블로그에 보이려면 **`assets/` 를 git push 해야 한다.**

---

## 🖥 로컬 관리 UI (`npm run web`)

파일을 직접 안 만들고 브라우저에서 관리한다. `127.0.0.1` 로만 열린다 —
파일 쓰기 권한과 OAuth 토큰을 다루기 때문.

- 글 목록 + 상태 배지 (로컬만 / 초안 / 발행됨 / 수정됨)
- 마크다운 에디터 + 실시간 프리뷰 (발행될 HTML 과 동일하게 렌더)
- 프론트매터 폼 편집, 자동저장(⌘S)
- 원클릭 발행 · 초안↔공개 전환 · dry-run
- **원격 가져오기** — 이미 올라간 글을 로컬 마크다운으로 임포트
- 검색 · 상태/라벨 필터

주요 API: `/api/posts` · `/api/render` · `/api/publish` · `/api/targets` ·
`/api/drift` · `/api/remote` · `/api/import` · `/api/upload` · `/api/status`

---

## 🚨 발행 속도 규칙 (반드시 읽을 것)

2026-07-24, 3일 된 블로그에 API 로 글을 몰아 올려 **Google 계정이 봇으로 판정**되어
발행이 막혔다. 차단된 뒤 12시간 동안 100회 넘게 재시도한 것이 결정타였다.
전체 분석 → [`docs/blogger-bot-block-guide.md`](docs/blogger-bot-block-guide.md)

지켜야 할 것:

- **`403` 은 재시도 금지.** 재시도해도 절대 안 풀리고 봇 플래그만 깊어진다.
- **글 사이 최소 45~90분**, 하루 소량부터 램프업 (가이드 §4-1 표).
- **고정 간격 금지** — 정확히 4분 간격 같은 규칙성이 볼륨보다 강한 봇 신호다.
- 발행 시간대는 **07:00~23:00** 만.

> ⚠️ **`scripts/drip-publish.sh` 는 이 규칙을 어긴다** — 고정 240초 간격으로 최대 45회
> 루프한다. 사건 당시 문제가 된 바로 그 패턴이라 **쓰지 말 것.** 한 편씩 올리려면
> `node --env-file=.env scripts/publish-one.mjs` 를 사람이 간격을 두고 직접 실행한다.
>
> 코드 차원의 방지책(403 즉시 중단·일일 캡·영속 서킷브레이커)은 **아직 미반영**이다.
> 현재 안전한 이유는 코드가 고쳐져서가 아니라 **자동화를 꺼놨기 때문**이다.
> 자동 발행을 다시 켜기 전에 가이드 §5 의 1·3·4 를 먼저 반영할 것.

### 상태가 꼬였을 때

발행 도중 중단되어 `.publish-state.json` 이 실제와 어긋나면:

```bash
node --env-file=.env scripts/reconcile.mjs   # 원격 글과 제목으로 매칭해 상태 복구
```

---

## 🔗 연계

`bot` 과 `post` 의 일일 트렌드 리포트가 소재로 들어오고, `frame` 이 썸네일을 만든다.
전체 그림은 [`../README.md`](../README.md), 켜고 끄는 건 `hub` (`hub up blog`).
