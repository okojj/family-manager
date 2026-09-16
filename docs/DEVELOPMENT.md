# 개발·연결 안내

현재 개발 위치: `/Users/ojj/repo/family-manager`

## 구현한 범위

- Vue 3 + TypeScript + Vite 반응형 웹. 가족 화면과 `/admin` 부모 화면.
- Google Identity Services 버튼과 서버 ID 토큰 검증, nonce 재사용 방지.
- 서버 세션, HttpOnly 쿠키, CSRF·Origin 검사, 서버 역할·소유권 검사.
- 첫 부모의 가족 생성, 이메일 지정 일회성 초대, 아이/부모 역할 연결.
- 기본 반복 미션, 오늘 회차 생성, 완료 제출, 부모 승인·미수행 확정·예외 승인.
- MySQL 포인트 원장과 잔액, 인출 보류·승인·담당 선점·실제 지급 완료·취소.
- 가족 일정 등록·삭제, 양력 연간 기념일 표시, 앱 내 알림함.
- 개발 전용 샘플 가족, 21개 MySQL 통합 검사 코드. 최초 19개는 통과했으며 마지막 보완 후 전체 재실행은 미완료.

첫 구현 단계이며 기획 문서 전체 기능의 완료를 의미하지 않는다. 실제 Google 로그인과 기존 운영 MySQL 접속은 아직 검증하지 않았다. 브라우저의 화면 조작·모바일 기기 테스트도 별도로 필요하다.

## 로컬 실행

필요 도구: Node.js 22.12 이상 호환 LTS(현재 검증 Node 24), pnpm, 접속 가능한 MySQL. 이번 자동 검증은 Docker의 MySQL 8.4를 사용했다.

```bash
cd /Users/ojj/repo/myfam
pnpm install --frozen-lockfile
pnpm db:generate
# .env에 앱 전용 MySQL 및 Google 설정을 입력한 후 실행
pnpm db:migrate
pnpm dev
```

- 웹: http://localhost:5173
- API: http://127.0.0.1:3001 (Vite가 /api 요청을 중계)
- `../.env.local`는 저장소에서 제외한다. `.env.example`을 참고한다.
- 서버는 loopback으로만 실행한다. 개발 서버를 인터넷에 공개하지 않는다.
- 운영 시 웹과 API를 같은 HTTPS 출처에 두고 `/api`를 서버로 중계해야 한다. SPA 경로는 index.html로 연결한다.
- 운영 실행은 `pnpm build` 후 `pnpm start`다. 웹 산출물은 `dist/web`, 서버 산출물은 `dist/api`에 있다.
- 운영용 쿠키를 위해 NODE_ENV=production과 HTTPS APP_ORIGIN이 필요하다.

## 현재 시험 DB

이번 작업에서 `../.env.local`에 프로젝트 전용 시험 DB 설정을 생성했다. 사용자의 기존 MySQL에 접속하거나 테이블을 변경하지 않았다.

- 컨테이너: compose.test.yaml의 mysql 서비스.
- DB: demo_myfam / 포트 127.0.0.1:33316.
- 무작위 비밀번호는 로컬 `../.env.local`에만 저장.
- 화면의 시험 계정은 실제 Google 계정이 아니다. 시작 포인트 120P도 샘플 값이다.
- 시험 DB 데이터를 유지하면서 중지하려면 `pnpm test:db:stop`.
- 다시 실행하려면 `pnpm test:db:up` 후 `pnpm dev`.
- 초기 샘플 데이터 입력은 `pnpm seed:demo`. 기존 샘플이 있으면 덮어쓰지 않는다.
- 새 환경에서 시험 DB를 만들 때 `../.env.local`에 TEST_DB_PASSWORD, TEST_DB_ROOT_PASSWORD를 무작위 값으로 설정하고 DATABASE_URL에도 동일한 앱 계정 비밀번호를 지정한다.
- DEMO_MODE=true는 비운영 환경과 이름이 demo_로 시작하는 DB에서만 허용한다. 운영 환경에서는 샘플 로그인 경로가 존재하지 않는다.

## Google 로그인 연결

