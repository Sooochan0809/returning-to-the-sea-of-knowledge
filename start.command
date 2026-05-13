#!/bin/bash

cd "$(dirname "$0")"

PORT=5501

# ================================
# 0. 既存サーバー & ブラウザタブをクリーンアップ
# ================================
echo "==============================="
echo "0. 既存の 127.0.0.1:${PORT} をクリーンアップします"
echo "==============================="

# --- .pids ベースでサーバープロセスを停止 ---
if [[ -f .pids ]]; then
  echo "🛑 .pids に記録されたサーバープロセスを停止中..."
  xargs kill 2>/dev/null <.pids || true
  rm -f .pids
  echo "✅ .pids に基づくサーバープロセスを停止しました。"
else
  echo "ℹ️ .pids は見つかりませんでした。"
fi

# --- 念のためポートベースでも停止 ---
PIDS_FROM_PORT=$(lsof -ti :$PORT 2>/dev/null || true)
if [[ -n "$PIDS_FROM_PORT" ]]; then
  echo "🛑 ポート ${PORT} を使用中のプロセスを停止します: $PIDS_FROM_PORT"
  kill $PIDS_FROM_PORT 2>/dev/null || true
  sleep 2

  # まだ生きていたら強制終了
  if lsof -i :$PORT >/dev/null 2>&1; then
    echo "⚠️ まだポート ${PORT} が使われているため、強制終了します..."
    kill -9 $PIDS_FROM_PORT 2>/dev/null || true
  fi
else
  echo "ℹ️ ポート ${PORT} を使用しているプロセスは見つかりませんでした。"
fi

# --- ブラウザタブを閉じる（Google Chrome） ---
echo "🌐 開いているブラウザタブ (http://127.0.0.1:${PORT}) を閉じます..."

for n in {1..3}; do
  osascript <<'APPLESCRIPT' 2>/dev/null
tell application "Google Chrome"
  if (count of windows) is 0 then return

  repeat with w in windows
    set tabCount to (count of tabs of w)
    repeat with i from tabCount to 1 by -1
      set t to tab i of w
      set u to URL of t

      -- 対象タブ判定
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

echo "✅ タブのクローズ処理が完了しました。"

sleep 2

# ================================
# 1. ディスプレイ配置を先に固定
# ================================
echo "▶️ ディスプレイ配置を設定します..."

# displayplacer が入っているかチェック
if ! command -v displayplacer >/dev/null 2>&1; then
  echo "❌ displayplacer コマンドが見つかりません。"
  echo "   brew install displayplacer などでインストールしてください。"
  exit 1
fi

# 今のレイアウトに戻すコマンド
displayplacer \
  "id:182B564E-58A6-FAA7-442A-D15BF05FBA32 res:1792x1120 hz:59 color_depth:4 enabled:true scaling:on origin:(0,0) degree:0" \
  "id:00002163-0000-2792-0000-000100000000 res:1920x1080 hz:60 color_depth:4 enabled:true scaling:off origin:(3712,0) degree:0" \
  "id:000009D1-0000-6F03-0000-070A00000000 res:1920x1080 hz:60 color_depth:4 enabled:true scaling:off origin:(1792,0) degree:0"

# displayplacer が失敗したら後続は実行しない
if [ $? -ne 0 ]; then
  echo "❌ ディスプレイの設定に失敗しました。"
  echo "   ディスプレイが接続されているか確認してください。"
  exit 1
fi

# ★★★ 新しく追加した処理と元の処理の間の 3 秒待機 ★★★
echo "⏳ ディスプレイ設定反映のため 3 秒待機します..."
sleep 3

# ================================
# 2. ここから元の処理
# ================================
echo "▶️ run.command を起動します..."
chmod +x ./run.command
./run.command &
sleep 3

echo "▶️ open_display1.command を起動します..."
chmod +x ./open_display1.command
./open_display1.command
sleep 1

echo "▶️ open_display2.command を起動します..."
chmod +x ./open_display2.command
./open_display2.command
sleep 0

echo "起動完了"