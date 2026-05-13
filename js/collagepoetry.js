const bunsetsuCountInput = document.getElementById('bunsetsu-count');
const setBunsetsuBtn = document.getElementById('set-bunsetsu-btn');
const collageResult = document.getElementById('collage-result');
const voicesDebugEl = document.getElementById('voices-debug');

// ===== Collage用 audio 要素と各種入力 =====
const collageAudio = document.getElementById('collage-audio');
const collageIntervalInput = document.getElementById('collage-auto-interval-seconds');
const collageGapInput = document.getElementById('collage-gap-seconds');

const judgeStateDebugEl = document.getElementById('collage-judge-debug');

// 現在の判定を DOM にだけ反映
function updateCollageJudgeDebug(judge) {
    if (!judgeStateDebugEl) return;

    if (!judge) {
        judgeStateDebugEl.textContent = '判定: (なし)';
        judgeStateDebugEl.dataset.state = '';
        judgeStateDebugEl.dataset.from = '';
        return;
    }

    const { state, from, ...rest } = judge;

    judgeStateDebugEl.textContent =
        `判定: ${state ?? '(不明)'} / source: ${from ?? '-'} / details: ${JSON.stringify(rest)}`;

    // 必要なら HTML 側から参照しやすいように data-* だけ付けておく
    judgeStateDebugEl.dataset.state = state || '';
    judgeStateDebugEl.dataset.from = from || '';
}

// =====================================
// 再生間隔系ユーティリティ
// =====================================
function getCollageGapMS() {
    if (!collageGapInput) return 1000; // デフォルト 1秒
    const v = parseFloat(collageGapInput.value);
    if (isNaN(v) || v < 0) return 1000;
    return v * 1000;
}

function getCollageAutoIntervalMS() {
    if (!collageIntervalInput) return 5000;
    const v = parseFloat(collageIntervalInput.value);
    if (isNaN(v) || v < 1) return 5000;
    return v * 1000;
}

function updateVoicesDebug(contentHtml, { ok = true } = {}) {
    if (!voicesDebugEl) return;

    voicesDebugEl.innerHTML = contentHtml;
    voicesDebugEl.style.background = "rgba(0, 0, 0, 0.2)";
}

// =====================================
// announce.js の判定を読む
// =====================================
function getAnnounceFinalState() {
    if (typeof window.__gardenStateLast === 'string' && window.__gardenStateLast) {
        // "優" / "良好" / "注意" / "あく" / "危険"
        return window.__gardenStateLast;
    }

    // 念のため context も見る（announce.js の末尾で追加している想定）
    if (typeof window.getLatestGardenAnnounceContext === 'function') {
        const ctx = window.getLatestGardenAnnounceContext();
        if (ctx && ctx.finalState) {
            return ctx.finalState;
        }
    }

    return null;
}

// =====================================
// 文節ごとの音声リスト管理
// =====================================
let bunsetsuData = [];

// ===== 共通ボイスセットの読み込み =====
const COMMON_VOICE_DIR = 'voices';
let sharedVoiceListCache = null;

async function fetchSharedWavList() {
    if (sharedVoiceListCache) return sharedVoiceListCache;

    // 汎用: dir を受け取って files を返すヘルパー
    async function fetchWavListFromDir(dir) {
        // 1) dir/list.json を見る
        try {
            const res = await fetch(`${dir}/list.json`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.files)) {
                    return data.files
                        .filter(name => name.endsWith('.wav'))
                        .map(name => ({
                            file: null,
                            url: `${dir}/${name}`,
                            name,
                        }));
                }
            }
        } catch {
            // list.json が無い場合などは次へ
        }

        // 2) list.php?dir=... を見る
        try {
            const res = await fetch(`list.php?dir=${encodeURIComponent(dir)}`);
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data.files)) return [];

            return data.files
                .filter(name => name.endsWith('.wav'))
                .map(name => ({
                    file: null,
                    url: `${dir}/${name}`,
                    name,
                }));
        } catch {
            return [];
        }
    }

    sharedVoiceListCache = await fetchWavListFromDir(COMMON_VOICE_DIR);

    //ページ内に結果を表示
    if (sharedVoiceListCache.length === 0) {
        updateVoicesDebug(
            `<div><strong>音声ファイルの一覧取得に失敗しました。</strong><br>
          ディレクトリ <code>${COMMON_VOICE_DIR}</code> に .wav が見つかりません。</div>`,
            { ok: false }
        );
    } else {
        const filesHtml = sharedVoiceListCache
            .map(v => `<li>${v.name}</li>`)
            .join('');

        updateVoicesDebug(
            `<div><strong>音声ファイル一覧読み込み 完了 ✅</strong><br>
          総数: ${sharedVoiceListCache.length} 件</div>
         <details style="margin-top:4px;">
           <summary>ファイル名一覧を表示</summary>
           <ul style="margin:4px 0 0 1em;">${filesHtml}</ul>
         </details>`,
            { ok: true }
        );
    }

    return sharedVoiceListCache;
}

