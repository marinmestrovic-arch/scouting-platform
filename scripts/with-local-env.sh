#!/bin/sh

set -eu

ORIG_DATABASE_URL="${DATABASE_URL-}"
ORIG_DATABASE_URL_TEST="${DATABASE_URL_TEST-}"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -n "${ORIG_DATABASE_URL}" ]; then
  export DATABASE_URL="${ORIG_DATABASE_URL}"
fi

if [ -n "${ORIG_DATABASE_URL_TEST}" ]; then
  export DATABASE_URL_TEST="${ORIG_DATABASE_URL_TEST}"
fi

exec "$@"
