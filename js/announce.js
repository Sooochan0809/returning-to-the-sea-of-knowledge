// HTMLに無いUIは勝手に作らない
const REQUIRE_HTML_UI = true;

// ====== ユーティリティ ======
function $(id) { return document.getElementById(id); }

// ==== グローバル初期化 ====
window.detectedCoords = window.detectedCoords || [];
window.__gardenGridHistory = window.__gardenGridHistory || [];
// アナウンスとアナウンスの間で溜めるバッファ
window.__gardenGridBuffer = window.__gardenGridBuffer || [];
window.selectedAudioOutputDeviceId = window.selectedAudioOutputDeviceId || "";
// オーディオデバイス一覧をログしたかどうか
window.__loggedAudioOutputsOnce = window.__loggedAudioOutputsOnce || false;

// ============================================================
//  BGM 関係
// ============================================================
window.__bgmAudio = window.__bgmAudio || null;
window.__bgmFadeTimer = window.__bgmFadeTimer || null;
window.__bgmVolumeTarget =
    typeof window.__bgmVolumeTarget === "number" ? window.__bgmVolumeTarget : 0.38;
window.__bgmFadeStep =
    typeof window.__bgmFadeStep === "number" ? window.__bgmFadeStep : 0.04;
window.__bgmFadeInterval =
    typeof window.__bgmFadeInterval === "number" ? window.__bgmFadeInterval : 60;

function ensureBGMPlaying(fadeIn = true) {
    if (!window.__bgmAudio) {
        const audio = new Audio("sound/lounge-jazz-elevator-music-324902.mp3");
        audio.loop = true;
        audio.crossOrigin = "anonymous";
        audio.volume = 0;
        window.__bgmAudio = audio;

        if (
            typeof audio.setSinkId === "function" &&
            window.selectedAudioOutputDeviceId
        ) {
            audio.setSinkId(window.selectedAudioOutputDeviceId).catch(() => { });
        }
    }
    const audio = window.__bgmAudio;
    if (audio.paused) {
        audio.volume = 0;
        audio.play().catch(() => { });
    }
    fadeBGMTo(window.__bgmVolumeTarget, fadeIn);
}

function fadeBGMTo(targetVolume, fade = true) {
    const audio = window.__bgmAudio;
    if (!audio) return;
    if (window.__bgmFadeTimer) clearInterval(window.__bgmFadeTimer);
    if (!fade) {
        audio.volume = targetVolume;
        return;
    }
    window.__bgmFadeTimer = setInterval(() => {
        if (!window.__bgmAudio) {
            clearInterval(window.__bgmFadeTimer);
            return;
        }
        const diff = targetVolume - audio.volume;
        if (Math.abs(diff) <= window.__bgmFadeStep) {
            audio.volume = targetVolume;
            clearInterval(window.__bgmFadeTimer);
            window.__bgmFadeTimer = null;
            if (targetVolume === 0) audio.pause();
        } else {
            audio.volume += (diff > 0 ? 1 : -1) * window.__bgmFadeStep;
            if (audio.volume < 0) audio.volume = 0;
            if (audio.volume > 1) audio.volume = 1;
        }
    }, window.__bgmFadeInterval);
}

function fadeOutBGM() {
    fadeBGMTo(0, true);
}

// ============================================================
//  TTS
// ============================================================
async function speakViaOpenAITTS(
    text,
    { voice = "alloy", format = "mp3" } = {}
) {
    fadeOutBGM();
    let resp;
    try {
        resp = await fetch("http://127.0.0.1:3001/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice, format }),
        });
    } catch (error) {
        throw new Error(`TTS API fetch error: ${error.message || error}`);
    }

    if (!resp.ok) throw new Error(`TTS API error ${resp.status}`);

    let arr;
    try {
        arr = await resp.arrayBuffer();
    } catch (error) {
        throw new Error(`TTS API arrayBuffer error: ${error.message || error}`);
    }

    const mime =
        format === "wav"
            ? "audio/wav"
            : format === "opus"
                ? "audio/ogg"
                : "audio/mpeg";
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);

    const audio = new Audio();
    audio.src = url;
    try {
        if (
            typeof audio.setSinkId === "function" &&
            window.selectedAudioOutputDeviceId
        ) {
            await audio.setSinkId(window.selectedAudioOutputDeviceId);
            if (
                window.__bgmAudio &&
                typeof window.__bgmAudio.setSinkId === "function"
            ) {
                await window.__bgmAudio.setSinkId(window.selectedAudioOutputDeviceId);
            }
        }
    } catch (e) {
        console.warn("setSinkId failed:", e);
    }

    try {
        await audio.play();
    } catch (e) {
        URL.revokeObjectURL(url);
        throw new Error("TTS audio playback error: " + (e.message || e));
    }

    audio.onended = () => {
        URL.revokeObjectURL(url);
        setTimeout(() => {
            ensureBGMPlaying(true);
        }, 550);
    };
    if (window.__bgmAudio) {
        window.__bgmAudio.pause();
        window.__bgmAudio.volume = 0;
    }
}