// =====================================
// すべての wav に実際にアクセスできるか確認する
// =====================================
async function verifyAllVoicesReachable() {
    // まず一覧（ファイル名）を取得
    const list = await fetchSharedWavList();

    if (!list.length) {
        updateVoicesDebug(
            `<div><strong>音声ファイルが1件も取得できませんでした。</strong><br>
             ディレクトリ <code>${COMMON_VOICE_DIR}</code> を確認してください。</div>`,
            { ok: false }
        );
        return;
    }

    // 進捗表示
    updateVoicesDebug(
        `<div>音声ファイルへのアクセス確認中…（${list.length} 件）</div>`,
        { ok: true }
    );

    const results = await Promise.all(
        list.map(async (f) => {
            try {
                const res = await fetch(f.url, { method: 'GET' });
                return {
                    name: f.name,
                    url: f.url,
                    ok: res.ok,
                    status: res.status
                };
            } catch (e) {
                return {
                    name: f.name,
                    url: f.url,
                    ok: false,
                    status: 'network-error'
                };
            }
        })
    );

    const okCount = results.filter(r => r.ok).length;
    const badItems = results.filter(r => !r.ok);

    if (badItems.length === 0) {
        updateVoicesDebug(
            `<div><strong>全音声ファイルにアクセスできました ✅</strong><br>
              件数: ${okCount} / ${results.length}</div>`,
            { ok: true }
        );
    } else {
        const badHtml = badItems.map(r =>
            `<li>${r.name} … <code>${r.status}</code></li>`
        ).join('');

        updateVoicesDebug(
            `<div>
               <strong>一部の音声ファイルでエラーが発生しています ⚠️</strong><br>
               OK: ${okCount} / NG: ${badItems.length} / 総数: ${results.length}
             </div>
             <details style="margin-top:4px;">
               <summary>エラーになったファイル一覧</summary>
               <ul style="margin:4px 0 0 1em;">${badHtml}</ul>
             </details>`,
            { ok: false }
        );
    }
}

// コンソールからも触れるように
window.verifyAllVoicesReachable = verifyAllVoicesReachable;

// ★ 文節データ初期化：UIは作らず、bunsetsuData だけ用意する
async function initBunsetsuData() {
    // 文節数：入力欄があればそれを使う、なければ 4 文節くらい
    let n = 4;
    if (bunsetsuCountInput) {
        const v = parseInt(bunsetsuCountInput.value, 10);
        if (!isNaN(v) && v >= 1) {
            n = Math.min(v, 10);
        }
    }

    const sharedList = await fetchSharedWavList();

    bunsetsuData = [];
    for (let i = 0; i < n; i++) {
        // 全文節同じリストを参照させる（参照コピーでOK）
        bunsetsuData.push(sharedList);
    }

    console.log('[collage] bunsetsuData initialized', {
        bunsetsuCount: n,
        perBunsetsuItems: sharedList.length,
    });
}

// 「文節数をセット」ボタン
if (setBunsetsuBtn) {
    setBunsetsuBtn.addEventListener('click', async () => {
        // 入力値を見て bunsetsuData を組み直す
        await initBunsetsuData();
    });
}

