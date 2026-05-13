#!/bin/bash

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

"$CHROME" --app="http://127.0.0.1:5501/display.html?src=result1" &
sleep 0.5

osascript <<EOF
tell application "System Events"
    tell application process "Google Chrome"

        -- Chrome ウィンドウが出てくるまで待つ
        repeat while (count windows) = 0
            delay 0.5
        end repeat

        -- 今いちばん前面にあるウィンドウを result1 とみなす
        set win1 to front window

        -- 外部ディスプレイ1へ移動
        set position of win1 to {1800, 0}
    end tell
end tell
EOF