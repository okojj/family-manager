# Google 공유 캘린더 가져오기

구현일: 2026-09-14. 개발 위치: `/Users/ojj/repo/myfam`.

## 기능

Google → MyFam 단방향 가져오기다. Google 일정을 만들거나 수정·삭제하는 호출은 구현하지 않는다. 부모가 읽기 권한을 승인하고 가족 전체에게 보여줄 캘린더 하나를 선택한다.

- 가족 달력 상단의 Google 공유 캘린더 패널에서 연결·선택·수동 갱신·연결 해제.
- 해당 계정의 읽기 가능한 캘린더 목록을 가져오고 선택한 캘린더만 저장.
- 서버가 실행 중이면 15분마다 갱신하며, 서버 재시작 시 갱신이 필요한 연결을 확인.
- 실행 시점 기준 지난 90일~앞으로 365일의 일정을 가져온다. 기간 밖 일정은 표시하지 않는다.
- 반복 일정은 Google API가 개별 회차로 펼친 결과를 가져온다. 회차별 시간 변경·취소를 반영한다.
- 종일 일정은 날짜를 보존하고 시간 있는 일정은 한국 시간으로 표시한다. 여러 날 일정은 해당 날짜들에 표시한다.
- 가져온 일정은 Google 배지와 원본 링크를 표시하고 앱의 삭제 버튼을 제공하지 않는다.
- Google 일정과 앱 자체 일정을 다른 테이블에 저장한다. 같은 제목이어도 출처가 다르면 별개 일정으로 유지한다.
- 연결 해제는 암호화 토큰과 가져온 일정만 앱에서 제거한다. Google 원본·앱 자체 일정은 그대로 유지한다.
- 재연결 또는 다른 캘린더 선택 시 이전에 가져온 일정을 제거하고 새 캘린더로 다시 가져온다. 재연결 버튼은 이 동작을 미리 알린다.
- 연결 해제는 앱에 저장된 토큰을 제거한다. Google 계정 자체의 앱 승인 기록도 제거하려면 Google 계정의 연결된 앱 설정에서 별도로 해제한다.

## 데이터 범위와 알림

선택한 캘린더의 제목·시간·장소·설명이 모든 가족에게 보인다. 개인 캘린더를 실수로 선택하지 않도록 선택 화면에 안내한다. 참석자 이메일·첨부파일은 가져오지 않는다. Google 로그인만 했다고 자동으로 캘린더 권한을 얻지 않는다.

이번 구현은 일정 표시와 갱신만 수행한다. 가져온 일정에 대해 별도의 MyFam 푸시·이메일 알림을 보내지 않는다. Google Calendar에서 사용하는 기존 알림은 계속 사용할 수 있다.

## Google 설정

1. 기존 로그인용 Google Cloud 프로젝트에서 **Google Calendar API**를 활성화한다.
2. OAuth 웹 애플리케이션 클라이언트에 아래 승인된 리디렉션 URI를 추가한다.
   - 개발: `http://localhost:5173/api/google-calendar/callback`
   - 운영: `https://실제서비스도메인/api/google-calendar/callback`
3. 기존 승인된 JavaScript 원본 `http://localhost:5173`과 운영 HTTPS 원본을 유지한다.
4. OAuth 동의 화면에서 아래 읽기 전용 범위를 사용하고, 시험 상태라면 연결할 부모 계정을 테스트 사용자에 포함한다.
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
5. 서버의 `../.env.local`에 다음 설정을 입력한다. 실제 시크릿은 채팅·Git·문서에 넣지 않는다.

```dotenv
GOOGLE_CLIENT_ID="기존 웹 클라이언트 ID"
GOOGLE_CLIENT_SECRET="같은 클라이언트의 시크릿"
CALENDAR_TOKEN_KEY="무작위 32바이트를 표현한 64자리 hex"
APP_ORIGIN="http://localhost:5173"
```

Google 로그인 단독 기능은 시크릿을 사용하지 않지만, 캘린더의 지속 접근을 위한 서버 authorization-code 교환에는 시크릿이 필요하다. CALENDAR_TOKEN_KEY는 refresh token 저장용 암호화 키이며 변경하면 기존 연결 토큰을 복호화할 수 없으므로 보관·백업한다. 키 변경 시 캘린더 재연결이 필요하다.

6. `pnpm db:generate`, `pnpm db:migrate` 후 서버를 다시 시작한다.
7. 실제 부모 계정으로 로그인하고 **가족 달력 → Google 계정 연결 → 권한 허용 → 캘린더 선택 → 이 캘린더 가져오기**를 진행한다.
8. Google에서 일정 하나를 수정한 뒤 **지금 가져오기**로 반영을 확인한다.

테스트 모드 OAuth 앱의 refresh token은 Google 정책에 따라 만료되어 재연결이 필요할 수 있다. 운영 전 동의 화면 상태와 실제 계정의 권한 정책을 확인한다. Family Link·Workspace 제한은 실제 부모 계정으로 검증한다.