// 初期文節データ生成
(async () => {
    // bunsetsuData を用意
    await initBunsetsuData();
    // そのあと疎通チェック
    verifyAllVoicesReachable();
})();

// 「全音声再読込」ボタン
const reloadAllAudioBtn = document.getElementById('reload-all-audio-btn');
if (reloadAllAudioBtn) {
    reloadAllAudioBtn.addEventListener('click', async () => {
        const shared = await fetchSharedWavList();

        for (let idx = 0; idx < bunsetsuData.length; idx++) {
            // 参照のみ
            bunsetsuData[idx] = shared;
        }
    });
}

function scheduleNextCollageIfNeeded() {
    // 自動モードでないなら何もしない
    if (!isAutoCollageRunning) return;

    // すでにタイマーが動いているなら触らない（リセットしない）
    if (autoCollageTimer) return;

    // 今再生中なら、終わったあとに generateAndPlayCollagePoem の finally から
    if (isCollagePlaying) return;

    autoCollageTimer = setTimeout(() => {
        autoCollageTimer = null;
        if (!isAutoCollageRunning) return;

        // ★ ここで毎回「今の finalState」に基づくコラージュを読む
        generateAndPlayCollagePoem();
    }, getCollageAutoIntervalMS());
}

// =====================================
// 自動モード用変数
// =====================================
let isAutoCollageRunning = false;
let autoCollageTimer = null;
let lastJudgeStateWithDetailsStr = null;
let isCollagePlaying = false;