// ============================================================
//  時刻文字列ユーティリティ（TTS用）
// ============================================================
function numberToKanjiReading(n) {
    const yomi0_9 = [
        "れい", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう",
    ];
    const tens = Math.floor(n / 10),
        ones = n % 10;
    if (n < 10) return yomi0_9[n];
    if (n < 20) return (tens === 1 ? "じゅう" : "") + (ones ? yomi0_9[ones] : "");
    if (n < 100)
        return (
            (tens ? yomi0_9[tens] + "じゅう" : "") + (ones ? yomi0_9[ones] : "")
        );
    return String(n);
}

function dayToWago(d) {
    const map = {
        1: "ついたち", 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか", 9: "ここのか", 10: "とおか", 11: "じゅういちにち", 12: "じゅうににち", 13: "じゅうさんにち", 14: "じゅうよっか", 15: "じゅうごにち", 16: "じゅうろくにち", 17: "じゅうしちにち", 18: "じゅうはちにち", 19: "じゅうくにち", 20: "はつか", 21: "にじゅういちにち", 22: "にじゅうににち", 23: "にじゅうさんにち", 24: "にじゅうよっか", 25: "にじゅうごにち", 26: "にじゅうろくにち", 27: "にじゅうしちにち", 28: "にじゅうはちにち", 29: "にじゅうくにち", 30: "さんじゅうにち", 31: "さんじゅういちにち"
    };
    return map[d] || numberToKanjiReading(d) + "にち";
}

function hourToReading(h) {
    if (h === 0) return "れいじ";
    return numberToKanjiReading(h) + "じ";
}

function minuteToReading(m) {
    const irregular = {
        0: "れいふん", 1: "いっぷん", 2: "にふん", 3: "さんぷん", 4: "よんふん", 5: "ごふん", 6: "ろっぷん", 7: "ななふん", 8: "はっぷん", 9: "きゅうふん",
    };
    if (m < 10) return irregular[m];
    const tens = Math.floor(m / 10),
        ones = m % 10;
    const tensPart =
        tens === 1 ? "じゅう" : numberToKanjiReading(tens) + "じゅう";
    if (ones === 0) return tensPart + "ぷん";
    return tensPart + (irregular[ones] || numberToKanjiReading(ones) + "ふん");
}

function getCurrentTimeStringsForTTS(now = new Date()) {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const ttsKana =
        `${numberToKanjiReading(y)}ねん、${numberToKanjiReading(m)}がつ、` +
        `${dayToWago(d)}、${hourToReading(hh)}、${minuteToReading(mm)}`;
    const display =
        `${y}年${String(m).padStart(2, "0")}月${String(d).padStart(2, "0")}日 ` +
        `${String(hh).padStart(2, "0")}時${String(mm).padStart(2, "0")}分`;
    return { display, ttsKana };
}

// ============================================================
//  OpenAI Chat 呼び出し共通処理
// ============================================================
function playLocalFallbackAudio() {
    try {
        const audio = new window.Audio("sound/announce-err.mp3");
        audio.volume = 1.0;

        if (
            typeof audio.setSinkId === "function" &&
            window.selectedAudioOutputDeviceId
        ) {
            audio.setSinkId(window.selectedAudioOutputDeviceId)
                .catch(e => console.warn("fallback setSinkId failed:", e));
        }

        audio.play().catch(e => {
            console.warn("fallback play error:", e);
        });
    } catch (e) {
        console.error("fallback audio error:", e);
    }
}


