// ---------- [DOM取得/共通ユーティリティ] ----------
function $(id) { return document.getElementById(id); }

// グローバル（他スクリプト参照用）
window.detectedCoords = [];

// --- 出力キャンバス(result1) ---
const result1 = $('result1');
const ctx = result1?.getContext?.('2d', { willReadFrequently: true });

// ===== 入力ソース：result0(canvas) 固定 =====
function getSourceCanvas() {
    const src = window.result0;
    if (src && src.width && src.height) return src;
    return null;
}

// 入力ソースの表示サイズ（描画元のネイティブ解像度）を取得
function getSourceSize() {
    const src = getSourceCanvas();
    if (!src) return { w: 0, h: 0 };
    return { w: src.width || 0, h: src.height || 0 };
}

// 入力ソース(result0)を作業コンテキストへ描画（cover 相当でトリミング）
function drawSourceTo(ctx2, dx, dy, dw, dh) {
    const src = getSourceCanvas();
    if (!src || !dw || !dh) return;

    const sw = src.width;
    const sh = src.height;
    if (!sw || !sh) return;

    ctx2.save();

    // “cover”相当でトリミング
    const s = Math.max(dw / sw, dh / sh);
    const srcW = dw / s, srcH = dh / s;
    const sx = (sw - srcW) / 2;
    const sy = (sh - srcH) / 2;
    ctx2.drawImage(src, sx, sy, srcW, srcH, dx, dy, dw, dh);

    ctx2.restore();
}

// 「座標・時刻抜き」画像を保持するキャンバス（result2/ヒートマップ用）
const result1NoCoords = document.createElement('canvas');
const ctxNoCoords = result1NoCoords.getContext('2d', { willReadFrequently: true });

// ===== [トランジション用バッファ / 設定] =========================
const prevCanvas = document.createElement('canvas');
const prevCtx = prevCanvas.getContext('2d', { willReadFrequently: true });
const nextCanvas = document.createElement('canvas');
const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true });

// 毎フレームの完成像を作る作業用
const workingCanvas = document.createElement('canvas');
const wctx = workingCanvas.getContext('2d', { willReadFrequently: true });

let isTransitionRunning = false;
let transitionRafId = null;

let TRANSITION_MS;
let SHOW_FRONTLINE = true;

// スライダー連動（HTMLに #transitionMs を追加しておく。単位は「秒」）
const transitionMsInput = $('transitionMs');
const transitionMsLabel = $('transitionMsLabel');
if (transitionMsInput) {
    const htmlValue = parseFloat(transitionMsInput.value);
    if (!isNaN(htmlValue) && htmlValue > 0) {
        TRANSITION_MS = Math.max(0.05, htmlValue) * 1000;
    } else {
        TRANSITION_MS = 5000; // デフォルト: 5秒
    }
    if (transitionMsLabel) transitionMsLabel.textContent = (TRANSITION_MS / 1000) + ' 秒';
    transitionMsInput.addEventListener('input', () => {
        const s = parseFloat(transitionMsInput.value) || 1;
        TRANSITION_MS = Math.max(0.05, s) * 1000; // 最小0.05秒=50ms
        if (transitionMsLabel) transitionMsLabel.textContent = (TRANSITION_MS / 1000) + ' 秒';
    });
} else {
    TRANSITION_MS = 5000; // フォールバック: 5秒
}

function ensureBuffersSize(w, h) {
    if (!w || !h) return;
    if (prevCanvas.width !== w || prevCanvas.height !== h) {
        prevCanvas.width = w; prevCanvas.height = h;
    }
    if (nextCanvas.width !== w || nextCanvas.height !== h) {
        nextCanvas.width = w; nextCanvas.height = h;
    }
    if (workingCanvas.width !== w || workingCanvas.height !== h) {
        workingCanvas.width = w; workingCanvas.height = h;
    }
}

