#!/usr/bin/env bash
set -euo pipefail
BASE_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
usage() {
  echo "Usage: $0 run|build|deploy [local|dev]"
  echo "  run local: Vue + API 개발 서버 / build dev: 빌드만 / deploy dev: Docker 실행"
}
fail() { printf '오류: %s\n' "$*" >&2; exit 1; }
[[ $# -gt 0 ]] || { usage; exit 1; }
case "$1" in -h|--help|help) usage; exit 0;; esac
[[ $# -le 2 ]] || { usage; exit 1; }
cmd="$1"
stage="${2:-local}"
case "$cmd" in run|build|deploy) ;; *) usage; exit 1;; esac
case "$stage" in local|dev) ;; *) fail "스테이지는 local 또는 dev여야 합니다.";; esac
cd -- "$BASE_PATH"
[[ -f ".env.$stage" ]] || fail ".env.$stage 파일이 없습니다."
if [[ "$cmd" == deploy ]]; then
  command -v docker >/dev/null || fail "Docker가 필요합니다."
  export FM_ENV_FILE=".env.$stage"
  docker compose --env-file "$FM_ENV_FILE" -f docker-compose.yaml config --quiet
  exec docker compose --env-file "$FM_ENV_FILE" -f docker-compose.yaml up --build -d
fi
command -v pnpm >/dev/null || fail "pnpm이 필요합니다."
[[ ! -e .env || -L .env ]] || fail ".env가 일반 파일입니다. 스테이지 파일로 옮긴 뒤 직접 정리해 주세요."
ln -sfn ".env.$stage" .env
case "$cmd" in
  run) exec pnpm dev ;;
  build) exec pnpm build ;;
esac
