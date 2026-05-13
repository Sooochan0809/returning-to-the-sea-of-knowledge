#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")"

PORT=5501
HOST=127.0.0.1
LOGDIR="./logs"
mkdir -p "$LOGDIR"

# --- 前回の残りプロセスを終了 ---
if [[ -f .pids ]]; then
  echo "🔸 前回のプロセスを終了します..."
  xargs kill 2>/dev/null < .pids || true
  rm -f .pids
fi

# --- http-server がなければインストール ---
if [[ ! -d node_modules/http-server ]]; then
  echo "📦 http-server をインストール中..."
  npm install -D http-server
fi

# --- server.js をバックグラウンドで起動 ---
echo "🚀 server.js を起動します..."
nohup node server.js > "$LOGDIR/api.log" 2>&1 &
API_PID=$!

# --- index.html（静的配信）を起動 ---
echo "🌐 静的サーバーを起動します (http://${HOST}:${PORT}) ..."
nohup node node_modules/http-server/bin/http-server \
  -p "$PORT" -a "$HOST" -c-1 . > "$LOGDIR/static.log" 2>&1 &
WEB_PID=$!

# --- PIDを保存（stop用） ---
echo "$API_PID" "$WEB_PID" > .pids

# --- Chromeでブラウザを自動オープン ---
CHROME=""
if command -v google-chrome >/dev/null 2>&1; then
  CHROME="google-chrome"
elif command -v "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >/dev/null 2>&1; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v chrome >/dev/null 2>&1; then
  CHROME="chrome"
fi

URL="http://${HOST}:${PORT}/"

if [[ -n "$CHROME" ]]; then
  echo "🌎 Chromeで自動オープンします: $URL"
  "$CHROME" "$URL" >/dev/null 2>&1 &
else
  echo "⚠️  Chromeが見つかりません。通常の open で開きます。"
  open "$URL"
fi

echo "  API PID: $API_PID"
echo "  Web PID: $WEB_PID"
echo "  → http://${HOST}:${PORT}/"
echo "  ログ: $LOGDIR/"