// 共通：トランジション開始
function startTransition() {
    if (!ctx || !result1) return;
    const w = result1.width, h = result1.height;
    if (!w || !h) return;

    // 進行中を中断し、直前の画面状態を prev に確定
    if (isTransitionRunning && transitionRafId) {
        cancelAnimationFrame(transitionRafId);
        isTransitionRunning = false;
        prevCtx.save();
        prevCtx.setTransform(1, 0, 0, 1, 0, 0);
        prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
        prevCtx.drawImage(result1, 0, 0);
        prevCtx.restore();
    }

    const t0 = performance.now();
    isTransitionRunning = true;

    // 初期フレーム：まず旧フレームを表示
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(prevCanvas, 0, 0);
    ctx.restore();

    const loop = (t) => {
        const p = Math.max(0, Math.min(1, (t - t0) / TRANSITION_MS));
        const d = Math.round(p * w);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // cover（固定位置wipe）
        ctx.drawImage(prevCanvas, 0, 0);
        if (d > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(w - d, 0, d, h);
            ctx.clip();
            ctx.drawImage(nextCanvas, 0, 0);
            ctx.restore();

            if (SHOW_FRONTLINE) {
                const frontX = w - d;
                if (d < w && frontX > 0) {
                    ctx.beginPath(); ctx.moveTo(frontX + 0.5, 0); ctx.lineTo(frontX + 0.5, h);
                    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,255,128,0.9)'; ctx.stroke();
                }
            }
        }

        ctx.restore();

        if (p < 1) {
            transitionRafId = requestAnimationFrame(loop);
        } else {
            isTransitionRunning = false;
        }
    };

    transitionRafId = requestAnimationFrame(loop);
}

// ============ UI取得 ============
const maxCoordsInput = $('maxCoords');
const pxSizeInput = $('pxSize');
const tolerancePercentInput = $('tolerancePercent');
const intervalSecInput = $('intervalSec');

const maxCoordsLabel = $('maxCoordsLabel');
const pxSizeLabel = $('pxSizeLabel');
const tolerancePercentLabel = $('tolerancePercentLabel');
const intervalSecLabel = $('intervalSecLabel');

const forceUpdateBtn = $('forceUpdate');

// flipBtn / mirror 機能は削除

// 座標表示用要素（なければ作成）
let pickedCoordEl = $('pickedCoord');
let pickedHexEl = $('pickedHex'); // ある場合だけ使う
if (!pickedCoordEl) {
    pickedCoordEl = document.createElement('span');
    pickedCoordEl.id = 'pickedCoord';
    pickedCoordEl.style.marginLeft = '8px';
    if (pickedHexEl && pickedHexEl.parentNode) {
        pickedHexEl.parentNode.insertBefore(pickedCoordEl, pickedHexEl.nextSibling);
    }
}

// ---------- [設定・状態管理] ----------
let MAX_COORDS = 20;
let PX_SIZE = 16;
let TOLERANCE_PERCENT = 10;
let UPDATE_INTERVAL_SEC = 1;

// 何スナップごとにアナウンスするか
window.gardenAnnounceEverySnapshots = window.gardenAnnounceEverySnapshots || 3;
let snapshotCountForAnnounce = 0;
let hasAnnouncedOnce = false;

// pickedColors / pickedColor は result2_effect.js からも参照される
let pickedColors = [];      // [{r,g,b,hex}]
let pickedColor = null;     // 代表色（互換用：pickedColors[0]を反映）

let detectedCoords = [];         // [{x,y,time:Date}]
let timerId = null;
let running = true;

// updateSnapshot 内で使う状態
let lastCoordsCount = 0;
let lastCoordsIncreaseTime = Date.now();
let coordsNotIncreasedDuration = 0;
let lastCoordsSnapshot = [];