1. Google Cloud에서 사용할 프로젝트의 OAuth 동의 화면과 웹 애플리케이션 클라이언트를 준비한다.
2. 승인된 JavaScript 원본에 `http://localhost:5173`을 등록한다. 운영 시 실제 HTTPS 원본도 등록한다.
3. `../.env.local`의 GOOGLE_CLIENT_ID에 웹 클라이언트 ID를 입력한다.
4. BOOTSTRAP_PARENT_EMAIL에 가족을 처음 만들 부모의 Google 이메일을 입력한다.
5. 실제 가족용 앱 전용 DB를 지정하고 DEMO_MODE=false로 바꾼다. 시험 DB와 실제 기록을 섞지 않는다.
6. 서버를 재시작하고 설정한 부모 계정으로 로그인 → 가족 생성 → 나머지 가족 초대.
7. 초대 시 가족의 Google 이메일과 부모/아이 역할을 지정한다. 초대 코드는 직접 전달하며, 해당 이메일로 로그인한 계정에서만 24시간 이내 한 번 사용 가능하다.

현재 방식은 Google ID 토큰 검증이므로 Google client secret을 요구하지 않는다. 브라우저에서 전달한 이름·이메일·역할을 그대로 인증하지 않으며 서버가 검증한 토큰의 sub를 계정 식별자로 사용한다. 서비스 사용 권한은 Google 계정 자체가 아니라 가족 가입과 역할에서 결정한다.

Google 토큰 서명·대상 클라이언트·만료·발급자 검증은 공식 google-auth-library에 위임한다. nonce는 서버의 10분짜리 일회용 요청과 대조한다. 브라우저에는 서비스 세션 쿠키만 발급한다. Google 토큰을 localStorage에 저장하지 않는다.

자녀의 Family Link 관리 계정이나 Workspace 계정은 실제 계정 설정에 따라 로그인이 제한될 수 있으므로 가족의 실제 계정으로 확인해야 한다. Capacitor 연결 단계에서는 웹뷰 안의 Google 로그인 화면을 그대로 사용하지 않고 시스템 브라우저 또는 지원되는 네이티브 인증 흐름을 별도로 검증한다.

공식 참고:
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## MySQL 연결과 데이터

기존 MySQL 서버의 버전 및 접근 방법을 확인한 뒤 앱 전용 DB·계정을 준비한다. DATABASE_URL의 비밀번호에 특수문자가 있다면 URL 인코딩한다. 연결 정보는 채팅이나 문서에 붙이지 않는다.

`pnpm db:migrate`는 지정 DB에 앱 테이블을 생성한다. 기존 서비스 DB에 무심코 실행하지 않는다. 개발용 변경과 실제 배포 DB 변경은 분리하고, 운영 계정의 권한과 DB 백업을 확인한다.

현재 원장은 확정 미션당 하나, 지급 요청당 하나의 출처 키를 사용한다. 인출 가능액은 `max(0, balance - held)`이며 MySQL 트랜잭션에서 지갑 행을 잠근다. 두 부모가 동시에 같은 미션을 승인하면 한 번만 적립되고 다른 요청은 이미 처리됨 또는 충돌로 응답한다.

확정 결과의 정정·역분개는 다음 단계다. 현 단계에서는 기존 확정 결과를 다른 결과로 덮어쓰는 API가 없다. 원장 CRUD 삭제·직접 수정 API도 제공하지 않는다.

## 시험과 검증

```bash
pnpm typecheck
pnpm build
# 전용 demo_ DB가 실행 중인 상태에서만
pnpm test
```

통합 검사는 별도의 임시 가족을 만들고 검사 종료 후 해당 가족의 행만 정리한다. 샘플 가족은 보존한다. 검증 내용은 미인증·CSRF·부모 권한, 반복 생성 중복, 동시 승인, 인출 잔액 경쟁, 지급 담당자, 요청 재시도, 가족 초대, 일정 소유권이다.

실제 Google 계정의 로그인 성공, 브라우저 팝업, 휴대폰 표시, 알림 권한은 이 자동 검사의 범위에 포함하지 않는다.

## 다음 개발 항목

