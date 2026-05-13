// ---- DOM取得 ----
const mixCanvas = document.getElementById('mix');
const camSelect = document.getElementById('camA'); // camA を1台用のセレクトとして流用
const resSel = document.getElementById('res');
const btnPerm = document.getElementById('perm');
const btnRefresh = document.getElementById('refresh');
const mixCtx = mixCanvas.getContext('2d', { willReadFrequently: true });
const TARGET_FPS = 20;

// 無視したい deviceId
const IGNORE_DEVICE_IDS = [
  "ec56e456430e2289f8f73e0322fc9bca103bcdf6fb538cd48cfe9b84e82948a1"
];

// ローカルストレージのキー（1台用）
const LS_KEY_CAM = 'mix_cam_deviceId';

// オフスクリーン video 要素（1台）
const vCam = document.createElement('video');
vCam.muted = true;
vCam.playsInline = true;
vCam.autoplay = true;

// HTMLと同じレイアウトにする関数（デバッグ表示用）
function applyVideoStyles(v) {
  Object.assign(v.style, {
    display: "block",
    minWidth: "0",
    width: "100%",
    height: "auto",
    flex: "1 1 0",
    borderRadius: "0.2rem",
    background: "#000"
  });
}

// デバッグ表示用コンテナ & トグル
const debugToggle = document.getElementById('debugToggle');
const debugWrap = document.getElementById('debugVideos');

function attachDebugVideo() {
  if (!debugWrap) return;

  // 一度だけ append する
  if (!debugWrap.contains(vCam)) {
    applyVideoStyles(vCam);
    debugWrap.appendChild(vCam);
  }

  // 表示
  debugWrap.style.display = 'flex';
}

function detachDebugVideo() {
  if (!debugWrap) return;
  debugWrap.style.display = 'none';
}

function updateDebugVisibility() {
  if (!debugToggle) return;
  debugToggle.checked ? attachDebugVideo() : detachDebugVideo();
}

debugToggle?.addEventListener('change', updateDebugVisibility);
updateDebugVisibility();

// グローバル公開（他スクリプト用：colordetection.js から result0 として見える）
window.result0 = mixCanvas;

// ---- 状態 ----
let streamCam = null;
let rafId = null;
let lastDrawTime = 0;
let _autoStartDone = false;

// 現在選択している deviceId
let preferredDeviceId = null;

// ---- ユーティリティ ----
function parseRes(v) {
  const [w, h] = v.split('x').map(n => parseInt(n, 10));
  return { w, h };
}
function stopStream(s) {
  if (!s) return;
  s.getTracks().forEach(t => t.stop());
}

// ---- 権限 & デバイス列挙 ----
async function ensurePermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (e) {
    console.error(e);
    alert('カメラ権限が必要です。ブラウザの許可ダイアログを許可してください。');
  }
}

async function listCams() {
  const devices = await navigator.mediaDevices.enumerateDevices();

  // すべてのビデオ入力
  const allVideos = devices.filter(d => d.kind === 'videoinput');

  // 無視リストを除外
  const videos = allVideos.filter(d => !IGNORE_DEVICE_IDS.includes(d.deviceId));

  videos.forEach((dev, i) => {
    console.log(
      `[WebCam ${i}] deviceId: ${dev.deviceId}, groupId: ${dev.groupId}, label: ${dev.label}`
    );
  });

  // localStorage から前回の設定を読む
  const saved = localStorage.getItem(LS_KEY_CAM);
  preferredDeviceId = null;

  // 1) 前回保存したIDが生きていればそれを使う
  if (saved && videos.some(d => d.deviceId === saved)) {
    preferredDeviceId = saved;
  }

  // 2) それでも決まらない場合は先頭を使う
  if (!preferredDeviceId && videos[0]) {
    preferredDeviceId = videos[0].deviceId;
  }

  // 3) セレクトを「deviceId value」で再構築
  const opts = videos
    .map(
      d => `<option value="${d.deviceId}">${d.label || 'Camera ' + d.deviceId}</option>`
    )
    .join('');
  if (camSelect) camSelect.innerHTML = opts;

  // preferredDeviceId に合う option を選択状態にする
  if (camSelect && preferredDeviceId) {
    camSelect.value = preferredDeviceId;
  }

  // 4) 条件満たせば自動start
  const ids = videos.map(v => v.deviceId);
  if (
    preferredDeviceId &&
    ids.includes(preferredDeviceId) &&
    !_autoStartDone
  ) {
    _autoStartDone = true;
    start();   // 非同期で開始
  }
}

