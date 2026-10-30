#!/bin/bash
# Renders every composition to out/<id>.mp4, then copies them into the platform's bundled reels.
cd "$(dirname "$0")/.."
for id in "$@"; do
  npx remotion render src/index.ts "$id" "out/$id.mp4" --codec=h264 --crf=20 --concurrency=2 --log=error 2>&1 | grep -v "memory\|Memory\|docker"
  cp "out/$id.mp4" ../platform/src/assets/reels/
  echo "rendered $id"
done
