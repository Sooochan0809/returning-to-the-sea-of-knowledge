(function () {
    let lastFrameTime = performance.now();
    let frameCount = 0, fps = 0;
    function countFps() {
        const now = performance.now();
        frameCount++;
        if (now - lastFrameTime >= 1000) {
            fps = frameCount;
            const el = document.getElementById('perf-fps');
            if (el) el.textContent = fps;
            frameCount = 0;
            lastFrameTime = now;
        }
        requestAnimationFrame(countFps);
    }
    countFps();
})();