// =====================================
// 状態ごとの音声選択ロジック
// =====================================
function pickAudiosByJudge(judge) {
    if (!bunsetsuData.length || !bunsetsuData[0] || bunsetsuData[0].length === 0) {
        return {
            error: '音声データがありません。',
            phraseNames: [],
            selectedAudios: [],
        };
    }

    const phraseNames = [];
    const selectedAudios = [];

    // "voiceXX" の番号を取り出す
    function extractVoiceNumber(fileName) {
        const m =
            fileName.match(/voice(\d+)[_.-]/) ||
            fileName.match(/voice(\d+)/);
        return m ? m[1] : null;
    }

    // 文節ごとに「voice番号 → 音声item」のテーブルを作る
    const voiceNumberTable = bunsetsuData.map(list => {
        const m = new Map();
        for (const item of list) {
            const vn = extractVoiceNumber(item.name);
            if (vn && !m.has(vn)) {
                m.set(vn, item);
            }
        }
        return m;
    });

    // ----- 状態別分岐 -----
    if (judge.state === '優') {
        // 全文節で被っていない番号をできるだけ選ぶ
        const allVoiceNumbers = voiceNumberTable.map(m => Array.from(m.keys()));
        const pickedNumbers = new Set();

        for (let i = 0; i < bunsetsuData.length; i++) {
            const candidates = Array.from(voiceNumberTable[i].keys());
            const notYetNumbers = candidates.filter(vn => !pickedNumbers.has(vn));

            let chosenVn;
            if (notYetNumbers.length) {
                chosenVn =
                    notYetNumbers[Math.floor(Math.random() * notYetNumbers.length)];
            } else {
                chosenVn =
                    candidates[Math.floor(Math.random() * candidates.length)];
            }

            pickedNumbers.add(chosenVn);
            const audio = voiceNumberTable[i].get(chosenVn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }
    } else if (judge.state === '良好') {
        // 最初の2文節で共通番号をなるべく選んで揃える
        const commons = Array.from(voiceNumberTable[0].keys()).filter(key =>
            voiceNumberTable[1].has(key)
        );
        const mainVn = commons.length
            ? commons[Math.floor(Math.random() * commons.length)]
            : null;

        const pickedNumbers = mainVn ? new Set([mainVn]) : new Set();

        // 1つ目
        if (mainVn && voiceNumberTable[0].has(mainVn)) {
            const audio = voiceNumberTable[0].get(mainVn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        } else {
            const [vn] = voiceNumberTable[0].keys();
            const audio = voiceNumberTable[0].get(vn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
            pickedNumbers.add(vn);
        }

        // 2つ目
        if (mainVn && voiceNumberTable[1].has(mainVn)) {
            const audio = voiceNumberTable[1].get(mainVn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        } else {
            const [vn] = voiceNumberTable[1].keys();
            const audio = voiceNumberTable[1].get(vn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
            pickedNumbers.add(vn);
        }

        // 残り
        for (let i = 2; i < bunsetsuData.length; i++) {
            const candidates = Array.from(voiceNumberTable[i].keys());
            const available = candidates.filter(vn => !pickedNumbers.has(vn));
            const chosenVn = available.length
                ? available[Math.floor(Math.random() * available.length)]
                : candidates[0];

            pickedNumbers.add(chosenVn);
            const audio = voiceNumberTable[i].get(chosenVn);
            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }
    } else if (judge.state === '注意') {
        // 先頭3文節くらいをなるべく揃える
        const minN = Math.min(3, bunsetsuData.length);
        const keysArr = [];

        for (let i = 0; i < minN; i++) {
            keysArr.push(Array.from(voiceNumberTable[i].keys()));
        }

        const commonVns = keysArr.reduce(
            (a, b) => a.filter(x => b.includes(x)),
            keysArr[0] || []
        );
        const mainVn = commonVns && commonVns.length
            ? commonVns[Math.floor(Math.random() * commonVns.length)]
            : null;

        const pickedNumbers = mainVn ? new Set([mainVn]) : new Set();

        // 先頭 minN 文節
        for (let i = 0; i < minN; i++) {
            const audio =
                (mainVn && voiceNumberTable[i].has(mainVn))
                    ? voiceNumberTable[i].get(mainVn)
                    : voiceNumberTable[i].values().next().value;

            if (!audio) {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }

            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }

        // 残り
        for (let i = minN; i < bunsetsuData.length; i++) {
            const candidates = Array.from(voiceNumberTable[i].keys());
            const available = candidates.filter(vn => !pickedNumbers.has(vn));
            const chosenVn = available.length
                ? available[Math.floor(Math.random() * available.length)]
                : candidates[0];

            pickedNumbers.add(chosenVn);
            const audio = voiceNumberTable[i].get(chosenVn);
            if (!audio) {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }

            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }
    } else if (judge.state === 'あく') {
        // 先頭4文節くらいを揃え気味に
        const minN = Math.min(4, bunsetsuData.length);
        const keysArr = [];

        for (let i = 0; i < minN; i++) {
            keysArr.push(Array.from(voiceNumberTable[i].keys()));
        }

        const commonVns = keysArr.reduce(
            (a, b) => a.filter(x => b.includes(x)),
            keysArr[0] || []
        );
        const mainVn = commonVns && commonVns.length
            ? commonVns[Math.floor(Math.random() * commonVns.length)]
            : null;

        const pickedNumbers = mainVn ? new Set([mainVn]) : new Set();

        // 先頭 minN 文節
        for (let i = 0; i < minN; i++) {
            const audio =
                (mainVn && voiceNumberTable[i].has(mainVn))
                    ? voiceNumberTable[i].get(mainVn)
                    : voiceNumberTable[i].values().next().value;

            if (!audio) {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }

            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }

        // 残り
        for (let i = minN; i < bunsetsuData.length; i++) {
            const candidates = Array.from(voiceNumberTable[i].keys());
            const available = candidates.filter(vn => !pickedNumbers.has(vn));
            const chosenVn = available.length
                ? available[Math.floor(Math.random() * available.length)]
                : candidates[0];

            pickedNumbers.add(chosenVn);
            const audio = voiceNumberTable[i].get(chosenVn);
            if (!audio) {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }

            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }
    } else if (judge.state === '危険') {
        // 全文節で共通しそうな番号をとにかく選ぶ（あれば voice10 を優先）
        const allVoiceNumbers = voiceNumberTable.map(m => Array.from(m.keys()));
        const commonNumbers = allVoiceNumbers.reduce(
            (a, b) => a.filter(x => b.includes(x)),
            allVoiceNumbers[0] || []
        );

        let chosenVn = null;
        if (commonNumbers && commonNumbers.length) {
            if (commonNumbers.includes('10')) {
                chosenVn = '10';
            } else {
                chosenVn =
                    commonNumbers[Math.floor(Math.random() * commonNumbers.length)];
            }
        }

        for (let i = 0; i < bunsetsuData.length; i++) {
            let audio;

            if (chosenVn && voiceNumberTable[i].has(chosenVn)) {
                audio = voiceNumberTable[i].get(chosenVn);
            } else if (voiceNumberTable[i].size > 0) {
                const [vn] = voiceNumberTable[i].keys();
                audio = voiceNumberTable[i].get(vn);
            } else {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }

            phraseNames.push(audio.name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(audio);
        }
    } else {
        // 未知の状態は単純ランダム
        for (let i = 0; i < bunsetsuData.length; i++) {
            const list = bunsetsuData[i];
            if (!list.length) {
                return {
                    error: `文節${i + 1}に音声がありません。`,
                    phraseNames,
                    selectedAudios,
                };
            }
            const randIdx = Math.floor(Math.random() * list.length);
            phraseNames.push(list[randIdx].name.replace(/\.[^/.]+$/, ''));
            selectedAudios.push(list[randIdx]);
        }
    }

    return { error: null, phraseNames, selectedAudios };
}

// =====================================
// 「今の状態から音声リストを得る」最上位関数
// =====================================
function getSelectedAudiosForCollagePoem(judgeOverride = undefined) {
    let judge = null;

    // 1) 呼び出し元から state 指定があればそれを使う
    if (judgeOverride && typeof judgeOverride === 'object' && judgeOverride.state) {
        judge = judgeOverride;
    } else {
        // 2) announce.js の最終判定だけを見る
        const finalFromAnnounce = getAnnounceFinalState();

        if (finalFromAnnounce) {
            judge = {
                state: finalFromAnnounce,
                from: 'announce.final',
            };
        } else {
            judge = {
                state: '優',
                from: 'no-final-yet',
            };
        }
    }

    updateCollageJudgeDebug(judge);

    return pickAudiosByJudge(judge);
}

// =====================================
// wav 結合用：Blob生成 API
// =====================================
async function generateCollagePoemAudioBlob(options = {}) {

    const {
        judgeOverride = undefined,
        returnType = 'audio',
        selectedAudios: forcedSelectedAudios,
        phraseNames: forcedPhraseNames,
    } = options;

    let phraseNames, selectedAudios, error = null;

    if (forcedSelectedAudios && forcedSelectedAudios.length) {
        // ✅ すでに選択済みのリストが渡されていたらそれを使う
        selectedAudios = forcedSelectedAudios;

        // phraseNames が外から来ていなければファイル名から作る
        phraseNames =
            forcedPhraseNames && forcedPhraseNames.length
                ? forcedPhraseNames.slice()
                : forcedSelectedAudios.map(item =>
                    item.name.replace(/\.[^/.]+$/, '')
                );
    } else {
        // 従来通り：この関数の中で選ぶ（外部APIとして単独で呼ばれる場合用）
        const res = getSelectedAudiosForCollagePoem(judgeOverride);
        error = res.error;
        phraseNames = res.phraseNames;
        selectedAudios = res.selectedAudios;
    }

    if (error || !selectedAudios || !selectedAudios.length) {
        return {
            error: error || '音声データがありません。',
            phraseNames: phraseNames || [],
            selectedAudios: selectedAudios || [],
            blob: null,
            url: null,
        };
    }

    const audioBufferCache = new Map(); // url -> ArrayBuffer

    async function getAudioBuffer(url) {
        if (audioBufferCache.has(url)) {
            return audioBufferCache.get(url);
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error('音声取得失敗: ' + url);
        const buf = await res.arrayBuffer();
        audioBufferCache.set(url, buf);
        return buf;
    }

    try {
        // 各 wav を取得して連結
        const buffers = [];
        for (const item of selectedAudios) {
            const buf = await getAudioBuffer(item.url);
            buffers.push(buf);
        }

        const totalLen = buffers.reduce((sum, b) => sum + b.byteLength, 0);
        const out = new Uint8Array(totalLen);

        let offset = 0;
        for (const buf of buffers) {
            out.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
        }

        const blob = new Blob([out], { type: 'audio/mpeg' });
        const url = (returnType === 'audio') ? URL.createObjectURL(blob) : null;

        return {
            error: null,
            phraseNames,
            selectedAudios,
            blob,
            url,
        };
    } catch (e) {
        return {
            error: String(e),
            phraseNames,
            selectedAudios,
            blob: null,
            url: null,
        };
    }
}

// =====================================
// コラージュ詩のBlobをサーバーへ保存
// =====================================
async function saveCollageAudioToServer(blob, phraseNames, ext = 'wav') {
    try {
        // Blob → base64
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        const res = await fetch('http://127.0.0.1:3001/api/saveCollageAudio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subdir: 'collage_audios',
                ext,
                audioDataBase64: base64,
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        console.log('[collage] Saved:', json);
    } catch (e) {
        console.error('[collage] Save failed:', e);
    }
}

// =====================================
// コラージュ再生の録音セットアップ（AudioContext版）
// =====================================
let collageAudioCtx = null;
let collageMediaDest = null;
let collageRecorder = null;
let collageRecordedChunks = [];
let collageRecorderReady = false;

function setupCollageRecorder() {
    if (collageRecorderReady) return;
    if (!collageAudio) {
        console.warn('[collage] collageAudio が見つからないため録音無効');
        return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        console.warn('[collage] AudioContext 未対応のため録音は無効');
        return;
    }

    // AudioContext を作成
    collageAudioCtx = new AudioCtx();

    // <audio> 要素を AudioContext の入力にする
    const srcNode = collageAudioCtx.createMediaElementSource(collageAudio);

    // 録音用の MediaStreamDestination を作成
    collageMediaDest = collageAudioCtx.createMediaStreamDestination();

    // 録音専用に接続
    srcNode.connect(collageMediaDest);

    // 🔊 再生用（OS のデフォルト出力へ）
    srcNode.connect(collageAudioCtx.destination);

    collageRecorderReady = true;

    console.log('[collage] Recorder routing setup 完了');
}

async function startCollageRecording() {
    setupCollageRecorder();
    if (!collageRecorderReady || !collageMediaDest) {
        console.warn('[collage] 録音セットアップ未完了のため録音開始せず');
        return null;
    }

    // Safari などで AudioContext が suspend していたら resume
    if (collageAudioCtx && collageAudioCtx.state === 'suspended') {
        try {
            await collageAudioCtx.resume();
        } catch (e) {
            console.warn('[collage] AudioContext resume 失敗:', e);
        }
    }

    // 既存の recorder が動いていたら止めておく
    if (collageRecorder && collageRecorder.state === 'recording') {
        try {
            collageRecorder.stop();
        } catch { /* ignore */ }
    }

    collageRecordedChunks = [];

    try {
        // MediaStreamDestination の stream を録音
        collageRecorder = new MediaRecorder(collageMediaDest.stream);
    } catch (e) {
        console.warn('[collage] MediaRecorder 初期化失敗:', e);
        collageRecorder = null;
        return null;
    }

    collageRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            collageRecordedChunks.push(e.data);
        }
    };

    collageRecorder.onerror = (e) => {
        console.error('[collage] MediaRecorder エラー:', e.error || e);
    };

    try {
        collageRecorder.start();
        console.log('[collage] 録音開始');
    } catch (e) {
        console.warn('[collage] MediaRecorder start 失敗:', e);
        collageRecorder = null;
        collageRecordedChunks = [];
        return null;
    }

    return collageRecorder;
}

function stopCollageRecordingAndGetBlob() {
    return new Promise((resolve) => {
        if (!collageRecorder || collageRecorder.state !== 'recording') {
            resolve(null);
            return;
        }

        collageRecorder.onstop = () => {
            try {
                const blob = new Blob(collageRecordedChunks, {
                    type: 'audio/webm' // WebM/Opus
                });
                console.log('[collage] 録音停止・Blob生成完了', blob);
                resolve(blob);
            } catch (e) {
                console.error('[collage] Blob 作成失敗:', e);
                resolve(null);
            } finally {
                collageRecorder = null;
                collageRecordedChunks = [];
            }
        };

        try {
            collageRecorder.stop();
        } catch (e) {
            console.warn('[collage] MediaRecorder stop 失敗:', e);
            resolve(null);
        }
    });
}

// =====================================
// 複数の音声ファイルを順番に再生
// =====================================
async function playAudiosSequentially(audioList) {
    if (!audioList.length) return;
    if (!collageAudio) return;

    collageAudio.style.display = '';
    collageAudio.controls = true;

    for (let i = 0; i < audioList.length; i++) {
        collageAudio.src = audioList[i].url;
        collageAudio.currentTime = 0;

        try {
            await collageAudio.play();
        } catch (e) {
            console.warn('[collage] 再生開始に失敗:', e);
            break;
        }

        await new Promise(resolve => {
            const onEnded = () => {
                collageAudio.removeEventListener('ended', onEnded);
                resolve();
            };
            collageAudio.addEventListener('ended', onEnded);
        });

        if (i < audioList.length - 1) {
            const gapMs = getCollageGapMS();
            if (gapMs > 0) {
                await new Promise(resolve => setTimeout(resolve, gapMs));
            }
        }
    }
}

// =====================================
// コラージュ詩の生成 + 再生本体
// =====================================
async function generateAndPlayCollagePoem() {
    // すでに再生中なら絶対にもう1本始めない
    if (isCollagePlaying) {
        console.log('[collage] 再生中のため新規生成をスキップ');
        return;
    }
    isCollagePlaying = true;

    try {
        const { error, phraseNames, selectedAudios } =
            getSelectedAudiosForCollagePoem();

        if (error) {
            if (collageResult) collageResult.textContent = error;
            if (collageAudio) collageAudio.style.display = 'none';
            return;
        }

        if (collageResult) {
            collageResult.textContent = phraseNames.join(' / ');
        }

        await startCollageRecording();
        await playAudiosSequentially(selectedAudios);
        const recordedBlob = await stopCollageRecordingAndGetBlob();

        if (recordedBlob) {
            await saveCollageAudioToServer(recordedBlob, phraseNames, 'webm');
        }
    } finally {
        isCollagePlaying = false;

        // 再生が終わったので、「次の1本」が必要ならここでタイマーを張る
        scheduleNextCollageIfNeeded();
    }
}

// =====================================
// judgeStateWithDetails 監視（announce.final 優先）
// =====================================
function currentJudgeStateSignature() {
    // 1) announce.js の final だけで署名を作る
    const final =
        typeof window.__gardenStateLast === 'string' && window.__gardenStateLast
            ? window.__gardenStateLast
            : null;

    const ctx =
        typeof window.getLatestGardenAnnounceContext === 'function'
            ? window.getLatestGardenAnnounceContext()
            : null;

    if (final) {
        return JSON.stringify({
            final,
            at: ctx && ctx.at ? ctx.at : null,
        });
    }

    return '';
}

function startCollagePoetryAuto() {
    if (isAutoCollageRunning) return;
    isAutoCollageRunning = true;

    // ★ オート開始時点でまず1回スケジュール
    scheduleNextCollageIfNeeded();

    async function pollLoop() {
        if (!isAutoCollageRunning) return;

        const sig = currentJudgeStateSignature();

        if (sig && sig !== lastJudgeStateWithDetailsStr) {
            // 判定の変化があったことだけは覚えておきたいなら残してOK
            lastJudgeStateWithDetailsStr = sig;
        }

        setTimeout(pollLoop, 1000);
    }

    pollLoop();
}

// ページロード後に自動開始（アナウンスとタイミング合わせ）
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        startCollagePoetryAuto();
    }, 5000);
});

window.generateCollagePoemAudioBlob = generateCollagePoemAudioBlob;