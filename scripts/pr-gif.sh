#!/usr/bin/env bash
# Turns a CI recording of the end-to-end tests into a pull request's GIF, showing the screens it
# changed. CI films every test (apps/web/playwright.config.ts) against the emulators with demo data,
# and uploads the videos per device as `e2e-videos-<device>`. Never record the live app: it shows the
# household's real entries, and pull requests are public.
#
#   scripts/pr-gif.sh fetch <run-id> <device> <dir>            download the run's videos for a device
#   scripts/pr-gif.sh sheet <video.webm> <sheet.png>           a contact sheet to find the moments:
#                                                              SHEET_FPS frames a second (default 4),
#                                                              six a row, left to right, top to bottom
#   scripts/pr-gif.sh gif <video.webm> <from> <to> <out.gif>   cut seconds <from>..<to> into a GIF;
#                                                              SPEED=0.5 plays it at half speed
#
# Then attach it: gh pr edit <pr> --attach '<out.gif>#<what it shows>' (gh 2.99 or newer).
set -euo pipefail

GH=${GH:-gh}
MAX_BYTES=$((10 * 1024 * 1024))

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 2
}

case "${1:-}" in
  fetch)
    [ $# -eq 4 ] || usage
    run=$2 device=$3 dir=$4
    "$GH" run download "$run" --repo Flixbox/household-brain --name "e2e-videos-$device" --dir "$dir"
    find "$dir" -name '*.webm' | sort
    ;;
  sheet)
    [ $# -eq 3 ] || usage
    video=$2 sheet=$3 fps=${SHEET_FPS:-4}
    duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
    rows=$(awk -v d="$duration" -v f="$fps" 'BEGIN { n = int(d * f) + 1; print int((n + 5) / 6) }')
    ffmpeg -loglevel error -y -i "$video" -vf "fps=$fps,scale=240:-1,tile=6x$rows" -frames:v 1 "$sheet"
    echo "$sheet: tile n is second n/$fps"
    ;;
  gif)
    [ $# -eq 5 ] || usage
    video=$2 from=$3 to=$4 out=$5 speed=${SPEED:-1}
    # One palette made from the clip itself keeps the colours right at a small size.
    ffmpeg -loglevel error -y -ss "$from" -to "$to" -i "$video" \
      -vf "setpts=PTS/$speed,fps=10,scale='min(800,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" \
      -loop 0 "$out"
    size=$(stat -c %s "$out")
    if [ "$size" -gt "$MAX_BYTES" ]; then
      echo "::error::$out is $size bytes; GitHub takes 10 MB at most. Cut a shorter stretch." >&2
      exit 1
    fi
    echo "$out ($size bytes)"
    ;;
  *)
    usage
    ;;
esac