// ---- start（1台だけ）----
async function start() {
  // すでにループが回っていたら一度止める
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // 既存ストリームを止める
  stopStream(streamCam);
  streamCam = null;

  const { w: prefW, h: prefH } = parseRes(resSel.value);

  // セレクトの value（＝現在選択している deviceId）を使う
  const id = camSelect?.value || preferredDeviceId;
  console.log("[start] use cam deviceId =", id);

  if (!id) {
    console.warn("カメラが選択されていません");
    return;
  }

  const constraints = {
    video: {
      deviceId: { exact: id },
      width: { ideal: prefW },
      height: { ideal: prefH }
    },
    audio: false
  };

  try {
    streamCam = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    console.error(e);
    alert('カメラを開けませんでした。別の解像度やブラウザ設定をご確認ください。');
    _autoStartDone = false;
    return;
  }

  vCam.srcObject = streamCam;

  await Promise.all([
    vCam.play().catch(() => {}),
    new Promise(res => vCam.onloadedmetadata = res),
  ]);

  updateCanvasSize();
  lastDrawTime = 0;
  loop();
}

// ---- レイアウト関連（1枚フルで cover）----
function updateCanvasSize() {
  const { w: prefW, h: prefH } = parseRes(resSel.value);
  mixCanvas.width = prefW;
  mixCanvas.height = prefH;
}

function draw() {
  // クリア
  mixCtx.fillStyle = '#000';
  mixCtx.fillRect(0, 0, mixCanvas.width, mixCanvas.height);

  drawCoverFull();
}

// 1台の映像を 16:9 キャンバス全体に object-fit: cover で描画
function drawCoverFull() {
  const W = mixCanvas.width, H = mixCanvas.height;
  drawCover(vCam, 0, 0, W, H);
}

// CSSのobject-fit: cover 相当
function drawCover(video, dx, dy, dw, dh) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(dw / vw, dh / vh);
  const sw = dw / s, sh = dh / s;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  mixCtx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

function loop(now) {
  if (typeof now !== 'number') now = performance.now();
  if (!lastDrawTime || (now - lastDrawTime) >= (1000 / TARGET_FPS)) {
    draw();
    lastDrawTime = now;
  }
  rafId = requestAnimationFrame(loop);
}

// ================= MAGNIFIER & スポイト (on mixCanvas) =================
const MAGNIFIER_CSS_SIZE = 48;   // 画面上の見た目サイズ（CSS px）
const MAGNIFIER_SCALE = 12;      // 拡大倍率
const MAGNIFIER_MARGIN = 12;     // カーソルからのオフセット
let magnifierCanvas = null, magnifierCtx = null;

// ピクセル取得用のオフスクリーン
const pickCanvas = document.createElement('canvas');
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });

