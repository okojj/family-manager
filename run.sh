#!/usr/bin/env bash
# Family Manager: 사용자가 직접 실행하는 스테이지별 실행 도구.
#
set -euo pipefail
BASE_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

usage() {
    cat <<'USAGE'
Usage: ./fm.sh run|build|deploy [local|dev]
  ./fm.sh run local   # Vue + API 개발 서버 (기본값: local)
  ./fm.sh run dev     # .env.dev 설정으로 개발 서버 실행
  ./fm.sh build dev   # 타입 검사 및 웹/API 빌드 (서버 실행 없음)
  ./fm.sh deploy dev  # 서비스용 compose.yaml이 있을 때만 Docker 실행
DB 생성, 마이그레이션, 시드, 테스트 DB 실행은 자동 수행하지 않습니다.
USAGE
}

fail() { printf '오류: %s\n' "$*" >&2; exit 1; }

[[ $# -gt 0 ]] || { usage; exit 1; }
case "$1" in -h|--help|help) usage; exit 0;; esac
[[ $# -le 2 ]] || { usage; exit 1; }
cmd="$1"
stage="${2:-local}"
case "$cmd" in run|build|deploy) ;; *) usage; exit 1;; esac
case "$stage" in local|dev) ;; *) fail "지원하지 않는 스테이지: $stage (local 또는 dev)";; esac
cd -- "$BASE_PATH"
[[ -f ".env.$stage" ]] || fail ".env.$stage 파일이 없습니다. .env.example을 참고해 준비하세요."
# 실제 .env 파일은 덮어쓰지 않습니다.
[[ ! -e .env || -L .env ]] || fail ".env가 일반 파일입니다. 내용을 스테이지 파일로 옮긴 후 직접 정리해 주세요."
if [[ "$cmd" == deploy ]]; then
    [[ -f compose.yaml ]] || fail "서비스용 compose.yaml이 없습니다. compose.test.yaml은 테스트 DB 전용이므로 사용하지 않습니다."
    command -v docker >/dev/null 2>&1 || fail "Docker가 필요합니다."
    docker compose version >/dev/null
    docker compose --project-name "family-manager-$stage" --env-file ".env.$stage" -f compose.yaml config --quiet
else
    command -v pnpm >/dev/null 2>&1 || fail "pnpm이 필요합니다."
    [[ -d node_modules ]] || fail "먼저 pnpm install을 실행해 주세요."
fi
ln -sfn ".env.$stage" .env
printf 'Family Manager · %s · %s\n' "$stage" "$cmd"
case "$cmd" in
    run) exec pnpm dev ;;
    build) exec pnpm build ;;
    deploy) exec docker compose --project-name "family-manager-$stage" --env-file ".env.$stage" -f compose.yaml up --build -d ;;
esac