async function callOpenAIChat(promptText, callback) {
    try {
        // プレースホルダ表示（しゃべらない）
        callback("アナウンス文を考え中です...", null, { noSpeak: true });

        const response = await fetch("http://127.0.0.1:3001/api/announce", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: promptText }),
        });

        if (!response.ok) {
            callback(
                `Proxy/APIエラー: ${response.status} ${response.statusText}`,
                null,
                { noSpeak: true }
            );
            playLocalFallbackAudio();
            return;
        }

        const data = await response.json().catch(() => null);
        const botReply =
            data?.choices?.[0]?.message?.content ??
            "[AIからの応答が取得できませんでした]";
        const usage = data?.usage || null;

        callback(botReply.trim(), usage);
    } catch (err) {
        console.error(err);
        callback(
            "API呼び出しでエラー: " + (err.message || err),
            null,
            { noSpeak: true }
        );
        playLocalFallbackAudio();
    }
}

// ============================================================
//  アナウンスのメイン（judge.js のコンテキストを使う）
// ============================================================
function announceGardenStateFromContext(
    context,
    history,
    setOutputText,
    doSpeak
) {
    const { latestGrid, usedGrids, usedCount, finalState, rawState, judge, at } =
        context;

    const stateForPrompt = finalState ? `「${finalState}」` : finalState;

    // history には最新だけ保存（もともとの仕様を踏襲）
    if (Array.isArray(history) && latestGrid) {
        history.splice(0, history.length, latestGrid.map((r) => r.slice()));
    }

    // デバッグ用
    window.__latestGardenAnnounceContext = {
        usedCount,
        usedGrids,
        latestGrid,
        at: at || new Date().toISOString(),
    };

    const { ttsKana } = getCurrentTimeStringsForTTS();
    const timeStrForTTS = ttsKana;

    const prompt = `あなたは「庭生成気象予報士」です。
# 命令
- 冒頭に「${timeStrForTTS}、庭生成状況をお知らせします。」と入れてください。
- そのあと3〜4文で、停滞・偏り・密度の様子を話し言葉で説明してください。
- **最後は必ず「状態は「優」でしょう。」のように、
  「優」「良好」「注意」「あく」「危険」のいずれかを
  全角のカギ括弧「」で囲んで
  「状態は「◯◯」でしょう。」という一文で締めてください。**

# 庭の情報
状態（公開用）: **${stateForPrompt}**
今回使ったデータ枚数: ${usedCount}
最新の密度データ: ${JSON.stringify(latestGrid)}

# メモ
- 停滞や循環不足が見られた場合は、それを強調してください。`;

    callOpenAIChat(
        prompt,
        async (generatedText, usageInfo, options = {}) => {
            setOutputText(generatedText, usageInfo);

            // メタ情報の描画（実装は judge.js 内の renderGardenAnnounceMeta）
            if (typeof window.renderGardenAnnounceMeta === "function") {
                window.renderGardenAnnounceMeta({
                    judge,
                    rawState,
                    finalState,
                    usedCount,
                    thresholds: window.gardenThresholds,
                    prevState: window.__gardenStateLast || null,
                    atISO: at || new Date().toISOString(),
                });
            }

            // グリッド可視化（実装は judge.js 内の drawDensityGrid）
            if (latestGrid && typeof window.drawDensityGrid === "function") {
                window.drawDensityGrid(latestGrid, "garden-announce-grid-visual", {
                    ...judge,
                    state: finalState,
                });
            }

            if (doSpeak && !(options && options.noSpeak)) {
                try {
                    await speakViaOpenAITTS(generatedText, {
                        voice: window.gardenTtsVoice || "alloy",
                        format: window.gardenTtsFormat || "mp3",
                    });
                } catch (e) {
                    console.error("[TTS再生エラー] fallback:", e);
                    playLocalFallbackAudio();
                    fadeOutBGM();
                }
            } else {
                ensureBGMPlaying(true);
            }

            // アナウンス後、バッファをクリア
            if (window.__gardenGridBuffer) {
                window.__gardenGridBuffer.length = 0;
            }
        }
    );
}

