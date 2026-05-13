#!/bin/bash

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

"$CHROME" --app="http://127.0.0.1:5501/display.html?src=result2" &
sleep 0.8

osascript <<'EOF'
tell application "System Events"
    tell application process "Google Chrome"

        -- 新しく開いたウィンドウを result2 とみなす
        set win2 to front window

        -- 外部ディスプレイ2へ移動
        set position of win2 to {3713, 0}

        delay 1.0

        -- ============================
        -- (1) まず result2 をフルスクリーン
        -- ============================
        try
            tell win2
                set value of attribute "AXFullScreen" to true
            end tell
        end try

        -- ============================
        -- (2) 右側ディスプレイの範囲を 2 回チェック
        -- ============================
        set rightFullScreenState to false

        repeat 2 times
            repeat with w in windows
                try
                    set {xPos, yPos} to position of w

                    if (xPos > 3713 and xPos < 5633) and (yPos > 0 and yPos < 100) then
                        -- いったんフルスクリーン状態を確認
                        set isFull to false
                        try
                            set isFull to (value of attribute "AXFullScreen" of w)
                        end try

                        if isFull is false then
                            -- フルスクリーンではなければ再度フルスクリーン化を試みる
                            try
                                tell w
                                    set value of attribute "AXFullScreen" to true
                                end tell
                                -- フルスクリーン化を試みたのでOKとみなす
                                set rightFullScreenState to true
                            end try
                        else
                            -- すでにフルスクリーンだった場合
                            set rightFullScreenState to true
                        end if
                    end if
                end try
            end repeat

            -- 状態が落ち着くのを少し待つ
            delay 1.0
        end repeat

        -- ============================
        -- (3) 左側ディスプレイにある display1 を探してフルスクリーン
        --     ※右側が一度もフルスクリーンになっていない場合はスキップ
        -- ============================
        if rightFullScreenState is true then
            set leftWin to missing value

            repeat with w in windows
                try
                    set {xPos, yPos} to position of w

                    -- 左ディスプレイの座標範囲（例として x:1792〜3712, y:0〜300）
                    if (xPos > 1792 and xPos < 3712) and (yPos >= 0 and yPos < 300) then
                        set leftWin to w
                        exit repeat
                    end if
                end try
            end repeat

            if leftWin is not missing value then
                try
                    tell leftWin
                        set value of attribute "AXFullScreen" to true
                    end tell
                end try
            end if
        end if

    end tell
end tell
EOF