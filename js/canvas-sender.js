(() => {
    const TARGET_CANVAS_IDS = ["result1", "result2"];
    const FPS = 30;

    const channels = new Map();

    function setupChannels() {
        TARGET_CANVAS_IDS.forEach((id) => {
            const c = document.getElementById(id);
            if (!c) {
                console.warn(`[mirror-sender] canvas #${id} が見つからない`);
                return;
            }
            const ch = new BroadcastChannel(`gp_view_${id}`);
            channels.set(id, { canvas: c, ch });
        });
    }

    async function sendLoop() {
        const interval = 1000 / FPS;

        const tick = async () => {
            for (const [id, { canvas, ch }] of channels) {
                if (!canvas.width || !canvas.height) continue;

                try {
                    const bitmap = await createImageBitmap(canvas);
                    ch.postMessage({
                        type: "frame",
                        w: canvas.width,
                        h: canvas.height,
                        bitmap,
                    });
                    // ImageBitmap は使い終わったら回収
                    bitmap.close && bitmap.close();
                } catch (e) {
                    console.warn("[mirror-sender] createImageBitmap/postMessage エラー:", e);
                }
            }

            setTimeout(tick, interval);
        };

        tick();
    }

    window.addEventListener("load", () => {
        setupChannels();
        sendLoop();
    });
})();  