window.announceGardenStateFromContext = announceGardenStateFromContext;

// ============================================================
//  出力デバイスUI
// ============================================================

// 無視したいデバイスID（完全一致）
const IGNORED_DEVICE_IDS = [
    "default", "b69f06c794844c940dcdc33d7e212b0f547b67e72c92d54078de552a039055f6","1ae193a0517dc71d408516cba6959886f8e2ef139962b434d387277ff2cfdd35","3a7adb0a4cbe21794201025536d036be212860da5a071efd25e0bb80b85f856a","825e5c0c79ca9237b0e58424afc190277985fdce8b9fc99b9503cd9ca7258e11","19127fcd7a41ca60916866685b9cc3fafdfc4bb5b9622bc23b2c0b822acfd10e"
];

// 無視したいデバイスラベル（部分一致キーワード・小文字で書く）
const IGNORED_DEVICE_LABEL_KEYWORDS = [
    // 例: "airplay", "display audio"
    "Default - Collagepoetry(1-2) (Aggregate)","UMC204HD 192k (1397:0508)","MacBook Pro Speakers (Built-in)","Microsoft Teams Audio Device (Virtual)","ZoomAudioDevice (Virtual)","Collagepoetry(1-2) (Aggregate)"
];

function isIgnoredDevice(d) {
    if (!d) return false;

    // deviceId 完全一致
    if (IGNORED_DEVICE_IDS.includes(d.deviceId)) return true;

    // ラベルにキーワードが含まれていたら無視
    const lbl = normalizeLabel(d.label || "");
    if (!lbl) return false;
    return IGNORED_DEVICE_LABEL_KEYWORDS.some((kw) =>
        lbl.includes(kw.toLowerCase())
    );
}

const LS_KEY_PREFERRED_OUTPUT_LABEL = "garden_preferred_audio_output_label";
const LS_KEY_PREFERRED_OUTPUT_FALLBACK_ID =
    "garden_preferred_audio_output_id";
const PREFERRED_LABEL_HINTS = ["Announce(1-2)", "Announce", "(1-2)"];
let __askedAudioOnce = false;

function normalizeLabel(raw) {
    if (!raw) return "";
    let s = raw;
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
    s = s.replace(/[（）]/g, (m) => (m === "（" ? "(" : ")"));
    s = s.replace(/^(既定|通信|default|communications)\s*[-‐—–]\s*/i, "");
    s = s.trim().replace(/\s+/g, " ");
    return s.toLowerCase();
}
function isPseudoDefaultDevice(d) {
    const id = d.deviceId;
    const lblN = normalizeLabel(d.label || "");
    return (
        id === "default" ||
        id === "communications" ||
        lblN.startsWith("default") ||
        lblN.startsWith("communications") ||
        lblN.startsWith("既定") ||
        lblN.startsWith("通信")
    );
}
function savePreferredOutput(label, deviceId) {
    try {
        if (label && label.trim())
            localStorage.setItem(LS_KEY_PREFERRED_OUTPUT_LABEL, label.trim());
        if (deviceId)
            localStorage.setItem(LS_KEY_PREFERRED_OUTPUT_FALLBACK_ID, deviceId);
    } catch { }
}
function loadPreferredOutputLabel() {
    try {
        return localStorage.getItem(LS_KEY_PREFERRED_OUTPUT_LABEL) || "";
    } catch {
        return "";
    }
}
function loadPreferredFallbackId() {
    try {
        return localStorage.getItem(LS_KEY_PREFERRED_OUTPUT_FALLBACK_ID) || "";
    } catch {
        return "";
    }
}
function getSelectedOptionLabel(selectEl) {
    if (!selectEl) return "";
    const opt =
        selectEl.selectedOptions && selectEl.selectedOptions[0];
    return opt ? (opt.textContent || "").trim() : "";
}
function resolveDeviceId(outputs) {
    const real = outputs.filter((d) => !isPseudoDefaultDevice(d));
    if (real.length === 0) return "";
    const savedRaw = loadPreferredOutputLabel().trim();
    const savedN = normalizeLabel(savedRaw);
    if (savedN) {
        let hit = real.find(
            (d) => normalizeLabel(d.label) === savedN
        );
        if (hit) return hit.deviceId;
        hit = real.find((d) =>
            normalizeLabel(d.label).startsWith(savedN)
        );
        if (hit) return hit.deviceId;
        hit = real.find((d) =>
            normalizeLabel(d.label).includes(savedN)
        );
        if (hit) return hit.deviceId;
    }
    for (const hint of PREFERRED_LABEL_HINTS) {
        const h = normalizeLabel(hint);
        let hit = real.find((d) => normalizeLabel(d.label) === h);
        if (hit) return hit.deviceId;
        hit = real.find((d) =>
            normalizeLabel(d.label).startsWith(h)
        );
        if (hit) return hit.deviceId;
        hit = real.find((d) =>
            normalizeLabel(d.label).includes(h)
        );
        if (hit) return hit.deviceId;
    }
    return real[0]?.deviceId || "";
}

