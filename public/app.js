(() => {
  const $ = sel => document.querySelector(sel);

  const state = {
    questions: [],
    idx: 0,
    answers: [null, null],
    mediaRecorder: null,
    chunks: [],
    timerId: null,
    startedAt: 0,
    limitSec: 180,
    mime: null,
  };

  const els = {
    start: $('#btnStart'),
    note: $('#supportNote'),
    qa: $('#qa'),
    qIndex: $('#qIndex'),
    qText: $('#qText'),
    qAudio: $('#qAudio'),
    playQ: $('#btnPlayQ'),
    rec: $('#btnRec'),
    timer: $('#timer'),
    aAudio: $('#aAudio'),
    transcribe: $('#btnTranscribe'),
    aText: $('#aText'),
    next: $('#btnNext'),
    finish: $('#finish'),
    full: $('#fullTranscript'),
    download: $('#btnDownload'),
    reset: $('#btnReset'),
  };

  function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function detectMime() {
    const preferred = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/aac'];
    for (const m of preferred) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  async function loadQuestions() {
    const r = await fetch('/api/questions');
    const data = await r.json();
    state.questions = (data && data.items) || [];
  }

  function setQuestion(i) {
    const q = state.questions[i];
    els.qIndex.textContent = String(i + 1);
    els.qText.textContent = q.text;

    // audio jest opcjonalne — pokaż tylko gdy mamy URL
    if (q.audioUrl) {
      els.qAudio.src = q.audioUrl;
      els.qAudio.classList.remove('hidden');
      els.playQ.disabled = false;
    } else {
      els.qAudio.src = '';
      els.qAudio.classList.add('hidden');
      els.playQ.disabled = true;
    }

    els.aAudio.classList.add('hidden');
    els.aAudio.src = '';
    els.aText.textContent = '';
    els.transcribe.disabled = true;
    els.next.disabled = true;
  }

  function updateTimer() {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    els.timer.textContent = formatTime(Math.min(elapsed, state.limitSec));
    if (elapsed >= state.limitSec) stopRecording();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Twoja przeglądarka nie obsługuje nagrywania audio. Użyj najnowszego Chrome lub Safari.');
      return;
    }
    state.mime = detectMime();
    if (!state.mime) {
      alert('Brak wsparcia MediaRecorder dla audio. Użyj najnowszego Chrome lub Safari.');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
    state.chunks = [];
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: state.mime });

    state.mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) state.chunks.push(e.data); };
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.chunks, { type: state.mime });
      els.aAudio.src = URL.createObjectURL(blob);
      els.aAudio.classList.remove('hidden');
      els.transcribe.disabled = false;
      stream.getTracks().forEach(t => t.stop());
    };

    state.mediaRecorder.start();
    state.startedAt = Date.now();
    els.rec.textContent = '⏹ Zatrzymaj';
    state.timerId = setInterval(updateTimer, 200);
  }

  function stopRecording() {
    if (!state.mediaRecorder) return;
    try { state.mediaRecorder.stop(); } catch {}
    clearInterval(state.timerId);
    els.rec.textContent = '● Nagrywaj (max 180 s)';
  }

  async function sendToTranscribe() {
    const blob = new Blob(state.chunks, { type: state.mime || 'audio/webm' });
    const qIdx = state.idx;
    const filename = state.mime?.includes('mp4') || state.mime?.includes('aac') ? `answer${qIdx+1}.mp4` : `answer${qIdx+1}.webm`;

    const fd = new FormData();
    fd.append('audio', blob, filename);

    els.transcribe.disabled = true;
    els.transcribe.textContent = 'Transkrybuję…';

    try {
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || data?.error || 'Błąd');

      const text = (data.text || '').trim();
      const qText = state.questions[qIdx].text;
      els.aText.textContent = text || '(pusta transkrypcja)';
      state.answers[qIdx] = { blob, text, qText };
      els.next.disabled = false;
    } catch (e) {
      alert('Błąd transkrypcji: ' + e.message);
      els.transcribe.disabled = false;
    } finally {
      els.transcribe.textContent = 'Wyślij do transkrypcji';
    }
  }

  function buildFullTranscript() {
    const parts = state.answers.map((a, i) => `Pytanie ${i+1}: ${a.qText}\nOdpowiedź ${i+1}: ${a.text}\n`);
    return parts.join('\n');
  }

  function downloadTxt(text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transkrypcja_rozmowy.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Zdarzenia ---
  els.start.addEventListener('click', async () => {
    const mime = detectMime();
    els.note.textContent = mime && mime.includes('webm')
      ? 'Nagranie w formacie WebM/Opus.'
      : mime ? `Twoja przeglądarka nagrywa w: ${mime}. Whisper i tak obsłuży.` : 'MediaRecorder: brak wsparcia (zaktualizuj przeglądarkę).';

    await loadQuestions();
    if (!state.questions.length) return alert('Brak pytań.');

    state.idx = 0;
    setQuestion(0);
    document.querySelector('#setup').classList.add('hidden');
    els.qa.classList.remove('hidden');
  });

  els.playQ.addEventListener('click', () => { if (!els.playQ.disabled) els.qAudio.play(); });
  els.rec.addEventListener('click', () => {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') { stopRecording(); }
    else { els.timer.textContent = '00:00'; startRecording(); }
  });

  els.transcribe.addEventListener('click', sendToTranscribe);
  els.next.addEventListener('click', () => {
    if (state.idx === 0) { state.idx = 1; setQuestion(1); }
    else {
      const full = buildFullTranscript();
      els.full.textContent = full;
      els.qa.classList.add('hidden');
      els.finish.classList.remove('hidden');
    }
  });

  els.download.addEventListener('click', () => downloadTxt(els.full.textContent));
  els.reset.addEventListener('click', () => window.location.reload());
})();
