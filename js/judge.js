//~12/20
// (function () {
//     // ==============================
//     // 共有定数・しきい値
//     // ==============================
//     const STATE_LEVELS = ["優", "良好", "注意", "あく", "危険"];
//     window.GARDEN_STATE_LEVELS = STATE_LEVELS;

//     // bias からランクに変換するしきい値（σ / range 用）
//     window.gardenJudgeThresholds = window.gardenJudgeThresholds || {
//         bias2state: [0.15, 0.20, 0.25, 0.3]
//     };

//     // 停滞判定用の設定（Δ揺らぎの平均から停滞/非停滞を決める）
//     // ★ここは「今のまま」維持
//     window.gardenStagnationConfig = window.gardenStagnationConfig || {
//         // temporal_change (分布変化量: 0〜1) がこの範囲なら「停滞」
//         stagnationRange: [0.0, 0.4],
//         framesPerStep: 2
//     };

//     // 判定用バッファ & 直前状態
//     window.__gardenGridBuffer = window.__gardenGridBuffer || [];
//     window.__gardenStateLast = window.__gardenStateLast || null;

//     // 連続停滞カウンタ（スナップショット単位）
//     window.__gardenStagnationCount = window.__gardenStagnationCount || 0;

//     // ==============================
//     // バッファ管理
//     // ==============================
//     function pushGardenGridSample(grid) {
//         if (!grid || !grid.length) return;
//         const copy = grid.map(r => r.slice());
//         window.__gardenGridBuffer.push(copy);

//         const MAX_BUFFER = 10;
//         if (window.__gardenGridBuffer.length > MAX_BUFFER) {
//             window.__gardenGridBuffer.splice(
//                 0,
//                 window.__gardenGridBuffer.length - MAX_BUFFER
//             );
//         }
//     }

//     // ==============================
//     // 状態平滑化
//     // ==============================
//     function decideGardenState(current) {
//         if (!window.__gardenStateLast) {
//             window.__gardenStateLast = current;
//             return current;
//         }

//         const prev = window.__gardenStateLast;
//         const curIdx = STATE_LEVELS.indexOf(current);
//         const prevIdx = STATE_LEVELS.indexOf(prev);

//         if (curIdx < 0 || prevIdx < 0) {
//             window.__gardenStateLast = current;
//             return current;
//         }

//         // ---- ① 改善の場合、一気に良くなっていい ----
//         if (curIdx < prevIdx) {
//             window.__gardenStateLast = current;
//             return current;
//         }

//         // ---- ② 悪化の場合、2段以上のジャンプは 1段に抑える ----
//         if (curIdx - prevIdx > 1) {
//             const stepUpIdx = prevIdx + 1;
//             const stepUp = STATE_LEVELS[Math.min(stepUpIdx, STATE_LEVELS.length - 1)];
//             window.__gardenStateLast = stepUp;
//             return stepUp;
//         }

//         // ---- ③ それ以外（変化なし / 1段だけ悪化）などはそのまま ----
//         window.__gardenStateLast = current;
//         return current;
//     }

//     // ==============================
//     // 分布化ヘルパー（スケールを捨てる）
//     // ==============================
//     function normalizeGridToProb(grid) {
//         const rows = grid.length;
//         const cols = grid[0]?.length || 0;
//         const prob = [];
//         if (!rows || !cols) return prob;

//         let sum = 0;
//         for (let r = 0; r < rows; r++) {
//             for (let c = 0; c < cols; c++) {
//                 const v = Math.max(0, grid[r][c] || 0);
//                 sum += v;
//             }
//         }

//         const N = rows * cols;
//         const base = sum > 0 ? 0 : 1 / N;  // sum=0 のときは一様分布

//         for (let r = 0; r < rows; r++) {
//             prob[r] = [];
//             for (let c = 0; c < cols; c++) {
//                 if (sum > 0) {
//                     const v = Math.max(0, grid[r][c] || 0);
//                     prob[r][c] = v / sum;
//                 } else {
//                     prob[r][c] = base;
//                 }
//             }
//         }
//         return prob;
//     }

//     // p1, p2 は normalizeGridToProb の結果を想定
//     // トータルバリエーション距離 (0〜1) を計算
//     function totalVariationDistance(p1, p2) {
//         const rows = Math.min(p1.length, p2.length);
//         if (!rows) return 0;
//         const cols = Math.min(p1[0].length, p2[0].length);
//         if (!cols) return 0;

//         let sumAbs = 0;
//         for (let r = 0; r < rows; r++) {
//             for (let c = 0; c < cols; c++) {
//                 const a = p1[r][c] || 0;
//                 const b = p2[r][c] || 0;
//                 sumAbs += Math.abs(a - b);
//             }
//         }
//         // TV距離は (1/2) * L1ノルム
//         return 0.5 * sumAbs; // 0〜1
//     }

//     // ==============================
//     // bias / change  [優〜危険]
//     // ==============================
//     function judgeStateWithDetails(latestGrid, gridsArr) {
//         const th = window.gardenJudgeThresholds || {
//             bias2state: [0.10, 0.15, 0.20, 0.25]
//         };

//         // 1) 空間的バイアス（その場のムラ）: σ / レンジ
//         let vals = [];
//         let gmax = -Infinity, gmin = Infinity;
//         for (let r = 0; r < latestGrid.length; r++) {
//             for (let c = 0; c < latestGrid[0].length; c++) {
//                 const v = latestGrid[r][c];
//                 vals.push(v);
//                 if (v > gmax) gmax = v;
//                 if (v < gmin) gmin = v;
//             }
//         }
//         const N = vals.length || 1;
//         const mean = vals.reduce((a, b) => a + b, 0) / N;
//         const var_ = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / N;
//         const stdev = Math.sqrt(var_);
//         const range = Math.max(1e-9, gmax - gmin);
//         const bias_disp = stdev / range;  // 0〜1 程度の値を想定