async function populateAudioOutputs(selectEl) {
    if (!navigator.mediaDevices?.enumerateDevices) {
        if (selectEl) {
            selectEl.disabled = true;
            selectEl.innerHTML = `<option>音声デバイス取得不可</option>`;
        }
        return;
    }

    if (!__askedAudioOnce) {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch { }
        __askedAudioOnce = true;
    }

    let devices = [];
    try {
        devices = await navigator.mediaDevices.enumerateDevices();
    } catch { }

    // ① 生の audiooutput 一覧
    const allOutputs = devices.filter((d) => d.kind === "audiooutput");

    // ② 無視設定を反映した一覧（UIに出す用）
    const outputs = allOutputs.filter((d) => !isIgnoredDevice(d));

    // ③ 初回だけコンソールに一覧を出す
    if (!window.__loggedAudioOutputsOnce) {
        console.group("[AudioOutput] detected audiooutput devices");
        allOutputs.forEach((d) => {
            console.log({
                label: d.label || "(no label)",
                deviceId: d.deviceId,
                kind: d.kind,
                ignoredByRule: isIgnoredDevice(d),
                pseudoDefault: isPseudoDefaultDevice(d),
            });
        });
        console.groupEnd();
        window.__loggedAudioOutputsOnce = true;
    }

    if (!selectEl) return;

    const frag = document.createDocumentFragment();
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "（デフォルト）";

    outputs.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent =
            d.label || `出力デバイス(${d.deviceId?.slice(0, 6) || "??"})`;
        frag.appendChild(opt);
    });

    selectEl.innerHTML = "";
    selectEl.appendChild(frag);

    const optionsSet = new Set(
        Array.from(selectEl.options).map((o) => o.value)
    );
    let targetId = "";
    if (
        window.selectedAudioOutputDeviceId &&
        optionsSet.has(window.selectedAudioOutputDeviceId)
    ) {
        targetId = window.selectedAudioOutputDeviceId;
    } else {
        const resolved = resolveDeviceId(outputs);
        const legacy = loadPreferredFallbackId();
        targetId = resolved || (optionsSet.has(legacy) ? legacy : "");
        if (!optionsSet.has(targetId)) targetId = "";
        if (targetId === "default" || targetId === "communications")
            targetId = "";
    }
    if (!targetId) {
        const firstReal = outputs.find(
            (d) => !isPseudoDefaultDevice(d)
        );
        if (firstReal) targetId = firstReal.deviceId;
    }
    selectEl.value = targetId || "";

    window.selectedAudioOutputDeviceId = selectEl.value || "";
    if (window.__bgmAudio && typeof window.__bgmAudio.setSinkId === "function") {
        try {
            await window.__bgmAudio.setSinkId(
                window.selectedAudioOutputDeviceId
            );
        } catch { }
    }
    if (selectEl.value) {
        const label = getSelectedOptionLabel(selectEl);
        if (
            !isPseudoDefaultDevice({
                deviceId: selectEl.value,
                label,
            })
        ) {
            savePreferredOutput(label, selectEl.value);
        }
    }
}

