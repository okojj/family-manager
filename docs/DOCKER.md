# 단일 컨테이너 배포

Vue 빌드 파일과 Fastify API를 하나의 Node 프로세스에서 제공합니다. MySQL은 기존 서버를 사용합니다. stock-manager의 단일 app 서비스, 상태 확인, 로그 순환 구성을 참고했습니다.

## 환경 준비

`.env.dev`에서 다음 값을 설정하세요. 실제 비밀 값은 저장소에 커밋하지 않습니다.

```dotenv
APP_ORIGIN=https://family.ojj.ai
APP_PORT=4001
DATABASE_URL='mysql://USER:URL_ENCODED_PASSWORD@host.docker.internal:3306/my_family'
```

- 호스트 MySQL은 `host.docker.internal`, 다른 서버의 MySQL은 해당 호스트명을 사용합니다. 컨테이너 안의 `127.0.0.1`은 MySQL 호스트가 아닙니다. MySQL 계정/방화벽에서도 컨테이너 연결을 허용해야 합니다.
- 기존 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALENDAR_TOKEN_KEY, BOOTSTRAP_PARENT_EMAIL, INITIAL_FAMILY_ID를 유지합니다. 암호화 키를 바꾸면 저장된 캘린더 연결을 읽을 수 없습니다.
- 운영 모드는 HTTPS APP_ORIGIN을 요구합니다. 호스트의 HTTPS 리버스 프록시에서 `127.0.0.1:4001`로 웹과 `/api` 요청을 모두 전달하세요.
- 기본 포트 바인딩은 호스트 루프백입니다. 별도 컨테이너 프록시를 쓰는 경우 네트워크/바인딩 구성을 환경에 맞게 조정해야 합니다.
- Google 승인된 JavaScript 원본에 APP_ORIGIN을, 승인된 리디렉션 URI에 `https://family.ojj.ai/api/google-calendar/callback`을 등록합니다.
- Compose가 `$`를 해석할 수 있으므로 비밀 값은 작은따옴표로 감싸고, DATABASE_URL의 비밀번호는 URL 인코딩합니다.

## 사용자가 직접 실행

```bash
./fm.sh deploy dev
# 또는
FM_ENV_FILE=.env.dev docker compose --env-file .env.dev -f docker-compose.yaml up --build -d
```

```bash
docker compose -f docker-compose.yaml logs -f app
docker compose -f docker-compose.yaml down
```

`./fm.sh run local`은 개발 서버, `./fm.sh build dev`는 빌드만 수행합니다. Docker 배포는 루트 `.env` 링크를 변경하지 않습니다. 동일 Compose 프로젝트를 사용하므로 deploy는 기존 컨테이너를 갱신합니다.

DB 생성, 마이그레이션, 시드는 자동으로 실행하지 않습니다. 필요한 마이그레이션은 올바른 DB 설정을 확인한 후 별도로 수행합니다. 테스트 DB 컨테이너는 포함하지 않습니다. 상태 확인은 API 프로세스 응답을 검사하며 DB의 지속적인 정상 동작까지 보장하지 않습니다.

에이전트는 로컬/Docker 서버를 시작하거나 재시작하지 않습니다. 사용자가 직접 실행한 서버만 이용합니다.
