// server.js — wersja „all-in-one”, Render-ready
// ----------------------------------------------
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();
const OpenAI = require('openai');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());

// Serwuj statyki (index.html, app.js, audio, itd.)
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ---------- Pomocnicze ----------
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error('Brak OPENAI_API_KEY (ustaw w Render → Environment)');
    err.status = 400;
    throw err;
  }
  return new OpenAI({ apiKey: key });
}

async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; } catch { return false; }
}

async function loadQuestionsFromJson() {
  const qJsonPath = path.join(PUBLIC_DIR, 'questions', 'questions.json');
  if (!(await fileExists(qJsonPath))) return null;
  try {
    const raw = await fsp.readFile(qJsonPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch (e) {
    console.warn('Nie mogę sparsować questions.json:', e.message);
    return null;
  }
}

async function buildQuestionsFromFiles() {
  // Szukaj plików audio w public/questions/*
  const dir = path.join(PUBLIC_DIR, 'questions');
  if (!(await fileExists(dir))) return null;

  const files = await fsp.readdir(dir);
  const audioFiles = files.filter(f =>
    /\.(mp3|wav|m4a|aac|ogg|webm)$/i.test(f)
  ).sort();

  if (!audioFiles.length) return null;

  // Zbuduj items na podstawie znalezionych plików (Pytanie 1, 2, ...)
  const items = audioFiles.map((fname, idx) => ({
    id: idx + 1,
    text: idx === 0
      ? 'Opowiedz krótko o sobie i swoim doświadczeniu. Podkreśl umiejętności istotne dla stanowiska.'
      : 'Z jakiego osiągnięcia zawodowego jesteś najbardziej dumny i dlaczego? Opisz też swój wkład.',
    audioUrl: `/questions/${fname}`,
  }));

  return { items };
}

function fallbackQuestions() {
  return {
    items: [
      { id: 1, text: 'Opowiedz krótko o sobie i swoim doświadczeniu. Podkreśl umiejętności istotne dla stanowiska.' },
      { id: 2, text: 'Z jakiego osiągnięcia zawodowego jesteś najbardziej dumny i dlaczego? Opisz też swój wkład.' },
    ],
  };
}

// ---------- Endpointy ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/test-key', async (_req, res) => {
  try {
    const openai = getOpenAI();
    const models = await openai.models.list();
    res.json({ ok: true, sample: models.data?.slice(0, 1)?.map(m => m.id) || [] });
  } catch (e) {
    console.error('TEST-KEY ERROR:', e.status || '', e.code || '', e.message);
    res.status(e.status || 400).json({ ok: false, message: e.message });
  }
});

// Pytania: 1) spróbuj JSON, 2) jak brak — wykryj pliki audio, 3) jak brak — fallback
app.get('/api/questions', async (_req, res) => {
  try {
    const fromJson = await loadQuestionsFromJson();
    if (fromJson) return res.json(fromJson);

    const fromFiles = await buildQuestionsFromFiles();
    if (fromFiles) return res.json(fromFiles);

    return res.json(fallbackQuestions());
  } catch (e) {
    console.error('QUESTIONS ERROR:', e);
    return res.json(fallbackQuestions());
  }
});

// Transkrypcja (Whisper)
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku audio.' });

    // Zapisywanie do tymczasowego pliku (SDK wygodnie działa na streamie)
    const original = req.file.originalname || '';
    const ext = path.extname(original) || (req.file.mimetype?.includes('mp4') ? '.mp4' : '.webm');
    const tmpPath = path.join(os.tmpdir(), `upload-${Date.now()}${ext || ''}`);
    await fsp.writeFile(tmpPath, req.file.buffer);

    try {
      const openai = getOpenAI();
      const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'pl',
      });
      return res.json({ text: (result.text || '').trim() });
    } catch (e) {
      console.error('WHISPER ERROR:', e.status || '', e.code || '', e.message, e.response?.data || '');
      return res.status(e.status || 500).json({
        error: 'Transcription error',
        status: e.status,
        code: e.code,
        message: e.message,
      });
    } finally {
      fsp.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    console.error('SERVER ERROR:', err);
    return res.status(500).json({ error: 'Server error', details: String(err.message || err) });
  }
});

// Nasłuch
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✔ Server działa na http://localhost:${PORT}`);
  console.log(`• Statyki: ${PUBLIC_DIR}`);
});