function createAudioOutputDeviceSelector(
    containerId = "garden-audio-device-selector"
) {
    const container = document.getElementById(containerId);
    if (!container) {
        if (REQUIRE_HTML_UI)
            console.debug(
                `[UI] ${containerId} が無いのでUIは作りません`
            );
        return;
    }
    const select = container.querySelector("#garden-audio-sink-select");
    const pickBtn = container.querySelector("#garden-pick-device");
    const refreshBtn = container.querySelector("#garden-refresh-device");
    const voiceSel = container.querySelector("#garden-tts-voice");
    const fmtSel = container.querySelector("#garden-tts-format");

    if (select) {
        populateAudioOutputs(select).then(() => {
            window.selectedAudioOutputDeviceId = select.value || "";
            if (window.__bgmAudio?.setSinkId) {
                window.__bgmAudio
                    .setSinkId(window.selectedAudioOutputDeviceId)
                    .catch(() => { });
            }
        });
        select.onchange = () => {
            window.selectedAudioOutputDeviceId = select.value || "";
            const label = getSelectedOptionLabel(select);
            if (
                select.value &&
                label &&
                !isPseudoDefaultDevice({
                    deviceId: select.value,
                    label,
                })
            ) {
                savePreferredOutput(label, select.value);
            }
            if (window.__bgmAudio?.setSinkId) {
                window.__bgmAudio
                    .setSinkId(window.selectedAudioOutputDeviceId)
                    .catch(() => { });
            }
        };
    }

    if (pickBtn) {
        pickBtn.onclick = async () => {
            try {
                if (navigator.mediaDevices?.selectAudioOutput) {
                    const dev = await navigator.mediaDevices.selectAudioOutput();
                    window.selectedAudioOutputDeviceId = dev?.deviceId || "";
                }
                if (select) await populateAudioOutputs(select);
            } catch (e) {
                alert("スピーカー選択に失敗しました。");
            }
        };
    }
    if (refreshBtn) {
        refreshBtn.onclick = async () => {
            if (select) await populateAudioOutputs(select);
        };
    }
    if (voiceSel) voiceSel.onchange = () => (window.gardenTtsVoice = voiceSel.value);
    if (fmtSel) fmtSel.onchange = () => (window.gardenTtsFormat = fmtSel.value);
}

// ============================================================
//  UI / 手動アナウンス
// ============================================================
function setAnnounceOutputText(text, info) {
    const out = $("garden-announce-output");
    if (out) out.textContent = text;
    const tok = $("garden-announce-usage-info");
    if (tok && info && typeof info === "object" && "total_tokens" in info) {
        tok.innerHTML = `GPT使用量: prompt=${info.prompt_tokens ?? "?"} / completion=${info.completion_tokens ?? "?"} / total=${info.total_tokens ?? "?"}`;
    }
}
window.setAnnounceOutputText = setAnnounceOutputText;

// 「今のグリッドで1回アナウンスする」ための入口（手動ボタン用）
function announceFromCurrentGrid() {
    const ctx = window.currentGardenJudgeContext;
    if (!ctx || !ctx.latestGrid) {
        // まだ判定が一度も走っていない
        fadeOutBGM();
        return;
    }
    const hist = window.__gardenGridHistory;
    announceGardenStateFromContext(ctx, hist, setAnnounceOutputText, true);
}
window.announceFromCurrentGrid = announceFromCurrentGrid;

// 初期化
document.addEventListener("DOMContentLoaded", function () {
    if ($("garden-audio-device-selector")) {
        createAudioOutputDeviceSelector();
    }
    // grid が動いていればBGMを起動しておく（アナウンスは colordetection 側で制御）
    if ($("garden-announce-output") && window.gridDensities && window.gridDensities.length) {
        ensureBGMPlaying(true);
    }

    // しきい値UI（実体は judge.js 側の window.gardenThresholds）
    const a = $("th-akku");
    const k = $("th-kiken");
    if (a) a.oninput = (e) =>
    (window.gardenThresholds.minGridsForAkkuFromChui =
        +e.target.value || 1);
    if (k) k.oninput = (e) =>
    (window.gardenThresholds.minGridsForKikenFromAkku =
        +e.target.value || 1);
});

// ====== 今回の参照情報を取る関数 ======
window.getLatestGardenAnnounceContext = function () {
    return window.__latestGardenAnnounceContext
        ? JSON.parse(JSON.stringify(window.__latestGardenAnnounceContext))
        : { usedCount: 0, usedGrids: [], latestGrid: null, at: null };
};