//         // 2) 時間的変化（分布の形の変化）：連続フレームの TV 距離の平均
//         // ★ここは「今の judge.js のまま」維持
//         const arr = (gridsArr && gridsArr.length ? gridsArr : [latestGrid]);

//         let temporal_change = 0;
//         if (arr.length >= 2) {
//             // 各フレームを分布に正規化
//             const probArr = arr.map(g => normalizeGridToProb(g));

//             let sumTv = 0;
//             let pairCount = 0;
//             for (let i = 1; i < probArr.length; i++) {
//                 const tv = totalVariationDistance(probArr[i - 1], probArr[i]); // 0〜1
//                 sumTv += tv;
//                 pairCount++;
//             }
//             temporal_change = pairCount ? (sumTv / pairCount) : 0; // 0〜1
//         }

//         function rankFromBias(d) {
//             if (d < th.bias2state[0]) return 0;
//             if (d < th.bias2state[1]) return 1;
//             if (d < th.bias2state[2]) return 2;
//             if (d < th.bias2state[3]) return 3;
//             return 4;
//         }

//         const bias_rank = rankFromBias(bias_disp);

//         // 状態のベースは「空間偏り」だけで決める
//         const combined_rank = bias_rank;
//         const state = STATE_LEVELS[Math.max(0, Math.min(4, combined_rank))];

//         // 停滞判定（Δ揺らぎの平均を使う）★条件は今のまま
//         const stCfg = window.gardenStagnationConfig || { stagnationRange: [0, 0.15] };
//         const [stLow, stHigh] = stCfg.stagnationRange;
//         const isStagnating = (temporal_change >= stLow && temporal_change <= stHigh);

//         return {
//             state,                 // ベース状態（biasのみで決定）
//             avg_density: mean,     // 最新グリッドの平均密度
//             bias: bias_disp,       // 空間ムラ（σ/レンジ）
//             change: temporal_change,  // 揺らぎ量（TV距離ベース）
//             bias_rank,
//             combined_rank,         // 表示用：bias_rank と同じ
//             isStagnating,          // 停滞フラグ
//             reason: ""             // 必要になったらここに説明文を入れる
//         };
//     }

//     // bias_rank からベース状態を取り出すヘルパー（一応用意）
//     function baseStateFromBiasRank(bias_rank) {
//         const idx = Math.max(0, Math.min(4, bias_rank | 0));
//         return {
//             index: idx,
//             state: STATE_LEVELS[idx]
//         };
//     }

//     // ==============================
//     // メイン：densityGrid から currentGardenJudgeContext を更新
//     // ==============================
//     window.updateGardenStateFromGrid = function (densityGrid) {
//         if (!densityGrid || !densityGrid.length) return;

//         // バッファに追加
//         pushGardenGridSample(densityGrid);

//         const usedGrids = window.__gardenGridBuffer.slice();
//         const usedCount = usedGrids.length;
//         const latestGrid = usedGrids[usedGrids.length - 1];

//         const judge = judgeStateWithDetails(latestGrid, usedGrids);

//         // ==== 停滞カウントの更新 ====
//         const stCfg = window.gardenStagnationConfig || {};
//         const judgePerStep = stCfg.framesPerStep ?? 3;   // 「何回の停滞判定で1段階悪化させるか」
//         const snapsPerJudge = window.gardenAnnounceEverySnapshots || 1; // 1判定に使うスナップショット数

//         if (judge.isStagnating) {
//             // スナップショット単位でカウント
//             window.__gardenStagnationCount = (window.__gardenStagnationCount || 0) + 1;
//         } else {
//             // 非停滞が来たらリセット → 空間偏りの純粋な判定に戻る
//             window.__gardenStagnationCount = 0;
//         }

//         const stagnationCount = window.__gardenStagnationCount || 0;

//         // スナップショット数 → 「停滞判定回数」に変換
//         const stagnationJudgeCount = Math.floor(stagnationCount / snapsPerJudge);

//         // ==== まずは「空間偏り」だけからベース状態を決める ====
//         const base = baseStateFromBiasRank(judge.bias_rank);
//         let baseIndex = base.index;

//         // ==== 停滞「判定回数」に応じて 1 段階ずつ悪化 ====
//         const penaltySteps = Math.floor(stagnationJudgeCount / judgePerStep);
//         let penalizedIndex = baseIndex + penaltySteps;
//         if (penalizedIndex > 4) penalizedIndex = 4;
//         if (penalizedIndex < 0) penalizedIndex = 0;

//         // ペナルティ込み状態に「ならしロジック」をかけて最終状態を決定
//         const penalizedState = STATE_LEVELS[penalizedIndex];
//         const finalState = decideGardenState(penalizedState);
//         const atISO = new Date().toISOString();

//         // announce.js から参照するコンテキスト
//         window.currentGardenJudgeContext = {
//             judge,
//             state: finalState,
//             rawState: finalState,
//             finalState: finalState,
//             usedCount,
//             latestGrid,
//             usedGrids,
//             stagnationCount,   // スナップショットとしての連続停滞回数（メタ表示用）
//             at: atISO
//         };
//     };

//     // 他からも使えるように公開
//     window.pushGardenGridSample = pushGardenGridSample;
//     window.judgeStateWithDetails = judgeStateWithDetails;
//     window.decideGardenState = decideGardenState;

