(function () {
    let result2, ctx3;
    let grid3Size = 48;
    let grid3Tol = 32;

    const smoothScratchA = [];
    const smoothScratchB = [];
    const distanceScratch = [];
    const distanceOutScratch = [];
    const vectorScratchVX = [];
    const vectorScratchVY = [];

    function ensureScratchMatrix(pool, rows, cols, fillValue = null) {
        if (pool.length !== rows) pool.length = rows;
        for (let r = 0; r < rows; r++) {
            let row = pool[r];
            if (!row || row.length !== cols) {
                row = pool[r] = new Float32Array(cols);
            }
            if (fillValue !== null) {
                row.fill(fillValue);
            }
        }
        return pool;
    }

    const scheduleResult2Update = (() => {
        const DEBOUNCE_MS = 160;
        let timer = null;
        return (immediate = false) => {
            if (immediate) {
                if (timer) { clearTimeout(timer); timer = null; }
                updateresult2();
                return;
            }
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                updateresult2();
            }, DEBOUNCE_MS);
        };
    })();

    // result2 帯アニメーション用
    let result2TickerEntries = [];
    let result2TickerKeySet = new Set();
    let result2TickerAnimRafId = null;

    // result2 + コントロールの初期化
    (function ensureresult2AndControls() {
        const ctrl = $('result2Controls');
        result2 = $('result2');
        if (!ctrl || !result2) return;
        ctx3 = result2.getContext('2d', { willReadFrequently: true });

        const grid3SizeInput = $('grid3Size');
        const grid3SizeLabel = $('grid3SizeLabel');
        const grid3ShowChk = $('grid3Show');
        const grid3ShowPercentChk = $('grid3ShowPercent');
        const grid3ShowHeatChk = $('grid3ShowHeat');
        const grid3TolInput = $('grid3Tol');
        const grid3TolLabel = $('grid3TolLabel');

        grid3Size = parseInt(grid3SizeInput?.value ?? grid3Size, 10);
        if (grid3SizeLabel) grid3SizeLabel.textContent = grid3Size;

        if (grid3TolInput) {
            grid3Tol = parseInt(grid3TolInput.value, 10) || grid3Tol;
            grid3TolInput.addEventListener('input', () => {
                grid3Tol = parseInt(grid3TolInput.value, 10) || grid3Tol;
                if (grid3TolLabel) grid3TolLabel.textContent = grid3Tol;
                scheduleResult2Update();
            });
            if (grid3TolLabel) grid3TolLabel.textContent = grid3Tol;
        }

        if (grid3SizeInput) {
            grid3SizeInput.addEventListener('input', () => {
                grid3Size = parseInt(grid3SizeInput.value, 10) || grid3Size;
                if (grid3SizeLabel) grid3SizeLabel.textContent = grid3Size;
                scheduleResult2Update();
            });
        }
        if (grid3ShowChk) grid3ShowChk.addEventListener('change', () => scheduleResult2Update(true));
        if (grid3ShowPercentChk) grid3ShowPercentChk.addEventListener('change', () => scheduleResult2Update(true));
        if (grid3ShowHeatChk) grid3ShowHeatChk.addEventListener('change', () => scheduleResult2Update(true));

        // ▼▼ ベクトル場描画用UI ▼▼
        const vecShow = $('vecShow');
        const vecScale = $('vecScale');
        const vecScaleLabel = $('vecScaleLabel');
        const vecSmooth = $('vecSmooth');
        const smoothItersLabel = $('smoothIters');
        const vecGamma = $('vecGamma');
        const vecGammaLabel = $('vecGammaLabel');

        if (vecScale) {
            if (vecScaleLabel) vecScaleLabel.textContent = vecScale.value;
            vecScale.addEventListener('input', () => {
                if (vecScaleLabel) vecScaleLabel.textContent = vecScale.value;
                scheduleResult2Update();
            });
        }
        if (vecGamma) {
            if (vecGammaLabel) vecGammaLabel.textContent = vecGamma.value;
            vecGamma.addEventListener('input', () => {
                if (vecGammaLabel) vecGammaLabel.textContent = vecGamma.value;
                scheduleResult2Update();
            });
        }
        if (vecSmooth) {
            if (smoothItersLabel) smoothItersLabel.textContent = vecSmooth.value;
            vecSmooth.addEventListener('input', () => {
                if (smoothItersLabel) smoothItersLabel.textContent = vecSmooth.value;
                scheduleResult2Update();
            });
        }
        if (vecShow) vecShow.addEventListener('change', () => scheduleResult2Update(true));

        // result2 帯の「表示／非表示」だけを制御するフラグ
        if (typeof window.showResult2TickerBarVisible === "undefined") {
            window.showResult2TickerBarVisible = true; // デフォルト表示
        }

        const chkId2 = 'showTimeAndCoordsChkResult2';
        let chk2 = $(chkId2);
        if (chk2) {
            if (typeof window.showResult2TickerBarVisible === "undefined") {
                window.showResult2TickerBarVisible = true;
            }
            chk2.checked = !!window.showResult2TickerBarVisible;

            chk2.addEventListener('change', () => {
                // ログの ON/OFF ではなく、「帯の表示／非表示」だけを切り替える
                window.showResult2TickerBarVisible = chk2.checked;

                if (!window.showResult2TickerBarVisible) {
                    // OFF: 帯の描画だけ消したい（データは残す）
                    if (typeof stopResult2TickerAnim === 'function') {
                        stopResult2TickerAnim();
                    }
                    if (typeof updateresult2 === 'function') {
                        updateresult2();
                    }
                } else {
                    if (typeof updateresult2 === 'function') {
                        updateresult2();
                    }
                    if (typeof startResult2TickerAnim === 'function') {
                        startResult2TickerAnim();
                    }
                }
            });
        }

        // ======== ミックスカメラ ON/OFF ルーティン ========
        const mixCamMasterChk = $('showMixCam');
        const mixCamIntervalInput = $('mixCamIntervalSec');
        const mixCamOnInput = $('mixCamOnSec');

        let mixCamTimerId = null;
        let mixCamOffTimerId = null;

        function clearMixCamTimers() {
            if (mixCamTimerId !== null) {
                clearInterval(mixCamTimerId);
                mixCamTimerId = null;
            }
            if (mixCamOffTimerId !== null) {
                clearTimeout(mixCamOffTimerId);
                mixCamOffTimerId = null;
            }
        }

        function setMixCamOverlay(on) {
            window.mixCamOverlayOn = !!on;
            if (typeof window.drawMixOnTop === 'function') {
                window.drawMixOnTop();
            }
        }

        function restartMixCamAuto(immediate = true) {
            clearMixCamTimers();

            const intervalSec = parseFloat(mixCamIntervalInput?.value) || 0;
            const onSec = parseFloat(mixCamOnInput?.value) || 0;

            if (!mixCamMasterChk?.checked || intervalSec <= 0 || onSec <= 0) {
                setMixCamOverlay(false);
                return;
            }

            // ======== 次の ON を予約する関数 ========
            function scheduleNextOn() {
                mixCamTimerId = setTimeout(() => {
                    setMixCamOverlay(true);
                    mixCamOffTimerId = setTimeout(() => {
                        setMixCamOverlay(false);
                        scheduleNextOn();
                    }, onSec * 1000);

                }, intervalSec * 1000);
            }

            if (immediate) {
                setMixCamOverlay(true);
                mixCamOffTimerId = setTimeout(() => {
                    setMixCamOverlay(false);
                    scheduleNextOn(); // ONが終わったら周期カウント開始
                }, onSec * 1000);
            } else {
                setMixCamOverlay(false);
                scheduleNextOn();
            }
        }

        // 初期値
        if (!('mixCamOverlayOn' in window)) {
            window.mixCamOverlayOn = !!(mixCamMasterChk && mixCamMasterChk.checked);
        }

        if (mixCamMasterChk) {
            mixCamMasterChk.addEventListener('change', () => {
                if (mixCamMasterChk.checked) {
                    restartMixCamAuto();
                } else {
                    clearMixCamTimers();
                    setMixCamOverlay(false);
                }
            });
        }

        if (mixCamIntervalInput) {
            mixCamIntervalInput.addEventListener('input', () => {
                if (mixCamMasterChk?.checked) {
                    restartMixCamAuto();
                }
            });
        }
        if (mixCamOnInput) {
            mixCamOnInput.addEventListener('input', () => {
                if (mixCamMasterChk?.checked) {
                    restartMixCamAuto();
                }
            });
        }

        // ページ離脱時にタイマー掃除
        window.addEventListener('beforeunload', () => {
            clearMixCamTimers();
        });

        // 初期状態がONなら、インターバル開始
        if (mixCamMasterChk && mixCamMasterChk.checked) {
            restartMixCamAuto(false);
        } else {
            setMixCamOverlay(false);
        }

    })();

    function resizeresult2ToEffect() {
        if (!result1 || !result2) return;
        if (result1.width && result1.height) {
            result2.width = result1.width;
            result2.height = result1.height;
        }
        result1NoCoords.width = result1.width;
        result1NoCoords.height = result1.height;

        if (ctx3) ctx3.imageSmoothingEnabled = false;
        if (ctxNoCoords) ctxNoCoords.imageSmoothingEnabled = false;
    }

    // --- 平滑化（3x3 ボックス）を n 回 ---
    function smoothDensities(dens, cols, rows, iters = 1) {
        if (iters <= 0) return dens;
        let cur = ensureScratchMatrix(smoothScratchA, rows, cols);
        for (let r = 0; r < rows; r++) {
            const srcRow = dens[r];
            const dstRow = cur[r];
            for (let c = 0; c < cols; c++) {
                dstRow[c] = srcRow[c];
            }
        }
        let nxt = ensureScratchMatrix(smoothScratchB, rows, cols);
        for (let k = 0; k < iters; k++) {
            for (let r = 0; r < rows; r++) {
                const nxtRow = nxt[r];
                for (let c = 0; c < cols; c++) {
                    let acc = 0, cnt = 0;
                    for (let rr = r - 1; rr <= r + 1; rr++) {
                        for (let cc = c - 1; cc <= c + 1; cc++) {
                            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { acc += cur[rr][cc]; cnt++; }
                        }
                    }
                    nxtRow[c] = acc / cnt;
                }
            }
            const tmp = cur;
            cur = nxt;
            nxt = tmp;
        }
        return cur;
    }

    // --- “ゼロ領域への距離場” ---
    function distanceFieldFromZeros(dens, cols, rows, threshold = 1e-6) {
        const INF = 1e9;
        const D = ensureScratchMatrix(distanceScratch, rows, cols, INF);
        for (let r = 0; r < rows; r++) {
            const row = D[r];
            const densRow = dens[r];
            for (let c = 0; c < cols; c++) {
                row[c] = densRow[c] <= threshold ? 0 : INF;
            }
        }
        // forward
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (r > 0) D[r][c] = Math.min(D[r][c], D[r - 1][c] + 1);
            if (c > 0) D[r][c] = Math.min(D[r][c], D[r][c - 1] + 1);
            if (r > 0 && c > 0) D[r][c] = Math.min(D[r][c], D[r - 1][c - 1] + 1.4142);
            if (r > 0 && c < cols - 1) D[r][c] = Math.min(D[r][c], D[r - 1][c + 1] + 1.4142);
        }
        // backward
        for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
            if (r < rows - 1) D[r][c] = Math.min(D[r][c], D[r + 1][c] + 1);
            if (c < cols - 1) D[r][c] = Math.min(D[r][c], D[r][c + 1] + 1);
            if (r < rows - 1 && c < cols - 1) D[r][c] = Math.min(D[r][c], D[r + 1][c + 1] + 1.4142);
            if (r < rows - 1 && c > 0) D[r][c] = Math.min(D[r][c], D[r + 1][c - 1] + 1.4142);
        }
        // 正規化 [0,1]
        let max = 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (D[r][c] < INF && D[r][c] > max) max = D[r][c];
        }
        const out = ensureScratchMatrix(distanceOutScratch, rows, cols);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            out[r][c] = (D[r][c] < INF) ? (D[r][c] / (max || 1)) : 1;
        }
        return out;
    }

    // --- v = -∇ρ ---
    function computeVectorFieldFromDensities(dens, cols, rows, emphasizeGamma = 0) {
        const vx = ensureScratchMatrix(vectorScratchVX, rows, cols);
        const vy = ensureScratchMatrix(vectorScratchVY, rows, cols);

        let rmin = 1, rmax = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = dens[r][c];
                if (v < rmin) rmin = v;
                if (v > rmax) rmax = v;
            }
        }
        const range = (rmax - rmin) || 1;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cm = Math.max(0, c - 1), cp = Math.min(cols - 1, c + 1);
                const rm = Math.max(0, r - 1), rp = Math.min(rows - 1, r + 1);

                const dρdx = (dens[r][cp] - dens[r][cm]) * 0.5;
                const dρdy = (dens[rp][c] - dens[rm][c]) * 0.5;

                let vx_ = -dρdx;
                let vy_ = -dρdy;

                if (emphasizeGamma > 0) {
                    const norm = (dens[r][c] - rmin) / range;
                    const wSink = Math.pow(1 - norm, emphasizeGamma);
                    const k = 0.5 + wSink;
                    vx_ *= k;
                    vy_ *= k;
                }

                vx[r][c] = vx_;
                vy[r][c] = vy_;
            }
        }

        return { vx, vy };
    }

    function computeVectorFieldEnhanced(dens, cols, rows, { smoothIters = 1, gamma = 1.2, alphaDist = 0.8 } = {}) {
        const densS = smoothDensities(dens, cols, rows, smoothIters);
        const { vx, vy } = computeVectorFieldFromDensities(densS, cols, rows, gamma);
        if (alphaDist > 0) {
            const DF = distanceFieldFromZeros(densS, cols, rows, 1e-6);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const cm = Math.max(0, c - 1), cp = Math.min(cols - 1, c + 1);
                const rm = Math.max(0, r - 1), rp = Math.min(rows - 1, r + 1);
                const dDx = (DF[r][cp] - DF[r][cm]) * 0.5;
                const dDy = (DF[rp][c] - DF[rm][c]) * 0.5;
                vx[r][c] += -alphaDist * dDx;
                vy[r][c] += -alphaDist * dDy;
            }
        }
        return { vx, vy };
    }

    // ベクトル描画
    function drawQuiver(ctx, vx, vy, cols, rows, cell, opt = {}) {
        const {
            scale = 1.0,
            color = "#ffffff",
            skip = 1,
            head = 4,
            lineWidth = 1.0,
            alpha = 1.0,
            cap = 'butt',
            join = 'miter',
            normalize = false
        } = opt;

        let vmax = 1e-6;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const m = Math.hypot(vx[r][c], vy[r][c]);
            if (m > vmax) vmax = m;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = cap;
        ctx.lineJoin = join;
        ctx.strokeStyle = color || 'rgb(255, 255, 255)';
        ctx.fillStyle = color || 'rgb(255, 255, 255)';

        for (let r = 0; r < rows; r += skip) {
            for (let c = 0; c < cols; c += skip) {
                let dx = vx[r][c], dy = vy[r][c];
                let len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;

                let L;
                if (normalize) {
                    dx /= len;
                    dy /= len;
                    L = cell * scale * 0.9;
                } else {
                    L = (len / vmax) * (cell * scale * 0.9);
                }

                const cx0 = c * cell + Math.min(cell, ctx.canvas.width - c * cell) / 2;
                const cy0 = r * cell + Math.min(cell, ctx.canvas.height - r * cell) / 2;

                const x2 = cx0 + dx * L;
                const y2 = cy0 + dy * L;

                ctx.beginPath();
                ctx.moveTo(cx0, cy0);
                ctx.lineTo(x2, y2);
                ctx.stroke();

                const ang = Math.atan2(dy, dx);
                const a1 = ang + Math.PI - Math.PI / 7;
                const a2 = ang + Math.PI + Math.PI / 7;
                const hx1 = x2 + Math.cos(a1) * head;
                const hy1 = y2 + Math.sin(a1) * head;
                const hx2 = x2 + Math.cos(a2) * head;
                const hy2 = y2 + Math.sin(a2) * head;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(hx1, hy1);
                ctx.lineTo(hx2, hy2);
                ctx.closePath();
                ctx.fill();
            }
        }

        ctx.restore();
    }

    function getMinMaxDensity(data) {
        let min = 1, max = 0;
        for (let r = 0; r < data.length; r++) {
            for (let c = 0; c < data[r].length; c++) {
                const d = data[r][c];
                if (d < min) min = d;
                if (d > max) max = d;
            }
        }
        if (min > max) min = max = 0;
        return { min, max };
    }

    // grid density 計算（result1NoCoords から）
    function computeDensitiesFromEffect(cell) {
        const w = result1NoCoords.width, h = result1NoCoords.height;
        if (!w || !h) {
            window.gridDensities = [];
            return { cols: 0, rows: 0, data: [] };
        }

        const src = (ctxNoCoords.getImageData(0, 0, w, h)).data;
        const cols = Math.ceil(w / cell);
        const rows = Math.ceil(h / cell);

        const densities = new Array(rows);
        const tol2 = Math.pow(255 * (TOLERANCE_PERCENT / 100), 2);
        const STEP = Math.max(1, Math.floor((grid3Tol || 1) / 8));

        for (let r = 0; r < rows; r++) {
            densities[r] = new Array(cols).fill(0);
            for (let c = 0; c < cols; c++) {
                const x0 = c * cell, y0 = r * cell;
                const x1 = Math.min(x0 + cell, w), y1 = Math.min(y0 + cell, h);
                let total = 0, painted = 0;
                for (let y = y0; y < y1; y += STEP) {
                    let idx = (y * w + x0) * 4;
                    for (let x = x0; x < x1; x += STEP) {
                        const r0 = src[idx], g0 = src[idx + 1], b0 = src[idx + 2], a0 = src[idx + 3];
                        if (a0 > 0 && dist2ToAnyPickedColor(r0, g0, b0) <= tol2) painted++;
                        total++;
                        idx += 4 * STEP;
                    }
                }
                densities[r][c] = total ? (painted / total) : 0;
            }
        }

        window.gridDensities = densities;

        return { cols, rows, data: densities };
    }

    // ======= Ticker 帯描画 =======
    function appendCoordsToResult2Ticker(infoArr) {
        if (!Array.isArray(infoArr)) return;

        for (const info of infoArr) {
            let tms = '';
            if (info.time instanceof Date) tms = String(info.time.getTime());
            else if (typeof info.time === 'string') tms = info.time;
            const key = `${info.x},${info.y},${tms}`;
            if (result2TickerKeySet.has(key)) continue;

            let timeStr = '';
            if (info.time instanceof Date) {
                const M = (info.time.getMonth() + 1).toString().padStart(2, '0');
                const D = info.time.getDate().toString().padStart(2, '0');
                const h = info.time.getHours().toString().padStart(2, '0');
                const m = info.time.getMinutes().toString().padStart(2, '0');
                timeStr = `${M}/${D} ${h}:${m}`;
            } else if (typeof info.time === 'string') {
                timeStr = info.time;
            }

            const color = (Array.isArray(pickedColor) && pickedColor.length === 3)
                ? `rgb(${pickedColor[0]},${pickedColor[1]},${pickedColor[2]})`
                : '#fff';

            result2TickerEntries.push({ text: `${timeStr} (${info.x},${info.y})`, color });
            result2TickerKeySet.add(key);
        }

        const MAX_ITEMS = 400;
        if (result2TickerEntries.length > MAX_ITEMS) {
            const overflow = result2TickerEntries.length - MAX_ITEMS;
            result2TickerEntries.splice(0, overflow);
            result2TickerKeySet = new Set(result2TickerEntries.map(e => e.text));
        }
    }

    function replaceCoordsToResult2Ticker(infoArr) {
        result2TickerEntries = [];
        result2TickerKeySet.clear();
        appendCoordsToResult2Ticker(infoArr || []);
    }

    function clearResult2Ticker() {
        replaceCoordsToResult2Ticker([]);
    }

    function drawResult2TickerBar(ctx2) {
        const W = ctx2.canvas.width;
        const H = ctx2.canvas.height;
        const barHeight = Math.max(26, Math.floor(H * 0.095));
        const marginY = 0;
        const marginX = 34;
        const scrollSpeed = 70; // px/sec

        const px = Math.max(16, Math.floor(barHeight * 0.6));
        ctx2.save();
        ctx2.setTransform(1, 0, 0, 1, 0, 0);
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.imageSmoothingEnabled = false;

        ctx2.globalAlpha = 0.68;
        ctx2.fillStyle = '#1d1e2180';
        ctx2.fillRect(0, marginY, W, barHeight);
        ctx2.globalAlpha = 1;

        if (!result2TickerEntries.length) {
            ctx2.restore();
            return;
        }

        ctx2.font = `400 ${px}px "Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans JP",sans-serif`;
        ctx2.textBaseline = 'middle';
        ctx2.textAlign = 'left';

        let totalLen = 0;
        const perEntryWidths = [];
        for (const entry of result2TickerEntries) {
            const w = ctx2.measureText(entry.text).width + marginX;
            perEntryWidths.push(w);
            totalLen += w;
        }

        if (typeof drawResult2TickerBar._tickerStart === 'undefined' || result2TickerAnimRafId == null) {
            drawResult2TickerBar._tickerStart = Date.now();
        }
        const tickerStart = drawResult2TickerBar._tickerStart;
        const elapsedSec = (Date.now() - tickerStart) / 1000;
        let offset = scrollSpeed * elapsedSec;
        if (totalLen < W) offset = 0;

        let drawX = W - offset;
        const loops = totalLen > 0 ? Math.ceil((W + offset) / totalLen) + 1 : 1;

        for (let loop = 0; loop < loops; loop++) {
            for (let i = 0; i < result2TickerEntries.length; i++) {
                const entry = result2TickerEntries[i];

                ctx2.save();
                ctx2.shadowColor = 'rgba(0,0,0,0.5)';
                ctx2.shadowBlur = 2;

                ctx2.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx2.lineWidth = 3.0;
                ctx2.globalAlpha = 1;
                ctx2.strokeText(entry.text, drawX, barHeight / 2 + marginY);

                ctx2.globalAlpha = 0.96;
                ctx2.fillStyle = '#000';
                ctx2.fillText(entry.text, drawX, barHeight / 2 + marginY);

                ctx2.restore();

                drawX += perEntryWidths[i];
            }
        }

        ctx2.restore();
    }

    function updateresult2_inner() {
        if (!result2 || !ctx3 || !result1 || !result1.width) return;

        const showResult1 = $('showResult1')?.checked ?? true;

        ctx3.save();
        ctx3.setTransform(1, 0, 0, 1, 0, 0);
        ctx3.clearRect(0, 0, result2.width, result2.height);
        if (showResult1 && result1 && result1.width) {
            ctx3.drawImage(result1, 0, 0);
        }
        ctx3.restore();

        const grid3ShowChk = $('grid3Show');
        const grid3ShowPercentChk = $('grid3ShowPercent');
        const grid3ShowHeatChk = $('grid3ShowHeat');

        const { cols, rows, data } = pickedColors.length
            ? computeDensitiesFromEffect(grid3Size)
            : (() => {
                const cols = Math.ceil(result2.width / grid3Size);
                const rows = Math.ceil(result2.height / grid3Size);
                return { cols, rows, data: Array.from({ length: rows }, () => Array(cols).fill(0)) };
            })();

        const { min: densityMin, max: densityMax } = getMinMaxDensity(data);

        if (grid3ShowHeatChk?.checked) {
            ctx3.save();
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const d = data[r][c];
                    ctx3.globalAlpha = 0.5;
                    let norm = 0.5;
                    if (densityMax > densityMin) {
                        norm = (d - densityMin) / (densityMax - densityMin);
                        norm = Math.max(0, Math.min(1, norm));
                    } else if (densityMax > 0) {
                        norm = d / densityMax;
                        norm = Math.max(0, Math.min(1, norm));
                    } else {
                        norm = 0;
                    }
                    if (norm <= 0) {
                        ctx3.fillStyle = "#0033cc";
                    } else if (norm < 0.5) {
                        const f = norm / 0.5;
                        const r0 = Math.round(0x00 + (0x80 - 0x00) * f);
                        const g0 = Math.round(0x33 + (0x00 - 0x33) * f);
                        const b0 = Math.round(0xcc + (0x80 - 0xcc) * f);
                        ctx3.fillStyle = `rgb(${r0},${g0},${b0})`;
                    } else {
                        const f = (norm - 0.5) / 0.5;
                        const r0 = 0x80, g0 = 0x00, b0 = Math.round(0x80 + (0x20 - 0x80) * f);
                        ctx3.fillStyle = `rgb(${r0},${g0},${b0})`;
                    }
                    const x = c * grid3Size, y = r * grid3Size;
                    const w = Math.min(grid3Size, result2.width - x);
                    const h = Math.min(grid3Size, result2.height - y);
                    ctx3.fillRect(x, y, w, h);
                }
            }
            ctx3.restore();
        }

        if (grid3ShowPercentChk?.checked) {
            ctx3.save();
            ctx3.font = `${Math.max(10, Math.floor(grid3Size * 0.35))}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;
            ctx3.fillStyle = '#fff';
            ctx3.textAlign = 'center';
            ctx3.textBaseline = 'middle';
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const d = data[r][c];
                    const x = c * grid3Size, y = r * grid3Size;
                    const cx0 = x + Math.min(grid3Size, result2.width - x) / 2;
                    const cy0 = y + Math.min(grid3Size, result2.height - y) / 2;
                    ctx3.strokeStyle = 'rgba(0,0,0,0.65)';
                    ctx3.lineWidth = 3;
                    const text = `${Math.round(d * 100)}%`;
                    ctx3.strokeText(text, cx0, cy0);
                    ctx3.fillText(text, cx0, cy0);
                }
            }
            ctx3.restore();
        }

        const grid3ShowChk2 = $('grid3Show');
        if (grid3ShowChk2?.checked) {
            ctx3.save();
            ctx3.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx3.lineWidth = 1;
            for (let y = 0; y <= result2.height; y += grid3Size) {
                ctx3.beginPath();
                ctx3.moveTo(0, y + 0.5);
                ctx3.lineTo(result2.width, y + 0.5);
                ctx3.stroke();
            }
            for (let x = 0; x <= result2.width; x += grid3Size) {
                if (x === 0) continue;
                ctx3.beginPath();
                ctx3.moveTo(x + 0.5, 0);
                ctx3.lineTo(x + 0.5, result2.height);
                ctx3.stroke();
            }
            ctx3.restore();
        }

        const vecShow = $('vecShow');
        if (vecShow?.checked && pickedColors.length) {
            const dens = data, cols2 = cols, rows2 = rows;

            const scale = parseFloat(($('vecScale')?.value) || '0.8');
            const gamma = parseFloat(($('vecGamma')?.value) || '0');
            let smoothIters = $('smoothIters');
            const vecSmoothInput = $('vecSmooth');
            if (vecSmoothInput) {
                smoothIters = Math.max(0, parseInt(vecSmoothInput.value, 10) || 1);
                const smoothItersLabel = $('smoothIters');
                if (smoothItersLabel) smoothItersLabel.textContent = vecSmoothInput.value;
            }

            const { vx, vy } = computeVectorFieldEnhanced(dens, cols2, rows2, {
                smoothIters,
                gamma,
                alphaDist: 0.8
            });

            drawQuiver(ctx3, vx, vy, cols2, rows2, grid3Size, {
                scale,
                color: $('vecColor')?.value || undefined,
                head: Math.max(3, Math.floor(grid3Size * 0.24)),
                lineWidth: parseFloat($('vecLine')?.value || '1.5'),
                alpha: parseFloat($('vecAlpha')?.value || '0.95'),
                normalize: $('vecNormalize')?.checked || false,
                cap: 'round',
                join: 'round'
            });
        }
    }

    function updateresult2() {
        if (!result2 || !ctx3) return;
        updateresult2_inner();
        if (window.showResult2TickerBarVisible) {
            drawResult2TickerBar(ctx3);
        }
        // ミックス映像のフェード状態も更新
        if (typeof window.drawMixOnTop === 'function') {
            window.drawMixOnTop();
        }
    }

    function drawMixOnTop() {
        let FADE_DURATION = 5000;
        const fadeDurationElem = document.getElementById('fadeDuration');
        if (fadeDurationElem) {
            let val = fadeDurationElem.value.trim();
            if (/^\d+(\.\d+)?$/.test(val)) {
                const sec = parseFloat(val);
                if (Number.isFinite(sec) && sec > 0) {
                    FADE_DURATION = sec * 1000;
                }
            }
        }
        if (typeof window.drawMixOnTopFade === "undefined") {
            window.drawMixOnTopFade = {
                alpha: 0,
                lastShow: false,
                animating: false,
                targetAlpha: 0,
                startTime: 0
            };
        }

        const fade = window.drawMixOnTopFade;

        // マスター（showMixCam）と、自動ループで決まる overlay フラグを両方見る
        const showMixCamMaster = $('showMixCam')?.checked ?? false;
        const overlayOn = !!window.mixCamOverlayOn;
        const logicalShow = showMixCamMaster && overlayOn;

        // 状態が変わったらフェード開始
        if (logicalShow !== fade.lastShow) {
            fade.startTime = performance.now();
            fade.animating = true;
            fade.targetAlpha = logicalShow ? 1 : 0;
            fade.startAlpha = fade.alpha;
            fade.lastShow = logicalShow;
        }

        if (fade.animating) {
            const now = performance.now();
            const elapsed = Math.min(FADE_DURATION, now - fade.startTime);
            const t = Math.max(0, Math.min(1, elapsed / FADE_DURATION));
            fade.alpha = fade.startAlpha + (fade.targetAlpha - fade.startAlpha) * t;
            if (elapsed >= FADE_DURATION) {
                fade.alpha = fade.targetAlpha;
                fade.animating = false;
            }
        }

        // 完全OFF状態なら何も描かない
        if (!logicalShow && fade.alpha <= 0.01) return;
        if (!ctx3 || !result2) return;

        ctx3.save();
        ctx3.globalAlpha = fade.alpha;
        // mixwebcam 側のソースを result2 全体に描画
        drawSourceTo(ctx3, 0, 0, result2.width, result2.height);
        ctx3.restore();

        // フェード途中なら次フレームも更新
        if (fade.animating) {
            requestAnimationFrame(drawMixOnTop);
        }
    }

    function startResult2TickerAnim() {
        if (result2TickerAnimRafId != null) return;
        const loop = () => {
            if (!ctx3 || !result2) return;
            updateresult2_inner();
            if (window.showResult2TickerBarVisible) {
                drawResult2TickerBar(ctx3);
            }
            // ミックス映像フェードも更新
            drawMixOnTop();
            result2TickerAnimRafId = requestAnimationFrame(loop);
        };
        result2TickerAnimRafId = requestAnimationFrame(loop);
    }

    function stopResult2TickerAnim() {
        if (result2TickerAnimRafId != null) {
            cancelAnimationFrame(result2TickerAnimRafId);
            result2TickerAnimRafId = null;
        }
    }

    // ====== コア側から使う関数を window に公開 ======
    window.resizeresult2ToEffect = resizeresult2ToEffect;
    window.updateresult2 = updateresult2;
    window.appendCoordsToResult2Ticker = appendCoordsToResult2Ticker;
    window.clearResult2Ticker = clearResult2Ticker;
    window.startResult2TickerAnim = startResult2TickerAnim;
    window.stopResult2TickerAnim = stopResult2TickerAnim;
    window.drawMixOnTop = drawMixOnTop; // 必要なら他からも使えるように

})();