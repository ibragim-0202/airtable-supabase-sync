#!/bin/sh
set -e

# Optionally run one sync immediately on start (handy for a first smoke test),
# then hand off to cron for the scheduled polls.
if [ "$RUN_ON_START" = "true" ]; then
  echo "[entrypoint] RUN_ON_START=true — running one sync now"
  node src/index.js || echo "[entrypoint] start run failed (continuing to cron)"
fi

echo "[entrypoint] starting cron (schedule: /etc/crontabs/root)"
exec crond -f -l 8