//     // ==============================
//     // メタ表示（announce.js から呼ぶ）
//     // ==============================
//     function renderGardenAnnounceMeta({
//         judge,
//         state,
//         rawState,
//         finalState,
//         usedCount,
//         // thresholds,    // ← adaptive しきい値は使わないので削除
//         prevState,
//         atISO
//     }) {
//         const el = document.getElementById('garden-announce-meta');
//         if (!el) return;

//         // 今の固定しきい値をそのまま表示
//         const biasThresholds =
//             (window.gardenJudgeThresholds || {}).bias2state || [];

//         const biasStr = (judge?.bias != null) ? judge.bias.toFixed(3) : "-";
//         const changeStr = (judge?.change != null) ? judge.change.toFixed(3) : "-";
//         const stCount = window.__gardenStagnationCount || 0;

//         // state / finalState / rawState のどれかに値が入っていればそれを表示
//         const displayState = state ?? finalState ?? rawState ?? "-";

//         const S = (i) => (STATE_LEVELS?.[i] ?? "-");

//         const html = `
//           <div class="gameta">
//             <div class="gameta__row">
//               <b>直前状態</b>：<code>${prevState ?? "(なし)"}</code> /
//               <b>使用枚数</b>：<code>${usedCount}</code> 枚 /
//               <b>時刻</b>：<code>${atISO}</code>
//             </div>

//             <details class="gameta__details" open>
//               <summary>詳細指標</summary>
//               <table class="gameta__table">
//                 <tbody>
//                   <tr>
//                     <th>結果</th>
//                     <td colspan="2">
//                         状態：
//                         <span><b><code>${displayState}</code></b></span>
//                     </td>
//                   </tr>
//                   <tr>
//                     <th>空間偏り（σ/レンジ）</th>
//                     <td><code>${biasStr}</code></td>
//                     <td>ランク：<b>${S(judge?.bias_rank)}</b> <small>(index=${judge?.bias_rank ?? "-"})</small></td>
//                   </tr>
//                   <tr>
//                     <th>変化量（分布変化 / TV距離）</th>
//                     <td><code>${changeStr}</code></td>
//                     <td> <code>${judge?.isStagnating ? "停滞中" : "非停滞"}</code>
//                       （<code>${Math.floor(stCount / (window.gardenStagnationConfig?.framesPerStep ?? 1))}</code>連続中）</td>
//                   </tr>
//                   <tr>
//                     <th>bias しきい値</th>
//                     <td colspan="2">
//                       <code>[${biasThresholds.map(v => v.toFixed(3)).join(", ")}]</code>
//                     </td>
//                   </tr>
//                 </tbody>
//               </table>
//               <div class="gameta__reason">${(judge?.reason ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</div>
//             </details>

//             <details class="gameta__details">
//               <summary>結果の出力設定</summary>
//               <ul class="gameta__list">
//                 <li>悪化は1段づつレベル変化に抑制、良化は即時反映</li>
//                 <li>停滞ペナルティ：<code>${(window.gardenStagnationConfig?.framesPerStep) ?? ""}</code> 回の停滞判定ごとに1段階悪化</li>
//               </ul>
//             </details>
//           </div>
//         `;

//         el.innerHTML = html;
//     }
//     window.renderGardenAnnounceMeta = renderGardenAnnounceMeta;

//     // ---- メタ用 CSS ----
//     (function injectGaMetaCss() {
//         if (document.getElementById('ga-meta-css')) return;
//         const css = `
//         .gameta { font: 14px/1.6 system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif; }
//         .gameta__row { margin: .25rem 0; }
//         .gameta__badge { display:inline-block; padding:.12rem .5rem; border-radius:.5rem; background:#eefaff; border:1px solid #b7dff0; }
//         .gameta--raw { background:#fff7e6; border-color:#ffd58a; }
//         .gameta--final { background:#e8fff0; border-color:#9fe0b9; }
//         .gameta__arrow { margin: 0 .35rem; color:#999; }
//         .gameta__details { margin:.25rem 0; }
//         .gameta__table { width:100%; border-collapse:collapse; margin:.25rem 0; }
//         .gameta__table th, .gameta__table td { padding:.25rem .5rem; border-bottom:1px dashed #cfe8f5; text-align:left; }
//         .gameta__reason { margin-top:.25rem; color:#333; }
//         .gameta__list { margin:.25rem 0 .25rem 1rem; }
//         summary { cursor:pointer; }
//         code { background:#f6f8fa; padding:.05rem .3rem; border-radius:.25rem; }
//       `;
//         const s = document.createElement('style');
//         s.id = 'ga-meta-css';
//         s.textContent = css;
//         document.head.appendChild(s);
//     })();

//     // ==============================
//     // グリッド描画（announce から共用）
//     // ==============================
//     function drawDensityGrid(grid, containerId, judgeInfo = null) {
//         const el = document.getElementById(containerId);
//         if (!el) return;
//         if (el.tagName.toLowerCase() === 'canvas') {
//             drawToCanvasGridWithJudge(el, grid, judgeInfo);
//             return;
//         }
//     }

//     function drawToCanvasGridWithJudge(canvas, g, judgeInfo = null) {
//         canvas.style.display = "block";
//         canvas.style.width = "100%";
//         canvas.style.height = "auto";
//         canvas.style.aspectRatio = "16 / 9";
//         canvas.style.borderRadius = "0.2rem";

//         const ROWS = g.length;
//         const COLS = g[0].length;