// --- パラメータUI反映 ---
if (maxCoordsInput) {
    MAX_COORDS = parseInt(maxCoordsInput.value, 10) || MAX_COORDS;
    maxCoordsInput.addEventListener('input', () => {
        MAX_COORDS = parseInt(maxCoordsInput.value, 10) || MAX_COORDS;
        if (maxCoordsLabel) maxCoordsLabel.textContent = MAX_COORDS;
    });
    if (maxCoordsLabel) maxCoordsLabel.textContent = MAX_COORDS;
}
if (pxSizeInput) {
    PX_SIZE = parseInt(pxSizeInput.value, 10) || PX_SIZE;
    pxSizeInput.addEventListener('input', () => {
        PX_SIZE = parseInt(pxSizeInput.value, 10) || PX_SIZE;
        if (pxSizeLabel) pxSizeLabel.textContent = PX_SIZE;
    });
    if (pxSizeLabel) pxSizeLabel.textContent = PX_SIZE;
}
if (tolerancePercentInput) {
    TOLERANCE_PERCENT = parseFloat(tolerancePercentInput.value) || TOLERANCE_PERCENT;
    tolerancePercentInput.addEventListener('input', () => {
        TOLERANCE_PERCENT = parseFloat(tolerancePercentInput.value) || TOLERANCE_PERCENT;
        if (tolerancePercentLabel) tolerancePercentLabel.textContent = TOLERANCE_PERCENT;
    });
    if (tolerancePercentLabel) tolerancePercentLabel.textContent = TOLERANCE_PERCENT;
}
if (intervalSecInput) {
    UPDATE_INTERVAL_SEC = parseInt(intervalSecInput.value, 10) || UPDATE_INTERVAL_SEC;
    intervalSecInput.addEventListener('input', () => {
        UPDATE_INTERVAL_SEC = parseInt(intervalSecInput.value, 10) || UPDATE_INTERVAL_SEC;
        if (intervalSecLabel) intervalSecLabel.textContent = UPDATE_INTERVAL_SEC;
        startTimer();
    });
    if (intervalSecLabel) intervalSecLabel.textContent = UPDATE_INTERVAL_SEC;
}

// 背景色（固定1色 or パレット）
const bgPalette = [
    "rgb(170, 90, 10)",
];

const grab = document.createElement('canvas');
const gtx = grab.getContext('2d', { willReadFrequently: true });

