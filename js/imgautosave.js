// ===== 共通で利用できるトースト関数をグローバル化 =====
(function () {
    let box = null;

    function showToast(msg) {
        if (!box) {
            box = document.createElement('div');
            box.style = `position: fixed;right: 20px;bottom: 20px;display: flex;flex-direction: column;gap: 6px;z-index: 99999;pointer-events: none;`;
            document.body.appendChild(box);
        }

        // 個々のトースト要素
        const d = document.createElement('div');
        d.textContent = msg;
        d.style = `background: rgba(0,0,0,0.75);color: #fff;padding: 6px 10px;border-radius: 6px;font-size: 12px;pointer-events: none;opacity: 1;transition: opacity .3s;`;

        box.appendChild(d);

        setTimeout(() => { d.style.opacity = 0; }, 1200);
        setTimeout(() => { d.remove(); }, 1500);
    }

    window.showToast = showToast;
})();

const r1 = document.getElementById('result1');
const r2 = document.getElementById('result2');
const cbR1 = document.getElementById('auto-r1');
const cbR2 = document.getElementById('auto-r2');

const LS_KEY_R1 = 'autosave_result1';
const LS_KEY_R2 = 'autosave_result2';

function loadCheckboxState() {
    if (cbR1) cbR1.checked = localStorage.getItem(LS_KEY_R1) !== 'false';
    if (cbR2) cbR2.checked = localStorage.getItem(LS_KEY_R2) !== 'false';
}
function wirePersist() {
    if (cbR1) cbR1.addEventListener('change', () => {
        localStorage.setItem(LS_KEY_R1, String(cbR1.checked));
        showToast(`result1 自動保存: ${cbR1.checked ? 'ON' : 'OFF'}`);
    });
    if (cbR2) cbR2.addEventListener('change', () => {
        localStorage.setItem(LS_KEY_R2, String(cbR2.checked));
        showToast(`result2 自動保存: ${cbR2.checked ? 'ON' : 'OFF'}`);
    });
}

let savingNow = false;

async function saveCanvas(canvas, canvasId) {
    const dataURL = canvas.toDataURL('image/png', 0.95);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);

    try {
        const res = await fetch('http://127.0.0.1:3001/api/saveCanvas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canvasId, ext: 'png', dataURL }),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        console.log('saved:', json);
        showToast(`${canvasId} 保存: ${json.filename}`);
    } catch (e) {
        console.error('save failed:', e);
        showToast(`${canvasId} 保存失敗`);
    } finally {
        clearTimeout(t);
    }
}

function scheduleAutoSaveAndReschedule() {
    const intervalInput = document.getElementById('intervalSec');
    const transitionInput = document.getElementById('transitionMs');
    const intervalSec = intervalInput ? Number(intervalInput.value) : 180;
    const transitionSec = transitionInput ? Number(transitionInput.value) : 5;
    const totalDelay = (intervalSec + transitionSec + 3) * 1000;

    setTimeout(async () => {
        if (savingNow) {
            scheduleAutoSaveAndReschedule();
            return;
        }
        savingNow = true;
        try {
            if (cbR1?.checked && r1) await saveCanvas(r1, 'result1');
            if (cbR2?.checked && r2) await saveCanvas(r2, 'result2');
        } finally {
            savingNow = false;
            scheduleAutoSaveAndReschedule();
        }
    }, totalDelay);
}

window.addEventListener('DOMContentLoaded', () => {
    loadCheckboxState();
    wirePersist();
    scheduleAutoSaveAndReschedule();
});