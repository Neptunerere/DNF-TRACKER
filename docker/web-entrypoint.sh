#!/bin/sh
set -eu

# A restarted container keeps its writable layer. Vinext's previous dev lock can
# therefore outlive the process and incorrectly report that the old PID exists.
rm -rf -- /app/.vinext/dev

exec "$@"