## 서버 구현

파일: `services/api/src/google-calendar.ts`.

- OAuth state를 해시로 저장하고 요청한 부모·가족·로그인 세션에 연결한다. 유효 시간은 10분이며 한 번만 소비한다.
- PKCE S256을 사용한다. 거절·만료·세션 불일치 콜백은 연결을 변경하지 않는다.
- refresh token은 AES-256-GCM으로 암호화해 서버 DB에 저장한다. 브라우저에 반환하지 않는다.
- OAuth 콜백 query string은 요청 로그에서 제외한다. 외부 API 오류 객체에 포함될 수 있는 토큰도 응답·로그에 출력하지 않는다.
- Google Calendar 데이터 API 호출은 GET만 사용한다. OAuth 코드 교환·토큰 갱신의 POST는 인증 절차이며 일정 쓰기가 아니다.
- 백그라운드 갱신 시 연결을 만든 부모의 활성 상태·가족 소속·부모 역할을 다시 확인한다.

### 가져오기 알고리즘

가족 캘린더 규모에 맞춰 시간 범위를 제한한 전체 결과 교체 방식을 사용한다. syncToken 기반 증분 동기화는 이번 구현에 사용하지 않는다.

1. DB에 5분짜리 실행 소유권을 기록해 동일 가족의 중복 실행을 막는다.
2. events.list에 singleEvents=true, showDeleted=false, 한국 시간대와 기간을 전달한다.
3. 모든 nextPageToken을 따라 결과를 모은다. 이벤트 최대 20,000건·페이지 최대 100개를 넘으면 실패 처리하고 이전 결과를 유지한다.
4. ID와 날짜를 검증하고 `(가족, 캘린더, Google event ID)` 해시로 중복을 제거한다.
5. 연결 revision과 실행 소유권을 다시 검사한다. 연결이 바뀌거나 해제됐다면 이전 요청 결과를 저장하지 않는다.
6. 하나의 MySQL 트랜잭션에서 가져온 일정만 교체하고 마지막 성공 시각을 기록한다.

전체 요청 성공 시 Google에서 사라진 일정은 앱에서도 빠진다. 페이지 일부 실패·권한 오류·형식 오류는 이전 성공 결과를 유지하고 연결 패널에 오류를 남긴다. 기간 밖으로 이동한 일정 역시 앱 표시 범위에서 빠진다. 이 기능은 Google 변경을 즉시 전달하는 실시간 동기화가 아니다.

### 테이블

- GoogleCalendarConnection: 가족당 연결 1개, 암호화된 토큰, 선택 캘린더, revision, 갱신 소유권·시각·오류.
- CalendarOAuthState: 일회성 OAuth state, 세션·가족·부모·PKCE verifier.
- GoogleCalendarEvent: 가져온 일정, 날짜 범위, 종일 여부, 안전한 Google 원본 링크.

### API

모든 연결 관련 API는 부모 전용이며 변경 요청에는 기존 세션·CSRF·Origin 검사를 적용한다. 가져온 일정 조회는 기존 가족 dashboard를 통해 이루어진다.

| 경로 | 역할 |
|---|---|
| GET /api/google-calendar/status | 연결·설정·마지막 성공 상태 |
| POST /api/google-calendar/authorize | Google 동의 화면 URL 생성 |
| GET /api/google-calendar/callback | state 검증 및 토큰 교환 |
| GET /api/google-calendar/calendars | 선택 가능한 캘린더 목록 |
| POST /api/google-calendar/select | 선택 검증 및 최초 가져오기 |
| POST /api/google-calendar/sync | 즉시 가져오기 |
| DELETE /api/google-calendar/connection | 로컬 연결·가져온 일정 제거 |

## 검증 범위

자동 검사에는 암호화, 읽기 전용 범위, 날짜·시간대, 중복 ID, 취소, 갱신 후 삭제, 통신 실패 후 보존, 중복 실행, 연결 변경 경쟁, 부모 권한, OAuth state 위조, 앱 일정 보존을 포함한다. Google 응답은 시험용 대역을 사용하며 실제 Google 계정 접근은 하지 않는다.

실제 Google OAuth 성공·공유 캘린더 목록·외부 API 통신·기기 브라우저 화면은 클라이언트 설정 후 별도 확인해야 한다.

## 공식 문서

- [OAuth 웹 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar 읽기 권한](https://developers.google.com/workspace/calendar/api/auth)
- [events.list: 반복·페이지·기간](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)

### 검증 결과

2026-09-14: TypeScript·웹 및 API 빌드 통과. MySQL 8.4 통합 검사와 단위 검사 총 39개 모두 통과(캘린더 18개, 기존 기능 21개). 실제 Google OAuth·외부 API 연결은 설정값 미제공으로 미검증.
