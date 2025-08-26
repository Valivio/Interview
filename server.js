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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Diagnoza klucza (przydaje się przy problemach)
app.get('/api/test-key', async (_req, res) => {
  try {
    const models = await openai.models.list();
    res.json({ ok: true, sample: models.data?.slice(0,1)?.map(m=>m.id) || [] });
  } catch (e) {
    console.error('TEST-KEY ERROR:', e.status, e.code, e.message, e.response?.data || e.response?.text || '');
    res.status(400).json({ ok: false, status: e.status, code: e.code, message: e.message });
  }
});

// Pytania (na start tekstowe; audio jest opcjonalne)
app.get('/api/questions', async (_req, res) => {
  // Jeśli zechcesz, możesz później dodać public/questions/questions.json z audioUrl
  res.json({
    items: [
      { id: 1, text: 'Opowiedz krótko o sobie i swoim doświadczeniu. Podkreśl umiejętności istotne dla stanowiska.' },
      { id: 2, text: 'Z jakiego osiągnięcia zawodowego jesteś najbardziej dumny i dlaczego? Opisz też swój wkład.' }
    ]
  });
});

// Transkrypcja (Whisper)
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku audio.' });

    const ext = (req.file.originalname && path.extname(req.file.originalname)) || (req.file.mimetype?.includes('mp4') ? '.mp4' : '.webm');
    const tmpPath = path.join(os.tmpdir(), `upload-${Date.now()}${ext}`);
    await fsp.writeFile(tmpPath, req.file.buffer);

    let text = '';
    try {
      const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'pl'
      });
      text = result.text || '';
    } catch (e) {
      console.error('WHISPER ERROR:', e.status, e.code, e.message, e.response?.data || e.response?.text || '');
      return res.status(e.status || 500).json({
        error: 'Transcription error',
        status: e.status,
        code: e.code,
        message: e.message
      });
    } finally {
      fsp.unlink(tmpPath).catch(()=>{});
    }

    res.json({ text });
  } catch (err) {
    console.error('SERVER ERROR:', err);
    res.status(500).json({ error: 'Server error', details: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✔ Server działa na http://localhost:${PORT}`));
