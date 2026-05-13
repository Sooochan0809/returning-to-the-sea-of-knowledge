//URLの末尾にキャンバス名を引数に設定する（例:http://127.0.0.1:5501/display1.html?src=result1）
(function () {
    const params = new URL(location.href).searchParams;
    const srcId = params.get("src") || "result1";

    const canvas = document.getElementById("viewerCanvas");
    const ctx = canvas.getContext("2d");

    const ch = new BroadcastChannel(`gp_view_${srcId}`);

    ch.onmessage = (ev) => {
        const data = ev.data || {};
        if (data.type !== "frame" || !data.bitmap) return;

        const { w, h, bitmap } = data;

        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        bitmap.close && bitmap.close();
    };
})();