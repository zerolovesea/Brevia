#!/bin/sh
set -eu
[ "$#" = 2 ] && [ "$1" = "___launch___" ] || exit 1
bundle=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd -P)
exec /usr/bin/open -n "$bundle"