function toHex2(n) { return Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0'); }
function rgbToHex(r, g, b) { return '#' + toHex2(r) + toHex2(g) + toHex2(b); }

function addPickedColorFromRGB(r, g, b) {
    const hex = rgbToHex(r, g, b).toUpperCase();
    if (!pickedColors.some(c => c.hex === hex)) {
        pickedColors.push({ r: r | 0, g: g | 0, b: b | 0, hex });
        if (!pickedColor) pickedColor = [r | 0, g | 0, b | 0];
        syncColorUI();
        if (typeof updateresult2 === 'function') updateresult2();
    }
}

function addPickedColorFromHex(hexStr) {
    const m = /^#?([0-9A-Fa-f]{6})$/.exec(hexStr.trim());
    if (!m) return;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    addPickedColorFromRGB(r, g, b);
}

function clearAllPickedColors() {
    pickedColors = [];
    pickedColor = null;
    if (typeof clearResult2Ticker === 'function') clearResult2Ticker();
    if (typeof updateresult2 === 'function') updateresult2();
}

// handlePickの前後で虫眼鏡非表示
async function handlePick(ev) {
    hideMagnifier();
    const { vx, vy } = getVideoPointFromClient(ev);
    const { w, h } = getSourceSize();
    if (!w || !h) return;

    const src = getSourceCanvas();
    if (!src) return;

    grab.width = w; grab.height = h;
    gtx.save();
    gtx.drawImage(src, 0, 0, w, h);
    gtx.restore();

    const img = gtx.getImageData(vx, vy, 1, 1).data;
    addPickedColorFromRGB(img[0], img[1], img[2]);

    detectedCoords = []; window.detectedCoords = [];
    lastCoordsCount = 0; lastCoordsIncreaseTime = Date.now(); coordsNotIncreasedDuration = 0;
    lastCoordsSnapshot = [];

    if (typeof clearResult2Ticker === 'function') clearResult2Ticker();
    if (typeof updateresult2 === 'function') updateresult2();
}

// ==============================
// [3] スナップショット更新・マスク処理
// ==============================

// 複数色の最近傍距離 & 最近傍色 ------------------
function dist2ToAnyPickedColor(r, g, b) {
    if (!pickedColors.length) return Infinity;
    let best = Infinity;
    for (const c of pickedColors) {
        const dr = Math.abs(r - c.r), dg = Math.abs(g - c.g), db = Math.abs(b - c.b);
        const d2 = Math.max(dr, dg, db) ** 2;
        if (d2 < best) best = d2;
    }
    return best;
}
function nearestPickedColor(r, g, b) {
    if (!pickedColors.length) return null;
    let best = Infinity, bestC = null;
    for (const c of pickedColors) {
        const dr = Math.abs(r - c.r), dg = Math.abs(g - c.g), db = Math.abs(b - c.b);
        const d2 = Math.max(dr, dg, db) ** 2;
        if (d2 < best) { best = d2; bestC = c; }
    }
    return bestC;
}
// ------------------------------------------------------------

function deduplicateCoords(coords, dist) {
    if (coords.length <= 1) return coords;
    const result = [];
    const used = new Array(coords.length).fill(false);
    for (let i = 0; i < coords.length; ++i) {
        if (used[i]) continue;
        let [sumX, sumY, count] = [coords[i][0], coords[i][1], 1];
        used[i] = true;
        for (let j = i + 1; j < coords.length; ++j) {
            if (used[j]) continue;
            const dx = coords[i][0] - coords[j][0];
            const dy = coords[i][1] - coords[j][1];
            if (dx * dx + dy * dy < dist * dist) {
                sumX += coords[j][0];
                sumY += coords[j][1];
                count++;
                used[j] = true;
            }
        }
        result.push([Math.round(sumX / count), Math.round(sumY / count)]);
    }
    return result;
}

function updateDetectedCoordsWithTime(newCoords) {
    const now = new Date();
    const merged = [];
    for (let i = 0; i < newCoords.length; ++i) {
        const [x, y] = newCoords[i];
        let found = false;
        for (let j = 0; j < detectedCoords.length; ++j) {
            const prev = detectedCoords[j];
            const dx = prev.x - x, dy = prev.y - y;
            if (dx * dx + dy * dy < 25) {
                merged.push({ x, y, time: prev.time }); found = true; break;
            }
        }
        if (!found) merged.push({ x, y, time: now });
    }
    return merged;
}

// --- スナップショット更新 ---
async function updateSnapshot() {
    if (!ctx || !result1) return;

    const { w: vw, h: vh } = getSourceSize();
    if (!vw || !vh) return;

    if (result1.width !== vw || result1.height !== vh) {
        result1.width = vw; result1.height = vh;
        ensureBuffersSize(vw, vh);
        if (typeof resizeresult2ToEffect === 'function') {
            resizeresult2ToEffect();
        }
    }

    // 直前の表示を prev へ
    prevCtx.save();
    prevCtx.setTransform(1, 0, 0, 1, 0, 0);
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    if (result1.width && result1.height) prevCtx.drawImage(result1, 0, 0);
    prevCtx.restore();

    // ソースフレームを wctx へ
    wctx.save();
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.clearRect(0, 0, workingCanvas.width, workingCanvas.height);
    drawSourceTo(wctx, 0, 0, vw, vh);
    const grabSrc = wctx.getImageData(0, 0, vw, vh);
    wctx.restore();

    // NoCoords 側
    result1NoCoords.width = vw; result1NoCoords.height = vh;
    ctxNoCoords.save();
    ctxNoCoords.setTransform(1, 0, 0, 1, 0, 0);
    ctxNoCoords.clearRect(0, 0, vw, vh);
    drawSourceTo(ctxNoCoords, 0, 0, vw, vh);
    ctxNoCoords.restore();

    // 背景
    const bg = bgPalette[Math.floor(Math.random() * bgPalette.length)];
    wctx.fillStyle = bg;
    wctx.fillRect(0, 0, vw, vh);
    ctxNoCoords.fillStyle = bg;
    ctxNoCoords.fillRect(0, 0, vw, vh);

    // pickedColorsが空ならガイドだけ
    if (!pickedColors.length) {
        wctx.save();
        wctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        for (let y = 0; y < vh; y += PX_SIZE) {
            wctx.beginPath(); wctx.moveTo(0, y + .5); wctx.lineTo(vw, y + .5); wctx.stroke();
        }
        for (let x = 0; x < vw; x += PX_SIZE) {
            wctx.beginPath(); wctx.moveTo(x + .5, 0); wctx.lineTo(x + .5, vh); wctx.stroke();
        }
        wctx.restore();

        ctxNoCoords.save();
        ctxNoCoords.strokeStyle = 'rgba(255,255,255,0.2)';
        for (let y = 0; y < vh; y += PX_SIZE) {
            ctxNoCoords.beginPath(); ctxNoCoords.moveTo(0, y + .5); ctxNoCoords.lineTo(vw, y + .5); ctxNoCoords.stroke();
        }
        for (let x = 0; x < vw; x += PX_SIZE) {
            ctxNoCoords.beginPath(); ctxNoCoords.moveTo(x + .5, 0); ctxNoCoords.lineTo(x + .5, vh); ctxNoCoords.stroke();
        }
        ctxNoCoords.restore();

        if (pickedCoordEl) pickedCoordEl.textContent = '';

        lastCoordsCount = 0; lastCoordsIncreaseTime = Date.now(); coordsNotIncreasedDuration = 0; lastCoordsSnapshot = [];

        if (typeof clearResult2Ticker === 'function') clearResult2Ticker();
        if (typeof updateresult2 === 'function') updateresult2();

        ctxNoCoords.save();
        ctxNoCoords.setTransform(1, 0, 0, 1, 0, 0);
        ctxNoCoords.clearRect(0, 0, vw, vh);
        drawSourceTo(ctxNoCoords, 0, 0, vw, vh);
        ctxNoCoords.restore();

        startTransition();
        if (typeof startResult2TickerAnim === 'function') {
            startResult2TickerAnim();
        }
        return;
    }

    // ---------【 A. updateSnapshot（複数色対応の検出）】-----------
    const tol2 = Math.pow(255 * (TOLERANCE_PERCENT / 100), 2);
    let foundCoords = [];
    const src = grabSrc;

    const stride = Math.max(1, Math.floor(PX_SIZE / 4));
    for (let by = 0; by < vh; by += PX_SIZE) {
        for (let bx = 0; bx < vw; bx += PX_SIZE) {
            let match = false, matchX = null, matchY = null;
            for (let y = by; y < Math.min(by + PX_SIZE, vh); y += stride) {
                let base = (y * vw + bx) * 4;
                for (let x = bx; x < Math.min(bx + PX_SIZE, vw); x += stride) {
                    const r = src.data[base], g = src.data[base + 1], b = src.data[base + 2];
                    if (dist2ToAnyPickedColor(r, g, b) <= tol2) {
                        match = true; matchX = x; matchY = y; break;
                    }
                    base += 4 * stride;
                }
                if (match) break;
            }
            if (match) {
                let cx0 = Math.floor(bx + PX_SIZE / 2);
                let cy0 = Math.floor(by + PX_SIZE / 2);
                if (matchX !== null && matchY !== null) { cx0 = matchX; cy0 = matchY; }
                foundCoords.push([cx0, cy0]);
            }
        }
    }

    foundCoords = deduplicateCoords(foundCoords, PX_SIZE);
    if (foundCoords.length > MAX_COORDS) foundCoords = foundCoords.slice(0, MAX_COORDS);

    detectedCoords = updateDetectedCoordsWithTime(foundCoords);
    window.detectedCoords = detectedCoords;

    // グリッド
    wctx.save();
    wctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    for (let y = 0; y < vh; y += PX_SIZE) { wctx.beginPath(); wctx.moveTo(0, y + .5); wctx.lineTo(vw, y + .5); wctx.stroke(); }
    for (let x = 0; x < vw; x += PX_SIZE) { wctx.beginPath(); wctx.moveTo(x + .5, 0); wctx.lineTo(x + .5, vh); wctx.stroke(); }
    wctx.restore();

    ctxNoCoords.save();
    ctxNoCoords.strokeStyle = 'rgba(255,255,255,0.2)';
    for (let y = 0; y < vh; y += PX_SIZE) { ctxNoCoords.beginPath(); ctxNoCoords.moveTo(0, y + .5); ctxNoCoords.lineTo(vw, y + .5); ctxNoCoords.stroke(); }
    for (let x = 0; x < vw; x += PX_SIZE) { ctxNoCoords.beginPath(); ctxNoCoords.moveTo(x + .5, 0); ctxNoCoords.lineTo(x + .5, vh); ctxNoCoords.stroke(); }
    ctxNoCoords.restore();

    // ★★★ 検出マスクは「最近傍の選択色」で塗る
    wctx.save(); ctxNoCoords.save();
    wctx.globalAlpha = 1.0; ctxNoCoords.globalAlpha = 1.0;
    for (const { x, y } of detectedCoords) {
        const px = Math.max(0, Math.min(vw - 1, x | 0));
        const py = Math.max(0, Math.min(vh - 1, y | 0));
        const i = (py * vw + px) * 4;
        const r0 = src.data[i], g0 = src.data[i + 1], b0 = src.data[i + 2];
        const nc = nearestPickedColor(r0, g0, b0) || pickedColors[0];
        const fill = `rgb(${nc.r},${nc.g},${nc.b})`;
        wctx.fillStyle = fill; ctxNoCoords.fillStyle = fill;
        wctx.fillRect(x - Math.floor(PX_SIZE / 2), y - Math.floor(PX_SIZE / 2), PX_SIZE, PX_SIZE);
        ctxNoCoords.fillRect(x - Math.floor(PX_SIZE / 2), y - Math.floor(PX_SIZE / 2), PX_SIZE, PX_SIZE);
    }
    wctx.restore(); ctxNoCoords.restore();

    // 時刻・座標のオーバーレイ
    if (typeof window.showTimeAndCoordsOnEffectResult1 === "undefined") window.showTimeAndCoordsOnEffectResult1 = true;
    if (typeof window.showTimeAndCoordsOnEffectResult2 === "undefined") window.showTimeAndCoordsOnEffectResult2 = true;

    if (window.showTimeAndCoordsOnEffectResult1 && detectedCoords.length > 0) {
        wctx.save();
        wctx.font = `${Math.max(16, Math.floor(PX_SIZE * 0.7))}px sans-serif`;
        wctx.textBaseline = 'top';
        wctx.fillStyle = '#fff';
        for (const { x, y, time } of detectedCoords) {
            let timeStr = '';
            if (time instanceof Date) {
                const M = (time.getMonth() + 1).toString().padStart(2, "0");
                const D = time.getDate().toString().padStart(2, "0");
                const h = time.getHours().toString().padStart(2, "0");
                const m = time.getMinutes().toString().padStart(2, "0");
                timeStr = `${M}/${D} ${h}:${m}`;
            } else if (typeof time === "string") {
                timeStr = time;
            }
            const coordStr = `(${x},${y})`;
            const textX = x + 3, textY = y + 3;
            const timeWidth = wctx.measureText(timeStr).width;
            wctx.fillText(timeStr, textX, textY);
            wctx.fillText(coordStr, textX + timeWidth + 4, textY);
        }
        wctx.restore();
    }

    if (pickedCoordEl) {
        pickedCoordEl.textContent = detectedCoords.length === 0
            ? '検知座標: なし'
            : `検知座標: ${detectedCoords.length}個検出中`;
    }

    if (typeof appendCoordsToResult2Ticker === 'function') {
        appendCoordsToResult2Ticker(detectedCoords);
    }

    if (typeof updateresult2 === 'function') {
        updateresult2();
    }

    // judge.js へ「intervalSecLabel（UPDATE_INTERVAL_SEC）ごと」に 1 回送る
    if (typeof window.updateGardenStateFromGrid === "function") {
        window.updateGardenStateFromGrid(window.gridDensities);
    }

    nextCtx.save();
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.drawImage(workingCanvas, 0, 0);
    nextCtx.restore();

    startTransition();
    if (typeof startResult2TickerAnim === 'function') {
        startResult2TickerAnim();
    }
}

window.forceUpdateSnapshot = updateSnapshot;

// ---------- [タイマー管理] ----------
async function startTimer() {
    stopTimer();

    const tick = async () => {
        if (!running) return;

        await updateSnapshot();

        if (Array.isArray(window.gridDensities) && window.gridDensities.length) {
            const ctx = window.currentGardenJudgeContext;
            const hist = window.__gardenGridHistory || [];
            const canAnnounce =
                ctx && ctx.latestGrid &&
                typeof window.announceGardenStateFromContext === "function";

            if (canAnnounce) {
                const every = window.gardenAnnounceEverySnapshots || 3;

                if (!hasAnnouncedOnce) {
                    hasAnnouncedOnce = true;
                    snapshotCountForAnnounce = 0;
                    window.announceGardenStateFromContext(
                        ctx,
                        hist,
                        window.setAnnounceOutputText || function () { },
                        true
                    );
                } else {
                    snapshotCountForAnnounce++;

                    if (snapshotCountForAnnounce >= every) {
                        snapshotCountForAnnounce = 0;
                        window.announceGardenStateFromContext(
                            ctx,
                            hist,
                            window.setAnnounceOutputText || function () { },
                            true
                        );
                    }
                }
            }
        } else {
            snapshotCountForAnnounce = 0;
        }

        timerId = setTimeout(tick, UPDATE_INTERVAL_SEC * 1000);
    };

    // 最初の実行は 3 秒後（既存仕様を踏襲）
    timerId = setTimeout(tick, 3000);
}

function stopTimer() {
    if (timerId) { clearTimeout(timerId); timerId = null; }
}

startTimer();

// ==============================
// [4] UI操作イベント
// ==============================
if (forceUpdateBtn) forceUpdateBtn.addEventListener('click', () => updateSnapshot());

// “時刻・座標の表示/非表示” チェックリスト制御版
(function setupShowTimeAndCoordsCheckboxes() {
    // result1（映像上）
    const chkId1 = 'showTimeAndCoordsChkResult1';
    let chk1 = $(chkId1);
    if (!chk1) {
        chk1 = document.createElement('input');
        chk1.type = 'checkbox';
        chk1.id = chkId1;
        chk1.style.marginRight = '0.5em';
        const label = document.createElement('label');
        label.htmlFor = chkId1;
        label.appendChild(chk1);
        label.appendChild(document.createTextNode('result1/時刻・座標'));
        (document.getElementById('result1Controls') || document.body).appendChild(label);
    }

    if (typeof window.showTimeAndCoordsOnEffectResult1 === "undefined") window.showTimeAndCoordsOnEffectResult1 = false;
    chk1.checked = !!window.showTimeAndCoordsOnEffectResult1;

    chk1.addEventListener('change', () => {
        window.showTimeAndCoordsOnEffectResult1 = chk1.checked;
        updateSnapshot();
    });
})();

// ==============================
// [5] 複数色：HTML数値入力UIと同期
// ==============================
const hexInput = $('hexInput');
const rInput = $('rInput');
const gInput = $('gInput');
const bInput = $('bInput');
const addColorBtn = $('addColorBtn');
const clearColorsBtn = $('clearColorsBtn');
const colorList = $('colorList');

function syncColorUI() {
    if (pickedColors.length > 0) {
        const c0 = pickedColors[0];
        pickedColor = [c0.r, c0.g, c0.b];
    } else {
        pickedColor = null;
    }

    if (!colorList) return;
    colorList.innerHTML = '';
    pickedColors.forEach((c) => {
        const chip = document.createElement('span');
        chip.title = `${c.hex} (R${c.r} G${c.g} B${c.b})`;
        chip.style.cssText = `
          display:inline-flex; align-items:center;
          border:1px solid #ffffff55; border-radius:0.5rem;
          padding:.25rem .5rem; margin:0 .2rem .2rem 0;
          background:${c.hex}; color:#e5e7eb;
          font-size:0.8rem;
        `;
        chip.textContent = c.hex;
        colorList.appendChild(chip);
    });
}

if (addColorBtn) {
    addColorBtn.addEventListener('click', () => {
        if (hexInput && hexInput.value.trim()) {
            addPickedColorFromHex(hexInput.value);
            hexInput.value = '';
            return;
        }
        const r = parseInt(rInput?.value ?? '', 10);
        const g = parseInt(gInput?.value ?? '', 10);
        const b = parseInt(bInput?.value ?? '', 10);
        if ([r, g, b].every(v => Number.isFinite(v))) {
            addPickedColorFromRGB(r, g, b);
            if (rInput) rInput.value = '';
            if (gInput) gInput.value = '';
            if (bInput) bInput.value = '';
        }
    });
}
if (clearColorsBtn) {
    clearColorsBtn.addEventListener('click', clearAllPickedColors);
}

// ==============================
// [6] ページ非表示時の省電力対応
// ==============================
document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) startTimer(); else stopTimer();
    if (document.hidden) {
        if (typeof stopResult2TickerAnim === 'function') stopResult2TickerAnim();
    } else if (window.showTimeAndCoordsOnEffectResult2) {
        if (typeof startResult2TickerAnim === 'function') startResult2TickerAnim();
    }
});

