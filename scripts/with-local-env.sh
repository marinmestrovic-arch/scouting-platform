#!/bin/sh

set -eu

exec node scripts/run-with-local-env.mjs "$@"