1. 실제 Google 클라이언트·부모 이메일·기존 MySQL 버전과 앱 전용 DB 연결 확인.
2. D01~D14 정책 결정. 현재 샘플 구현은 부모 확인, 음수 잔액, 1P 단위 인출의 제안값을 사용한다.
3. 추가 미션·담당 선점, 개인별 미션 배정, 정책 버전·확정 결과 역분개.
4. 별도 worker: 매일 미션 생성·누락 복구·주간 보너스·알림 예약. 현재 회차는 로그인 후 대시보드 조회 시 당일분이 생성된다.
5. 날짜별 지난 기록 조회, 주간 보너스와 가족회의 정산.
6. 반복 일정·참여자·픽업 담당, 기념일 윤일·음력 처리. 현재 기념일은 등록한 월일 그대로 매년 표시하며 2월 29일의 평년 대체일은 미지원.
7. 알림 취향·푸시·Capacitor, 계정 비활성화·세션 정리·백업 및 내보내기.
8. 실기기 사용성·접근성 검증, 운영 HTTPS·모니터링·DB 참조 무결성 강화.

## 현재 폴더

```text
apps/web/src/             Vue 화면·API 클라이언트
services/api/src/         인증·라우트·포인트 업무 처리
scripts/seed-demo.ts      시험 데이터 생성
database/schema.prisma   MySQL 모델
database/migrations/      DB 변경 SQL
tests/                   MySQL 통합 검사
docs/                    기획 및 개발 안내
```

## 이번 작업의 검증 기록 (2026-09-14)

- 최종 TypeScript 검사, Vue 프로덕션 빌드, API 컴파일: 통과.
- MySQL 8.4에서 최초 통합 검사 19개: 모두 통과.
- 이후 예외 신청 알림·지난 미결 미션 조회를 보완하고 검사 2개 추가. DB 검사 재실행 요청이 승인되지 않아 최종 21개 전체 검증은 아직 미실행.
- 마지막 UI 보완: 모달의 네이티브 포커스 처리, 모바일 부모 관리 메뉴 추가. 컴파일은 통과했으며 실제 브라우저 조작 검증은 미실행.
- 실제 Google 로그인: 클라이언트 ID 미설정으로 성공 흐름 미검증. 코드와 설정 절차만 준비됨.
- 기존 운영 MySQL: 미접속·미변경. 별도 시험 DB만 사용.
- 로컬 미리보기만 실행. 외부 배포는 하지 않음.

## Google Calendar 확장

Google 공유 캘린더를 읽기 전용으로 가져오는 기능을 추가했다. [Google 캘린더 연결 안내](GOOGLE_CALENDAR.md)에 추가 OAuth 설정과 동작 범위가 있다. 기존 Google 로그인 설명의 시크릿 불필요 조건은 로그인 단독에 해당하며 캘린더 연결에는 GOOGLE_CLIENT_SECRET과 CALENDAR_TOKEN_KEY가 필요하다.

### 후속 검증 결과

Google 캘린더 구현 후 기존 미완료 재검사를 포함한 전체 39개 검사를 실행했고 모두 통과했다. 앞선 21개 재실행 미완료 기록은 당시 상태이며 현재는 해소됐다. 실제 Google 계정 연동과 브라우저 조작 검증은 여전히 별도 확인이 필요하다.

## DB 사용 지침 변경 (2026-09-14)

사용자 지시: 앞으로 `../.env.local`의 DATABASE_URL을 사용한다. 테스트 DB 컨테이너를 자동 실행하거나 샘플 데이터를 입력하지 않는다. DB 연결을 위해 `../.env.local` 값을 테스트 설정으로 바꾸지 않는다. 테스트 DB를 전제로 한 위 실행 절차는 참고용 과거 기록이며, 현재 개발 시 적용하지 않는다. 실제 DB에서 스키마 변경·통합 검사·seed 실행은 별도 작업으로 검토한다.

## 실제 DB 초기화 완료 (2026-09-14)

사용자가 수정한 `../.env.local` DB에 초기 테이블과 Google 캘린더 테이블 마이그레이션을 적용했다. `seed:initial`로 가족 1개와 기본 미션 4개를 생성했으며 샘플 계정·잔액은 생성하지 않았다. INITIAL_FAMILY_ID는 준비된 가족을 가리키며 첫 부모가 실제 Google 로그인 후 가족 생성 버튼을 누르면 이 가족에 연결된다. 기존 기록을 덮어쓰지 않도록 초기 데이터 스크립트는 동일 ID로 재실행 가능하다.

현재 Google 로그인용 클라이언트 ID는 설정되어 있다. 실제 계정 선택·Google 동의는 사용자가 로그인 화면에서 완료해야 한다. 이후 나머지 가족을 초대한다. 캘린더 추가 권한 연결에는 별도의 클라이언트 시크릿 설정이 필요하다.