//         const rect = canvas.getBoundingClientRect();
//         let cssW = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
//         let cssH = Math.floor(cssW * 9 / 16);
//         if (cssH < Math.floor(cssW * (ROWS / COLS))) cssH = Math.floor(cssW * (ROWS / COLS));
//         if (cssH < 1) cssH = 1;
//         const dpr = window.devicePixelRatio || 1;
//         const pixW = Math.floor(cssW * dpr);
//         const pixH = Math.floor(cssH * dpr);

//         if (canvas.width !== pixW || canvas.height !== pixH) {
//             canvas.width = pixW;
//             canvas.height = pixH;
//         }

//         const ctx = canvas.getContext("2d");
//         ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
//         ctx.clearRect(0, 0, cssW, cssH);

//         let cellW = cssW / COLS;
//         let cellH = cssH / ROWS;
//         let offsetX = 0, offsetY = 0;
//         if (cellW > cellH) {
//             cellW = cellH;
//             offsetX = (cssW - cellW * COLS) / 2;
//         } else if (cellH > cellW) {
//             cellH = cellW;
//             offsetY = (cssH - cellH * ROWS) / 2;
//         }

//         ctx.textAlign = "center";
//         ctx.textBaseline = "middle";
//         ctx.font = `${Math.floor(Math.min(cellW, cellH) * 0.4)}px sans-serif`;

//         for (let r = 0; r < ROWS; r++) {
//             for (let c = 0; c < COLS; c++) {
//                 const v = Math.max(0, Math.min(1, g[r][c]));
//                 ctx.fillStyle = `rgba(${Math.round(245 - 140 * v)}, ${Math.round(246 - 160 * v)}, ${Math.round(243 - 90 * v)}, 1)`;
//                 ctx.fillRect(offsetX + c * cellW, offsetY + r * cellH, cellW, cellH);

//                 ctx.fillStyle = "#222";
//                 ctx.fillText(g[r][c].toFixed(2), offsetX + c * cellW + cellW / 2, offsetY + r * cellH + cellH / 2);
//             }
//         }

//         ctx.strokeStyle = "#bedeed";
//         ctx.lineWidth = 1;
//         for (let r = 0; r <= ROWS; r++) {
//             const y = offsetY + r * cellH;
//             ctx.beginPath();
//             ctx.moveTo(offsetX, y);
//             ctx.lineTo(offsetX + cellW * COLS, y);
//             ctx.stroke();
//         }
//         for (let c = 0; c <= COLS; c++) {
//             const x = offsetX + c * cellW;
//             ctx.beginPath();
//             ctx.moveTo(x, offsetY);
//             ctx.lineTo(x, offsetY + cellH * ROWS);
//             ctx.stroke();
//         }

//         if (judgeInfo) {
//             ctx.save();

//             ctx.textAlign = "left";
//             const titleFont = "bold 13px system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif";
//             const bodyFont = "12px system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif";
//             const titleColor = "#2677a1";
//             const bodyColor = "#333";

//             const padX = 12, padY = 10, gapTitleBody = 6;
//             const lineHTitle = 18, lineHBody = 18;
//             const boxMaxW = Math.min(cssW, 420);
//             const textMaxW = boxMaxW - padX - 10;

//             const titleText =
//                 `判定: ${judgeInfo.state}（Avg: ${judgeInfo.avg_density?.toFixed?.(3) ?? "-"} / Bias: ${judgeInfo.bias?.toFixed?.(3) ?? "-"})`;

//             const reasonText = (judgeInfo.reason || "");

//             function wrapLines(text, font, maxWidth) {
//                 ctx.font = font;
//                 const out = [];
//                 const words = [...text];
//                 let line = "";
//                 for (const ch of words) {
//                     const test = line + ch;
//                     if (ctx.measureText(test).width <= maxWidth) {
//                         line = test;
//                     } else {
//                         if (line) out.push(line);
//                         line = ch;
//                     }
//                 }
//                 if (line) out.push(line);
//                 return out;
//             }

//             const titleWidth = (ctx.font = titleFont, ctx.measureText(titleText).width);
//             const bodyLines = wrapLines(reasonText, bodyFont, textMaxW);

//             const boxW = Math.min(boxMaxW, Math.max(titleWidth + padX + 10, 220));
//             const contentH = lineHTitle + (bodyLines.length ? (gapTitleBody + bodyLines.length * lineHBody) : 0);
//             const boxH = Math.max(36, contentH + padY * 2);

//             const boxX = cssW - boxW - 14;
//             const boxY = cssH - boxH - 14;

//             ctx.globalAlpha = 0.92;
//             ctx.fillStyle = "#eefaff";
//             ctx.strokeStyle = "#2aa7d6";
//             ctx.lineWidth = 2;
//             if (ctx.roundRect) {
//                 ctx.beginPath();
//                 ctx.roundRect(boxX, boxY, boxW, boxH, 8);
//             } else {
//                 ctx.beginPath();
//                 ctx.rect(boxX, boxY, boxW, boxH);
//             }
//             ctx.fill();
//             ctx.stroke();

//             ctx.globalAlpha = 1;
//             ctx.textBaseline = "alphabetic";
//             const textX = boxX + padX;
//             let y = boxY + padY + lineHTitle * 0.8;

//             ctx.font = titleFont;
//             ctx.fillStyle = titleColor;
//             ctx.fillText(titleText, textX, y);

//             if (bodyLines.length) {
//                 y += gapTitleBody;
//                 ctx.font = bodyFont;
//                 ctx.fillStyle = bodyColor;
//                 for (const ln of bodyLines) {
//                     y += lineHBody;
//                     ctx.fillText(ln, textX, y);
//                 }
//             }

