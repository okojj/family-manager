# 우리집 · Family Manager

Vue 3 웹앱 + Fastify API + MySQL 기반 가족 미션·포인트·일정 앱입니다. 웹을 먼저 개발하고 이후 Capacitor로 Android 기능을 연결합니다.

- [기획 및 기본 설계](docs/FAMILY_APP_SPEC.md)
- [Google 공유 캘린더 연결 안내](docs/GOOGLE_CALENDAR.md)
- [실행 방법 · Google 로그인 · MySQL 설정 · 구현 현황](docs/DEVELOPMENT.md)

## 시작

```bash
pnpm install --frozen-lockfile
pnpm db:generate
# .env.example을 참고해 전용 DB와 Google 로그인 설정
pnpm db:migrate
pnpm dev
```

웹은 http://localhost:5173 에서 실행합니다. DB는 사용자가 설정한 `.env.local`의 DATABASE_URL을 사용합니다. 테스트 DB를 실행하거나 샘플 데이터를 입력하지 않습니다. 실제 Google 로그인은 GOOGLE_CLIENT_ID 연결이 필요합니다.

## 이번 구현

- Google 로그인 검증 및 가족 초대·역할 연결
- 미션 제출·부모 확인·예외·포인트 적립/차감
- 인출 신청·승인·지급 담당·지급 완료
- 가족 일정·양력 기념일·알림함
- Google 공유 캘린더 읽기 전용 가져오기·자동 갱신
- 부모용 미션·정산 관리 화면

주간 보너스 자동 정산·추가 미션·정정 원장·푸시는 후속 개발 항목입니다. 실제 운영 기록을 입력하기 전에 기획 문서의 미결정 정책을 확정해야 합니다.

현재 개발 위치: `/Users/ojj/repo/family-manager`. 실제 계정 비밀번호·인증 키·계좌번호를 문서나 저장소에 기록하지 않습니다.

## Docker 배포

웹과 API를 하나의 컨테이너로 배포하는 방법은 [Docker 안내](docs/DOCKER.md)를 참고하세요. 서버 실행은 사용자가 직접 수행합니다.
