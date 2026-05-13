#!/bin/bash

cd "$(dirname "$0")"

# --- サーバープロセスを停止 ---
if [[ -f .pids ]]; then
  echo "🛑 サーバープロセスを停止中..."
  xargs kill 2>/dev/null < .pids || true
  rm -f .pids
  echo "✅ サーバープロセスを停止しました。"
else
  echo "ℹ️ サーバープロセスは見つかりません (.pidsなし)。"
fi

# --- ブラウザタブを閉じる×3 ---
echo "🌐 開いているブラウザタブ(127.0.0.1:5501)を閉じます..."

for i in {1..3}
do
osascript <<'APPLESCRIPT' 2>/dev/null
tell application "Google Chrome"
  if (count of windows) is 0 then return

  repeat with w in windows
    set tabCount to (count of tabs of w)
    repeat with i from tabCount to 1 by -1
      set t to tab i of w
      set u to URL of t

      -- ★ここで対象タブを判定
      if u starts with "http://127.0.0.1:5501" then
        try
          close t
        end try
      end if
    end repeat
  end repeat
end tell
APPLESCRIPT
done