//             ctx.restore();
//         }
//     }

//     window.drawDensityGrid = drawDensityGrid;
// })();

//12/21
(function () {
  // ==============================
  // 共有定数・しきい値
  // ==============================
  const STATE_LEVELS = ["優", "良好", "注意", "あく", "危険"];
  window.GARDEN_STATE_LEVELS = STATE_LEVELS;

  // bias からランクに変換するしきい値（初期値：固定）
  // ※ adaptive が有効なら内部で随時更新される
  window.gardenJudgeThresholds = window.gardenJudgeThresholds || {
    bias2state: [0.1, 0.15, 0.2, 0.25],
  };

  // ==============================
  // ★追加：adaptive（状況に敏感にしきい値を動かす）
  // ==============================
  window.gardenAdaptiveThresholds = window.gardenAdaptiveThresholds || {
    enabled: true,
    window: 30, //小さいほど敏感（20〜40くらいが「バシバシ」）
    quantiles: [0.2, 0.4, 0.6, 0.8],
    emaAlpha: 0.8, //大きいほどバシバシ（0.5〜0.9）
    clamp: [0.02, 0.6], // 暴走防止
  };

  window.__gardenBiasHistory = window.__gardenBiasHistory || [];

  function pushBiasSample(bias) {
    if (!Number.isFinite(bias)) return;
    const hist = window.__gardenBiasHistory;
    hist.push(bias);
    const maxLen = window.gardenAdaptiveThresholds?.window ?? 20;
    if (hist.length > maxLen) hist.splice(0, hist.length - maxLen);
  }

  function quantile(sorted, q) {
    const n = sorted.length;
    if (!n) return 0;
    const pos = (n - 1) * q;
    const i = Math.floor(pos);
    const t = pos - i;
    const a = sorted[i];
    const b = sorted[Math.min(i + 1, n - 1)];
    return a + (b - a) * t;
  }

  function updateBiasThresholdsAdaptive() {
    const cfg = window.gardenAdaptiveThresholds;
    if (!cfg?.enabled) return;

    const hist = window.__gardenBiasHistory || [];
    if (hist.length < 5) return; // 少なすぎると不安定

    const sorted = hist.slice().sort((a, b) => a - b);
    const [mn, mx] = cfg.clamp || [0, 1];

    const qs = cfg.quantiles || [0.2, 0.4, 0.6, 0.8];
    const proposed = qs.map((q) => {
      const v = quantile(sorted, q);
      return Math.max(mn, Math.min(mx, v));
    });

    const thObj = (window.gardenJudgeThresholds =
      window.gardenJudgeThresholds || {});
    const prev = thObj.bias2state || proposed.slice();
    const a = cfg.emaAlpha ?? 0.7;

    // EMAで滑らかに…ただし alpha 大きめで “バシバシ”
    thObj.bias2state = proposed.map((p, i) => {
      const x = prev[i] ?? p;
      return x + (p - x) * a;
    });
  }

  // ==============================
  // 停滞判定用の設定（Δ揺らぎの平均から停滞/非停滞を決める）
  // ==============================
  window.gardenStagnationConfig = window.gardenStagnationConfig || {
    stagnationRange: [0.0, 0.3],
    framesPerStep: 2,
  };

  // 判定用バッファ & 直前状態
  window.__gardenGridBuffer = window.__gardenGridBuffer || [];
  window.__gardenStateLast = window.__gardenStateLast || null;

  // 連続停滞カウンタ（スナップショット単位）
  window.__gardenStagnationCount = window.__gardenStagnationCount || 0;

  // ==============================
  // バッファ管理
  // ==============================
  function pushGardenGridSample(grid) {
    if (!grid || !grid.length) return;
    const copy = grid.map((r) => r.slice());
    window.__gardenGridBuffer.push(copy);

    const MAX_BUFFER = 10;
    if (window.__gardenGridBuffer.length > MAX_BUFFER) {
      window.__gardenGridBuffer.splice(
        0,
        window.__gardenGridBuffer.length - MAX_BUFFER
      );
    }
  }

  // ==============================
  // 状態平滑化
  // ★変更：1回の変化は必ず「±1段まで」（良化/悪化どちらも）
  // ==============================
  function decideGardenState(current) {
    if (!window.__gardenStateLast) {
      window.__gardenStateLast = current;
      return current;
    }

    const prev = window.__gardenStateLast;
    const curIdx = STATE_LEVELS.indexOf(current);
    const prevIdx = STATE_LEVELS.indexOf(prev);

    if (curIdx < 0 || prevIdx < 0) {
      window.__gardenStateLast = current;
      return current;
    }

    let nextIdx = curIdx;
    if (curIdx > prevIdx + 1) nextIdx = prevIdx + 1; // 悪化ジャンプ抑制
    if (curIdx < prevIdx - 1) nextIdx = prevIdx - 1; // 良化ジャンプ抑制

    const next =
      STATE_LEVELS[Math.max(0, Math.min(STATE_LEVELS.length - 1, nextIdx))];
    window.__gardenStateLast = next;
    return next;
  }

  // ==============================
  // 分布化ヘルパー（スケールを捨てる）
  // ==============================
  function normalizeGridToProb(grid) {
    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    const prob = [];
    if (!rows || !cols) return prob;

    let sum = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Math.max(0, grid[r][c] || 0);
        sum += v;
      }
    }

    const N = rows * cols;
    const base = sum > 0 ? 0 : 1 / N; // sum=0 のときは一様分布

    for (let r = 0; r < rows; r++) {
      prob[r] = [];
      for (let c = 0; c < cols; c++) {
        if (sum > 0) {
          const v = Math.max(0, grid[r][c] || 0);
          prob[r][c] = v / sum;
        } else {
          prob[r][c] = base;
        }
      }
    }
    return prob;
  }

  // p1, p2 は normalizeGridToProb の結果を想定
  // トータルバリエーション距離 (0〜1) を計算
  function totalVariationDistance(p1, p2) {
    const rows = Math.min(p1.length, p2.length);
    if (!rows) return 0;
    const cols = Math.min(p1[0].length, p2[0].length);
    if (!cols) return 0;

    let sumAbs = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = p1[r][c] || 0;
        const b = p2[r][c] || 0;
        sumAbs += Math.abs(a - b);
      }
    }
    return 0.5 * sumAbs; // 0〜1
  }

  // ==============================
  // bias / change  [優〜危険]
  // ==============================
  function judgeStateWithDetails(latestGrid, gridsArr) {
    const th = window.gardenJudgeThresholds || {
      bias2state: [0.1, 0.15, 0.2, 0.25],
    };

    // 1) 空間的バイアス（その場のムラ）: σ / レンジ
    let vals = [];
    let gmax = -Infinity,
      gmin = Infinity;
    for (let r = 0; r < latestGrid.length; r++) {
      for (let c = 0; c < latestGrid[0].length; c++) {
        const v = latestGrid[r][c];
        vals.push(v);
        if (v > gmax) gmax = v;
        if (v < gmin) gmin = v;
      }
    }
    const N = vals.length || 1;
    const mean = vals.reduce((a, b) => a + b, 0) / N;
    const var_ = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / N;
    const stdev = Math.sqrt(var_);
    const range = Math.max(1e-9, gmax - gmin);
    const bias_disp = stdev / range; // 0〜1 程度の値を想定

    // ★追加：bias履歴を使って、bias→rank のしきい値を状況に応じて更新
    pushBiasSample(bias_disp);
    updateBiasThresholdsAdaptive();

    // 2) 時間的変化（分布の形の変化）：連続フレームの TV 距離の平均
    // ★ここは「今の judge.js のまま」維持
    const arr = gridsArr && gridsArr.length ? gridsArr : [latestGrid];

    let temporal_change = 0;
    if (arr.length >= 2) {
      const probArr = arr.map((g) => normalizeGridToProb(g));

      let sumTv = 0;
      let pairCount = 0;
      for (let i = 1; i < probArr.length; i++) {
        const tv = totalVariationDistance(probArr[i - 1], probArr[i]); // 0〜1
        sumTv += tv;
        pairCount++;
      }
      temporal_change = pairCount ? sumTv / pairCount : 0; // 0〜1
    }

    function rankFromBias(d) {
      const t =
        (window.gardenJudgeThresholds || th).bias2state || th.bias2state;
      if (d < t[0]) return 0;
      if (d < t[1]) return 1;
      if (d < t[2]) return 2;
      if (d < t[3]) return 3;
      return 4;
    }

    const bias_rank = rankFromBias(bias_disp);

    // 状態のベースは「空間偏り」だけで決める
    const combined_rank = bias_rank;
    const state = STATE_LEVELS[Math.max(0, Math.min(4, combined_rank))];

    // 停滞判定（Δ揺らぎの平均を使う）★条件は今のまま
    const stCfg = window.gardenStagnationConfig || {
      stagnationRange: [0, 0.15],
    };
    const [stLow, stHigh] = stCfg.stagnationRange;
    const isStagnating = temporal_change >= stLow && temporal_change <= stHigh;

    return {
      state, // ベース状態（biasのみで決定）
      avg_density: mean, // 最新グリッドの平均密度
      bias: bias_disp, // 空間ムラ（σ/レンジ）
      change: temporal_change, // 揺らぎ量（TV距離ベース）
      bias_rank,
      combined_rank, // 表示用：bias_rank と同じ
      isStagnating, // 停滞フラグ
      reason: "", // 必要になったらここに説明文を入れる
    };
  }

  // bias_rank からベース状態を取り出すヘルパー（一応用意）
  function baseStateFromBiasRank(bias_rank) {
    const idx = Math.max(0, Math.min(4, bias_rank | 0));
    return {
      index: idx,
      state: STATE_LEVELS[idx],
    };
  }

  // ==============================
  // メイン：densityGrid から currentGardenJudgeContext を更新
  // ==============================
  window.updateGardenStateFromGrid = function (densityGrid) {
    if (!densityGrid || !densityGrid.length) return;

    // バッファに追加
    pushGardenGridSample(densityGrid);

    const usedGrids = window.__gardenGridBuffer.slice();
    const usedCount = usedGrids.length;
    const latestGrid = usedGrids[usedGrids.length - 1];

    const judge = judgeStateWithDetails(latestGrid, usedGrids);

    // ==== 停滞カウントの更新 ====
    const stCfg = window.gardenStagnationConfig || {};
    const judgePerStep = stCfg.framesPerStep ?? 3; // 「何回の停滞判定で1段階悪化させるか」
    const snapsPerJudge = window.gardenAnnounceEverySnapshots || 1; // 1判定に使うスナップショット数

    if (judge.isStagnating) {
      window.__gardenStagnationCount =
        (window.__gardenStagnationCount || 0) + 1;
    } else {
      window.__gardenStagnationCount = 0;
    }

    const stagnationCount = window.__gardenStagnationCount || 0;

    // スナップショット数 → 「停滞判定回数」に変換
    const stagnationJudgeCount = Math.floor(stagnationCount / snapsPerJudge);

    // ==== まずは「空間偏り」だけからベース状態を決める ====
    const base = baseStateFromBiasRank(judge.bias_rank);
    let baseIndex = base.index;

    // ==== 停滞「判定回数」に応じて 1 段階ずつ悪化 ====
    const penaltySteps = Math.floor(stagnationJudgeCount / judgePerStep);
    let penalizedIndex = baseIndex + penaltySteps;
    if (penalizedIndex > 4) penalizedIndex = 4;
    if (penalizedIndex < 0) penalizedIndex = 0;

    // ペナルティ込み状態に「ならしロジック」をかけて最終状態を決定
    const penalizedState = STATE_LEVELS[penalizedIndex];
    const finalState = decideGardenState(penalizedState);
    const atISO = new Date().toISOString();

    // announce.js から参照するコンテキスト
    window.currentGardenJudgeContext = {
      judge,
      state: finalState,
      rawState: finalState,
      finalState: finalState,
      usedCount,
      latestGrid,
      usedGrids,
      stagnationCount,
      at: atISO,
    };
  };

  // 他からも使えるように公開
  window.pushGardenGridSample = pushGardenGridSample;
  window.judgeStateWithDetails = judgeStateWithDetails;
  window.decideGardenState = decideGardenState;

  // ==============================
  // メタ表示（announce.js から呼ぶ）
  // ==============================
  function renderGardenAnnounceMeta({
    judge,
    state,
    rawState,
    finalState,
    usedCount,
    prevState,
    atISO,
  }) {
    const el = document.getElementById("garden-announce-meta");
    if (!el) return;

    // 今の（固定 or adaptive）しきい値を表示
    const biasThresholds =
      (window.gardenJudgeThresholds || {}).bias2state || [];

    const biasStr = judge?.bias != null ? judge.bias.toFixed(3) : "-";
    const changeStr = judge?.change != null ? judge.change.toFixed(3) : "-";
    const stCount = window.__gardenStagnationCount || 0;

    const displayState = state ?? finalState ?? rawState ?? "-";
    const S = (i) => STATE_LEVELS?.[i] ?? "-";

    const html = `
        <div class="gameta">
          <div class="gameta__row">
            <b>直前状態</b>：<code>${prevState ?? "(なし)"}</code> /
            <b>使用枚数</b>：<code>${usedCount}</code> 枚 /
            <b>時刻</b>：<code>${atISO}</code>
          </div>
  
          <details class="gameta__details" open>
            <summary>詳細指標</summary>
            <table class="gameta__table">
              <tbody>
                <tr>
                  <th>結果</th>
                  <td colspan="2">
                      状態：
                      <span><b><code>${displayState}</code></b></span>
                  </td>
                </tr>
                <tr>
                  <th>空間偏り（σ/レンジ）</th>
                  <td><code>${biasStr}</code></td>
                  <td>ランク：<b>${S(judge?.bias_rank)}</b> <small>(index=${
      judge?.bias_rank ?? "-"
    })</small></td>
                </tr>
                <tr>
                  <th>変化量（分布変化 / TV距離）</th>
                  <td><code>${changeStr}</code></td>
                  <td> <code>${judge?.isStagnating ? "停滞中" : "非停滞"}</code>
                    （<code>${Math.floor(
                      stCount /
                        (window.gardenStagnationConfig?.framesPerStep ?? 1)
                    )}</code>連続中）</td>
                </tr>
                <tr>
                  <th>bias しきい値</th>
                  <td colspan="2">
                    <code>[${biasThresholds
                      .map((v) => v.toFixed(3))
                      .join(", ")}]</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="gameta__reason">${(judge?.reason ?? "")
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")}</div>
          </details>
  
          <details class="gameta__details">
            <summary>結果の出力設定</summary>
            <ul class="gameta__list">
              <li>状態の変化は常に <b>1段階ずつ</b>（良化/悪化どちらも）</li>
              <li>停滞ペナルティ：<code>${
                window.gardenStagnationConfig?.framesPerStep ?? ""
              }</code> 回の停滞判定ごとに1段階悪化</li>
              <li>adaptive：<code>${
                window.gardenAdaptiveThresholds?.enabled ? "ON" : "OFF"
              }</code> /
                  window=<code>${
                    window.gardenAdaptiveThresholds?.window ?? "-"
                  }</code> /
                  alpha=<code>${
                    window.gardenAdaptiveThresholds?.emaAlpha ?? "-"
                  }</code></li>
            </ul>
          </details>
        </div>
      `;

    el.innerHTML = html;
  }
  window.renderGardenAnnounceMeta = renderGardenAnnounceMeta;

  // ---- メタ用 CSS ----
  (function injectGaMetaCss() {
    if (document.getElementById("ga-meta-css")) return;
    const css = `
        .gameta { font: 14px/1.6 system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif; }
        .gameta__row { margin: .25rem 0; }
        .gameta__badge { display:inline-block; padding:.12rem .5rem; border-radius:.5rem; background:#eefaff; border:1px solid #b7dff0; }
        .gameta--raw { background:#fff7e6; border-color:#ffd58a; }
        .gameta--final { background:#e8fff0; border-color:#9fe0b9; }
        .gameta__arrow { margin: 0 .35rem; color:#999; }
        .gameta__details { margin:.25rem 0; }
        .gameta__table { width:100%; border-collapse:collapse; margin:.25rem 0; }
        .gameta__table th, .gameta__table td { padding:.25rem .5rem; border-bottom:1px dashed #cfe8f5; text-align:left; }
        .gameta__reason { margin-top:.25rem; color:#333; }
        .gameta__list { margin:.25rem 0 .25rem 1rem; }
        summary { cursor:pointer; }
        code { background:#f6f8fa; padding:.05rem .3rem; border-radius:.25rem; }
      `;
    const s = document.createElement("style");
    s.id = "ga-meta-css";
    s.textContent = css;
    document.head.appendChild(s);
  })();

  // ==============================
  // グリッド描画（announce から共用）
  // ==============================
  function drawDensityGrid(grid, containerId, judgeInfo = null) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (el.tagName.toLowerCase() === "canvas") {
      drawToCanvasGridWithJudge(el, grid, judgeInfo);
      return;
    }
  }

  function drawToCanvasGridWithJudge(canvas, g, judgeInfo = null) {
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.aspectRatio = "16 / 9";
    canvas.style.borderRadius = "0.2rem";

    const ROWS = g.length;
    const COLS = g[0].length;

    const rect = canvas.getBoundingClientRect();
    let cssW = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
    let cssH = Math.floor((cssW * 9) / 16);
    if (cssH < Math.floor(cssW * (ROWS / COLS)))
      cssH = Math.floor(cssW * (ROWS / COLS));
    if (cssH < 1) cssH = 1;
    const dpr = window.devicePixelRatio || 1;
    const pixW = Math.floor(cssW * dpr);
    const pixH = Math.floor(cssH * dpr);

    if (canvas.width !== pixW || canvas.height !== pixH) {
      canvas.width = pixW;
      canvas.height = pixH;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    let cellW = cssW / COLS;
    let cellH = cssH / ROWS;
    let offsetX = 0,
      offsetY = 0;
    if (cellW > cellH) {
      cellW = cellH;
      offsetX = (cssW - cellW * COLS) / 2;
    } else if (cellH > cellW) {
      cellH = cellW;
      offsetY = (cssH - cellH * ROWS) / 2;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.floor(Math.min(cellW, cellH) * 0.4)}px sans-serif`;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = Math.max(0, Math.min(1, g[r][c]));
        ctx.fillStyle = `rgba(${Math.round(245 - 140 * v)}, ${Math.round(
          246 - 160 * v
        )}, ${Math.round(243 - 90 * v)}, 1)`;
        ctx.fillRect(offsetX + c * cellW, offsetY + r * cellH, cellW, cellH);

        ctx.fillStyle = "#222";
        ctx.fillText(
          g[r][c].toFixed(2),
          offsetX + c * cellW + cellW / 2,
          offsetY + r * cellH + cellH / 2
        );
      }
    }

    ctx.strokeStyle = "#bedeed";
    ctx.lineWidth = 1;
    for (let r = 0; r <= ROWS; r++) {
      const y = offsetY + r * cellH;
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + cellW * COLS, y);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      const x = offsetX + c * cellW;
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + cellH * ROWS);
      ctx.stroke();
    }

    if (judgeInfo) {
      ctx.save();

      ctx.textAlign = "left";
      const titleFont =
        "bold 13px system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif";
      const bodyFont =
        "12px system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif";
      const titleColor = "#2677a1";
      const bodyColor = "#333";

      const padX = 12,
        padY = 10,
        gapTitleBody = 6;
      const lineHTitle = 18,
        lineHBody = 18;
      const boxMaxW = Math.min(cssW, 420);
      const textMaxW = boxMaxW - padX - 10;

      const titleText = `判定: ${judgeInfo.state}（Avg: ${
        judgeInfo.avg_density?.toFixed?.(3) ?? "-"
      } / Bias: ${judgeInfo.bias?.toFixed?.(3) ?? "-"}）`;
      const reasonText = judgeInfo.reason || "";

      function wrapLines(text, font, maxWidth) {
        ctx.font = font;
        const out = [];
        const words = [...text];
        let line = "";
        for (const ch of words) {
          const test = line + ch;
          if (ctx.measureText(test).width <= maxWidth) {
            line = test;
          } else {
            if (line) out.push(line);
            line = ch;
          }
        }
        if (line) out.push(line);
        return out;
      }

      const titleWidth =
        ((ctx.font = titleFont), ctx.measureText(titleText).width);
      const bodyLines = wrapLines(reasonText, bodyFont, textMaxW);

      const boxW = Math.min(boxMaxW, Math.max(titleWidth + padX + 10, 220));
      const contentH =
        lineHTitle +
        (bodyLines.length ? gapTitleBody + bodyLines.length * lineHBody : 0);
      const boxH = Math.max(36, contentH + padY * 2);

      const boxX = cssW - boxW - 14;
      const boxY = cssH - boxH - 14;

      ctx.globalAlpha = 0.92;
      ctx.fillStyle = "#eefaff";
      ctx.strokeStyle = "#2aa7d6";
      ctx.lineWidth = 2;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      } else {
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";
      const textX = boxX + padX;
      let y = boxY + padY + lineHTitle * 0.8;

      ctx.font = titleFont;
      ctx.fillStyle = titleColor;
      ctx.fillText(titleText, textX, y);

      if (bodyLines.length) {
        y += gapTitleBody;
        ctx.font = bodyFont;
        ctx.fillStyle = bodyColor;
        for (const ln of bodyLines) {
          y += lineHBody;
          ctx.fillText(ln, textX, y);
        }
      }

      ctx.restore();
    }
  }

  window.drawDensityGrid = drawDensityGrid;
  window.drawToCanvasGridWithJudge = drawToCanvasGridWithJudge;
})();