// グローバル公開して mixwebcam から呼べるようにする
window.addPickedColorFromRGB = addPickedColorFromRGB;
window.addPickedColorFromHex = addPickedColorFromHex;
window.clearAllPickedColors = clearAllPickedColors;

// ======================================================
// JSONファイルから初期色を読み込むローダー
// ======================================================
async function loadPresetColorsFromJSONFile(url = './presetColors.json') {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[presetColors] ファイル読み込み失敗: ${res.status}`);
            return;
        }
        const data = await res.json();
        if (!data) return;

        const pushHex = (hex) => {
            if (typeof hex !== 'string') return;
            const m = hex.trim().match(/^#?[0-9A-Fa-f]{6}$/);
            if (!m) return;
            const norm = '#' + m[0].replace('#', '').toUpperCase();
            addPickedColorFromHex(norm);
        };
        const pushRGB = (arr) => {
            if (!Array.isArray(arr) || arr.length < 3) return;
            const [r, g, b] = arr.map(v => +v);
            if ([r, g, b].some(v => !Number.isFinite(v))) return;
            addPickedColorFromRGB(
                Math.max(0, Math.min(255, r | 0)),
                Math.max(0, Math.min(255, g | 0)),
                Math.max(0, Math.min(255, b | 0))
            );
        };
        const applyTolerance = (v) => {
            const num = +v;
            if (!Number.isFinite(num)) return;
            TOLERANCE_PERCENT = Math.max(0, Math.min(100, num));
            const label = document.getElementById('tolerancePercentLabel');
            const input = document.getElementById('tolerancePercent');
            if (input) input.value = String(TOLERANCE_PERCENT);
            if (label) label.textContent = String(TOLERANCE_PERCENT);
        };

        if (Array.isArray(data)) {
            // 旧フォーマット: 直接配列の場合
            for (const item of data) {
                if (typeof item === 'string') pushHex(item);
                else if (item?.hex) pushHex(item.hex);
                else if (item?.rgb) pushRGB(item.rgb);
            }
        } else if (typeof data === 'object') {
            // 新フォーマット: { tolerance, colors }
            if ('tolerance' in data) applyTolerance(data.tolerance);
            const list = Array.isArray(data.colors) ? data.colors : [];
            for (const item of list) {
                if (typeof item === 'string') pushHex(item);
                else if (item?.hex) pushHex(item.hex);
                else if (item?.rgb) pushRGB(item.rgb);
            }
        }

        syncColorUI?.();
        if (typeof updateresult2 === 'function') updateresult2();

        console.info(`[presetColors] ${url} から ${pickedColors.length} 色を読み込み完了`);

    } catch (err) {
        console.error('[presetColors] JSONロードエラー:', err);
    }
}

// ページロード完了時に自動実行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadPresetColorsFromJSONFile('./color0.json'));
} else {
    loadPresetColorsFromJSONFile('./color0.json');
}