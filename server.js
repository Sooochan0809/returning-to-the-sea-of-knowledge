import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import fsp from 'fs/promises';
import path from 'path';

const app = express();

// JSON大きめ
app.use(express.json({ limit: '25mb' }));

// ============ CORS ============
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5501',
    'http://127.0.0.1:3000',
  ];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (process.env.ALLOW_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});


// ============================================================
// 共通ユーティリティ（ここが今回のポイント）
// ============================================================

// ベース
const LOGS_BASE = path.resolve('./logs');
const AUDIO_BASE = path.join(LOGS_BASE, 'audio_saves');
const IMG_BASE = path.join(LOGS_BASE, 'img_saves');

// パス脱出防止
function safeJoin(base, target) {
  const full = path.resolve(base, target || '.');
  const baseResolved = path.resolve(base);
  if (!full.startsWith(baseResolved)) throw new Error('Invalid path');
  return full;
}

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

// 今日の日付から MMDD を作る
function getTodayMMDD() {
  const now = new Date();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  return `${mm}${dd}`; // 1031 みたいなやつ
}

// 時刻 HHMM を作る
function getHHMM() {
  const now = new Date();
  return `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
}

// 指定prefixのフォルダを返す
async function ensureDailyDir(baseDir, prefix, mmdd = null) {
  const day = mmdd || getTodayMMDD();
  const dirName = `${prefix}_${day}`;
  const full = safeJoin(baseDir, dirName);
  await fsp.mkdir(full, { recursive: true });
  return full;
}

// その日付フォルダの中で次の連番を取る
async function getNextSeqInDir(dir, prefix) {
  await fsp.mkdir(dir, { recursive: true });
  // withFileTypes でファイル/ディレクトリ識別（どちらでも対象にする）
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  let max = 0;

  for (const ent of items) {
    // 拡張子を一旦落としてベース名だけでマッチさせる
    const name = ent.name.replace(/\.[^.]+$/, ''); // 例: 'announce_001_1702'
    const m = name.match(new RegExp(`^${prefix}_(\\d{3})_\\d{4}$`));
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > max) max = num;
    }
  }
  return max + 1;
}

// 実際のフルパスを決める（フォルダ or ファイル）
async function makeDatedPath(baseDir, topPrefix, filePrefix, ext = null) {
  // 1) 日付フォルダを用意: topPrefix_1031
  const dailyDir = await ensureDailyDir(baseDir, topPrefix);
  // 2) 中の連番
  const seq = await getNextSeqInDir(dailyDir, filePrefix);
  // 3) 時刻
  const hhmm = getHHMM();
  // 4) サブ名
  const name = `${filePrefix}_${pad3(seq)}_${hhmm}`;
  // extがあればファイルパス、なければフォルダパスとして返す
  if (ext) {
    return {
      dir: dailyDir,
      name: `${name}.${ext}`,
      full: path.join(dailyDir, `${name}.${ext}`),
    };
  } else {
    return {
      dir: dailyDir,
      name,
      full: path.join(dailyDir, name),
    };
  }
}

// DataURL -> Buffer
function dataURLtoBuffer(dataURL) {
  const m = dataURL.match(/^data:(.+?);base64,(.+)$/);
  if (!m) throw new Error('Invalid dataURL');
  return Buffer.from(m[2], 'base64');
}


// ============================================================
// 1. OpenAI: /api/announce (テキスト生成)
// ============================================================
app.post('/api/announce', async (req, res) => {
  try {
    const {
      prompt,
      model = 'gpt-4o-mini',
      temperature = 0,
      system = 'あなたは天気予報士のように丁寧に話すアナウンスAIです。'
    } = req.body ?? {};

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await r.json().catch(async () => ({ raw: await r.text() }));
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    console.error('[announce] ', e);
    res.status(500).json({ error: String(e) });
  }
});

// ============================================================
// 2. 保存先: logs/audio_saves/announce_MMDD/announce_001_HHMM.mp3
// ============================================================
app.post('/api/tts', async (req, res) => {
  try {
    const {
      text,
      voice = 'alloy',
      format = 'mp3',
      model = 'tts-1'
    } = req.body ?? {};

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        format
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(r.status).send(errText || 'Upstream TTS error');
    }

    const arrayBuf = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // 保存
    try {
      const ext = (format === 'wav') ? 'wav' : (format === 'opus' ? 'ogg' : 'mp3');
      // announce用に固定
      const { dir, name, full } = await makeDatedPath(
        AUDIO_BASE,
        'announce',     // 日付フォルダ: announce_1031
        'announce',     // 中身: announce_001_1702.mp3
        ext
      );
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(full, buffer);
      console.log('[tts] Saved audio:', full);
    } catch (saveErr) {
      console.error('[tts] save error:', saveErr);
    }

    const mime =
      format === 'wav' ? 'audio/wav' :
        format === 'opus' ? 'audio/ogg' :
          'audio/mpeg';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.send(buffer);
  } catch (e) {
    console.error('[tts] ', e);
    res.status(500).json({ error: String(e) });
  }
});

// ============================================================
// 3. Canvas画像保存
// ============================================================

// どのキャンバスがどのprefixか決めるテーブル
const CANVAS_PREFIX_MAP = {
  'result1': 'dot',
  'result2': 'niwaseisei',
  // 他にもあれば足す
};

// 1枚
app.post('/api/saveCanvas', async (req, res) => {
  try {
    const {
      canvasId,
      subdir, // ←ユーザが明示的に指定したいとき
      ext = 'png',
      dataURL
    } = req.body ?? {};

    if (!dataURL) return res.status(400).json({ error: 'dataURL is required' });

    // prefix決定
    let prefix;
    if (subdir) {
      // 例: "niwaseisei" や "dot" をフロントから直指定したいとき
      prefix = subdir;
    } else {
      prefix = CANVAS_PREFIX_MAP[canvasId] || 'others';
    }

    // 画像は img_saves 配下にまとめる
    const { dir, name, full } = await makeDatedPath(
      IMG_BASE,
      prefix,   // 日付フォルダ: prefix_MMDD
      prefix,   // 中身: prefix_001_HHMM.ext
      ext.toLowerCase()
    );

    const buf = dataURLtoBuffer(dataURL);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(full, buf);

    res.json({ ok: true, filename: name, dir, path: full });
  } catch (e) {
    console.error('[saveCanvas] ', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 複数
app.post('/api/saveCanvases', async (req, res) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items[] required' });
    }

    const results = [];

    // 今回は1件ずつ makeDatedPath してOK（衝突回避のためフォルダ内を見てるので）
    for (const it of items) {
      const { canvasId, subdir, ext = 'png', dataURL } = it ?? {};
      if (!dataURL) {
        results.push({ ok: false, error: 'dataURL missing' });
        continue;
      }

      let prefix;
      if (subdir) {
        prefix = subdir;
      } else {
        prefix = CANVAS_PREFIX_MAP[canvasId] || 'others';
      }

      const { dir, name, full } = await makeDatedPath(
        IMG_BASE,
        prefix,
        prefix,
        ext.toLowerCase()
      );
      const buf = dataURLtoBuffer(dataURL);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(full, buf);

      results.push({ ok: true, filename: name, dir, path: full });
    }

    res.json({ ok: true, results });
  } catch (e) {
    console.error('[saveCanvases] ', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});


// ============================================================
// 4. コラージュ詩の音声を保存
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

app.post('/api/saveCollageAudio', async (req, res) => {
  try {
    const { subdir, filename, ext = 'mp3', audioDataBase64 } = req.body ?? {};
    if (!audioDataBase64 || typeof audioDataBase64 !== 'string') {
      return res.status(400).json({ error: 'audioDataBase64 required' });
    }

    const prefix = subdir || 'collagepoetry';

    // 一旦 WebM などの生バイナリを受ける
    let base64str = audioDataBase64;
    const commaIdx = base64str.indexOf(',');
    if (commaIdx !== -1) base64str = base64str.slice(commaIdx + 1);

    const inputBuf = Buffer.from(base64str, 'base64');

    // まず一時ファイルとして保存（入力フォーマットは何でも OK）
    const tmpDir = path.join(LOGS_BASE, '.tmp');
    await fsp.mkdir(tmpDir, { recursive: true });

    const tmpIn = path.join(tmpDir, `in_${Date.now()}.webm`);
    const tmpOut = path.join(tmpDir, `out_${Date.now()}.mp3`);

    await fsp.writeFile(tmpIn, inputBuf);

    // ffmpeg で MP3 変換（音質調整は -b:a で可能）
    try {
      await execFileAsync('ffmpeg', [
        '-y',            // 上書き
        '-i', tmpIn,     // 入力
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',  // 好きなビットレートに調整
        tmpOut
      ]);
    } catch (err) {
      console.error('ffmpeg error:', err);
      return res.status(500).json({ error: 'ffmpeg conversion failed' });
    }

    // 保存ファイルパスを決定（.mp3 固定）
    const target = await makeDatedPath(
      AUDIO_BASE,
      prefix,
      'collage',
      'mp3'          // ★ mp3 で固定保存
    );

    await fsp.mkdir(target.dir, { recursive: true });

    // 変換後の mp3 を配置
    const mp3buf = await fsp.readFile(tmpOut);
    await fsp.writeFile(target.full, mp3buf);

    // 一時ファイル削除（任意）
    try {
      await fsp.unlink(tmpIn);
      await fsp.unlink(tmpOut);
    } catch { }

    console.log('[saveCollageAudio] Saved mp3:', target.full);

    res.json({
      ok: true,
      filename: target.name,
      dir: target.dir,
      path: target.full
    });

  } catch (e) {
    console.error('[saveCollageAudio]', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ============================================================
// 起動
// ============================================================
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Proxy listening on http://0.0.0.0:${port}`);
  console.log(`logs base = ${LOGS_BASE}`);
});