function ensureMagnifierCanvas() {
  if (magnifierCanvas) return;
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  magnifierCanvas = document.createElement('canvas');
  magnifierCanvas.width = Math.floor(MAGNIFIER_CSS_SIZE * DPR);
  magnifierCanvas.height = Math.floor(MAGNIFIER_CSS_SIZE * DPR);

  magnifierCanvas.style.width = `${MAGNIFIER_CSS_SIZE}px`;
  magnifierCanvas.style.height = `${MAGNIFIER_CSS_SIZE}px`;

  magnifierCanvas.style.position = 'fixed';
  magnifierCanvas.style.pointerEvents = 'none';
  magnifierCanvas.style.zIndex = '1001';
  magnifierCanvas.style.border = 'none';
  magnifierCanvas.style.background = 'rgba(25,25,30,0.52)';
  magnifierCanvas.style.borderRadius = '50%';
  magnifierCanvas.style.boxShadow = '0 2px 8px #333c';
  magnifierCanvas.style.display = 'none';

  document.body.appendChild(magnifierCanvas);
  magnifierCtx = magnifierCanvas.getContext('2d');
  magnifierCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function showMagnifierOnMix(ev) {
  if (!mixCanvas) return;
  ensureMagnifierCanvas();

  const src = mixCanvas;
  const sourceW = src.width;
  const sourceH = src.height;
  if (!sourceW || !sourceH) return;

  const rect = mixCanvas.getBoundingClientRect();
  let normX = (ev.clientX - rect.left) / rect.width;
  let normY = (ev.clientY - rect.top) / rect.height;
  normX = Math.max(0, Math.min(1, normX));
  normY = Math.max(0, Math.min(1, normY));

  const grabW = Math.max(1, Math.round(MAGNIFIER_CSS_SIZE / MAGNIFIER_SCALE));
  const grabH = Math.max(1, Math.round(MAGNIFIER_CSS_SIZE / MAGNIFIER_SCALE));

  let sx = Math.round(normX * sourceW);
  let sy = Math.round(normY * sourceH);
  let srcX = sx - Math.floor(grabW / 2);
  let srcY = sy - Math.floor(grabH / 2);

  if (srcX < 0) srcX = 0;
  if (srcY < 0) srcY = 0;
  if (srcX + grabW > sourceW) srcX = Math.max(0, sourceW - grabW);
  if (srcY + grabH > sourceH) srcY = Math.max(0, sourceH - grabH);

  sx = srcX + Math.floor(grabW / 2);
  sy = srcY + Math.floor(grabH / 2);

  magnifierCtx.save();
  magnifierCtx.clearRect(0, 0, MAGNIFIER_CSS_SIZE, MAGNIFIER_CSS_SIZE);

  // まるくクリップして拡大
  magnifierCtx.save();
  magnifierCtx.beginPath();
  magnifierCtx.arc(
    MAGNIFIER_CSS_SIZE / 2,
    MAGNIFIER_CSS_SIZE / 2,
    MAGNIFIER_CSS_SIZE / 2 - 1,
    0, Math.PI * 2
  );
  magnifierCtx.closePath();
  magnifierCtx.clip();

  magnifierCtx.imageSmoothingEnabled = false;
  magnifierCtx.drawImage(
    src,
    srcX, srcY, grabW, grabH,
    0, 0, MAGNIFIER_CSS_SIZE, MAGNIFIER_CSS_SIZE
  );
  magnifierCtx.restore();

  const centerX = MAGNIFIER_CSS_SIZE / 2;
  const centerY = MAGNIFIER_CSS_SIZE / 2;
  const pixelDisplayW = MAGNIFIER_CSS_SIZE / grabW;
  const pixelDisplayH = MAGNIFIER_CSS_SIZE / grabH;

  // 外枠
  magnifierCtx.beginPath();
  magnifierCtx.arc(
    MAGNIFIER_CSS_SIZE / 2,
    MAGNIFIER_CSS_SIZE / 2,
    MAGNIFIER_CSS_SIZE / 2 - 1.1,
    0, Math.PI * 2
  );
  magnifierCtx.lineWidth = 1.5;
  magnifierCtx.strokeStyle = '#00caea';
  magnifierCtx.shadowColor = '#00c6ed88';
  magnifierCtx.shadowBlur = 3;
  magnifierCtx.stroke();

  // 中央ピクセル枠
  magnifierCtx.save();
  magnifierCtx.beginPath();
  magnifierCtx.rect(
    centerX - pixelDisplayW / 2 + 0.5,
    centerY - pixelDisplayH / 2 + 0.5,
    pixelDisplayW - 1,
    pixelDisplayH - 1
  );
  magnifierCtx.lineWidth = 2;
  magnifierCtx.strokeStyle = '#e91d1d';
  magnifierCtx.shadowColor = '#f33';
  magnifierCtx.shadowBlur = 0.5;
  magnifierCtx.stroke();
  magnifierCtx.restore();

  magnifierCtx.restore();

  // 位置
  let left = ev.clientX + MAGNIFIER_MARGIN;
  let top = ev.clientY + MAGNIFIER_MARGIN;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  if (left + MAGNIFIER_CSS_SIZE > viewportW - 2) {
    left = Math.max(0, viewportW - MAGNIFIER_CSS_SIZE - 2);
  }
  if (top + MAGNIFIER_CSS_SIZE > viewportH - 2) {
    top = Math.max(0, viewportH - MAGNIFIER_CSS_SIZE - 2);
  }

  magnifierCanvas.style.left = `${left}px`;
  magnifierCanvas.style.top = `${top}px`;
  magnifierCanvas.style.display = '';
}

function hideMagnifierOnMix() {
  if (magnifierCanvas) magnifierCanvas.style.display = 'none';
}

// mixCanvas から色をスポイトして colordetection.js 側の addPickedColorFromRGB に渡す
function handlePickOnMix(ev) {
  hideMagnifierOnMix();
  if (!mixCanvas) return;

  const rect = mixCanvas.getBoundingClientRect();
  let normX = (ev.clientX - rect.left) / rect.width;
  let normY = (ev.clientY - rect.top) / rect.height;
  normX = Math.max(0, Math.min(1, normX));
  normY = Math.max(0, Math.min(1, normY));

  const w = mixCanvas.width;
  const h = mixCanvas.height;
  if (!w || !h) return;

  const vx = Math.round(normX * w);
  const vy = Math.round(normY * h);

  pickCanvas.width = w;
  pickCanvas.height = h;
  pickCtx.save();
  pickCtx.drawImage(mixCanvas, 0, 0, w, h);
  pickCtx.restore();

  const img = pickCtx.getImageData(vx, vy, 1, 1).data;
  const r = img[0], g = img[1], b = img[2];

  // colordetection.js 側の関数を呼ぶ（グローバル公開されている前提）
  if (typeof window.addPickedColorFromRGB === 'function') {
    window.addPickedColorFromRGB(r, g, b);
  }

  // すぐ検出結果を更新したい場合
  if (typeof window.forceUpdateSnapshot === 'function') {
    window.forceUpdateSnapshot();
  }
}

// mixCanvas にイベントバインド
if (mixCanvas) {
  mixCanvas.addEventListener('mousemove', showMagnifierOnMix);
  mixCanvas.addEventListener('mouseleave', hideMagnifierOnMix);
  mixCanvas.addEventListener('mouseout', hideMagnifierOnMix);
  mixCanvas.addEventListener('mousedown', hideMagnifierOnMix);
  mixCanvas.addEventListener('click', handlePickOnMix);
}

// ---- イベント登録 ----
btnPerm.onclick = ensurePermission;
btnRefresh.onclick = listCams;

// セレクトを変えたら、そのIDを保存して即リスタート
if (camSelect) {
  camSelect.addEventListener('change', () => {
    preferredDeviceId = camSelect.value;
    localStorage.setItem(LS_KEY_CAM, preferredDeviceId);
    start();
  });
}

// layoutSel はなくなったので resSel だけでOK
resSel.onchange = () => updateCanvasSize();

navigator.mediaDevices.addEventListener?.('devicechange', listCams);

// ---- 初期化 ----
listCams();