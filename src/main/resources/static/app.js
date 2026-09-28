const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const $ = (id) => document.getElementById(id);
const els = {
    card: $("card"), direction: $("direction"), prompt: $("prompt"), heard: $("heard"),
    feedback: $("feedback"), timerBar: $("timer-bar"),
    start: $("start"), pause: $("pause"), skip: $("skip"), stop: $("stop"),
    timeout: $("timeout"), mode: $("mode"), info: $("info"),
    correct: $("correct"), wrong: $("wrong"), streak: $("streak"), bestStreak: $("best-streak"),
    sounds: $("sounds"), speakPrompt: $("speak-prompt"), voiceIt: $("voice-it"), voiceEn: $("voice-en"),
    mic: $("mic"), judge: $("judge"), judgeOk: $("judge-ok"), judgeKo: $("judge-ko"),
};

const DIRECTION_LABEL = {
    IT_TO_EN: "🇮🇹 → 🇬🇧  Dillo in inglese",
    EN_TO_IT: "🇬🇧 → 🇮🇹  Dillo in italiano",
};
const PAUSE_AFTER_CORRECT_MS = 1500;
const PAUSE_AFTER_WRONG_MS = 2500;
const RETRY_MS = 3000;

// correct/wrong belong to the current game; streak and bestStreak come from the server (saved stats)
const score = { correct: 0, wrong: 0, streak: 0, bestStreak: 0 };
let running = false;
let current = null;      // current question
let round = 0;           // incremented on every question: invalidates callbacks from older rounds
let recognition = null;
let deadlineTimer = null;
let nextTimer = null;
// Pause takes effect only once the current question is over (answered or timed out)
let pauseRequested = false;
let paused = false;
// with the mic off an adult judges the answer with the ✔ / ✘ buttons
let micOn = !!SpeechRecognition && storageGet("mic") !== "off";

async function init() {
    if (!SpeechRecognition) {
        $("unsupported").hidden = false;
        els.mic.disabled = true;
    }
    updateMicButton();
    try {
        const cfg = await api("/api/config");
        els.timeout.value = cfg.answerTimeoutSeconds;
        els.info.textContent = `${cfg.verbCount} verbi caricati. Tempo predefinito dal server: ${cfg.answerTimeoutSeconds}s.`;
    } catch (e) {
        console.warn(e);
        els.info.textContent = "Il server non risponde: ricarica la pagina quando è di nuovo attivo.";
    }
    await loadStats();
}

// fetch that fails both on network errors and on HTTP errors (e.g. 404 after the verbs file changed)
async function api(url, options) {
    const r = await fetch(url, options);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
}

function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

// ---------- Voice ----------
// Chrome uses the default (English) voice unless we set one explicitly: pick the best one for each language.
const VOICE_SELECTS = { it: els.voiceIt, en: els.voiceEn };
// novelty or low-quality macOS voices to avoid
const BAD_VOICES = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

function voiceScore(v) {
    let score = 0;
    if (/premium|enhanced|natural|neural|siri/i.test(v.name)) score += 30;
    if (/google/i.test(v.name)) score += 20;
    if (/alice|federica|emma|luca|paola|samantha|ava|daniel|serena|karen/i.test(v.name)) score += 10;
    if (/en-(US|GB)/i.test(v.lang)) score += 5;
    if (BAD_VOICES.test(v.name)) score -= 100;
    return score;
}

function loadVoices() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    for (const [lang, select] of Object.entries(VOICE_SELECTS)) {
        const matching = voices
            .filter((v) => v.lang.toLowerCase().startsWith(lang))
            .sort((a, b) => voiceScore(b) - voiceScore(a));
        const saved = storageGet(`voice-${lang}`);
        select.innerHTML = "";
        for (const v of matching) {
            select.add(new Option(`${v.name} (${v.lang})`, v.name, false, v.name === saved));
        }
        if (!matching.some((v) => v.name === saved) && matching.length) select.selectedIndex = 0;
    }
}

function voiceFor(lang) {
    const name = VOICE_SELECTS[lang.slice(0, 2)]?.value;
    return speechSynthesis.getVoices().find((v) => v.name === name) || null;
}

function speak(text, lang) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) return resolve();
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.voice = voiceFor(lang);
        u.rate = 0.9;
        // Chrome sometimes never fires onend: don't get stuck
        const safety = setTimeout(resolve, 5000);
        u.onend = u.onerror = () => { clearTimeout(safety); resolve(); };
        speechSynthesis.speak(u);
    });
}

// ---------- Sounds ----------
let audioCtx = null;

function tone(freq, start, duration, type, volume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = audioCtx.currentTime + start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration);
}

function beep(freq, duration) {
    if (els.sounds.checked && audioCtx) tone(freq, 0, duration, "sine", 0.3);
}

function playSound(correct) {
    if (!els.sounds.checked || !audioCtx) return;
    if (correct) {
        // cheerful C-E-G-C arpeggio
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.35, "triangle", 0.25));
    } else {
        // two descending notes "bwoo-bwoo"
        tone(311.13, 0, 0.25, "sawtooth", 0.12);
        tone(233.08, 0.22, 0.45, "sawtooth", 0.12);
    }
}

function timeoutSeconds() {
    const v = parseInt(els.timeout.value, 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
}

async function nextQuestion() {
    if (!running) return;
    const myRound = ++round;
    const params = new URLSearchParams();
    if (els.mode.value) params.set("direction", els.mode.value);
    if (current) params.set("exclude", current.verbKey);
    let question;
    try {
        question = await api(`/api/question?${params}`);
    } catch (e) {
        if (!running || myRound !== round) return;
        console.warn(e);
        showOffline();
        scheduleNext(RETRY_MS);
        return;
    }
    if (!running || myRound !== round) return;
    current = question;

    els.card.className = "card";
    els.direction.textContent = DIRECTION_LABEL[current.direction];
    els.prompt.textContent = current.prompt;
    els.heard.textContent = "";
    els.feedback.textContent = "";
    els.judge.hidden = true;
    resetTimerBar();

    // the timer starts after the prompt is read, so the mic doesn't pick up the computer's voice
    if (els.speakPrompt.checked) await speak(current.prompt, current.promptLang);
    if (!running || myRound !== round || current.answered) return;

    current.answering = true;
    startTimerBar(timeoutSeconds());
    deadlineTimer = setTimeout(() => onDeadline(myRound), timeoutSeconds() * 1000);
    if (micOn) listen(myRound);
    else els.judge.hidden = false;
}

function onDeadline(myRound) {
    if (myRound !== round || !current || current.answered) return;
    if (micOn) return finish(myRound, []);
    // mic off: show the answer and wait for the ✔ / ✘ judgement
    current.revealed = true;
    els.feedback.textContent = `La risposta era: ${formatAnswers(current.answers)} — com'è andata?`;
    els.judge.hidden = false;
}

function listen(myRound) {
    recognition = new SpeechRecognition();
    recognition.lang = current.answerLang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.continuous = false;

    recognition.onresult = (event) => {
        if (myRound !== round) return;
        const result = event.results[event.results.length - 1];
        const alternatives = Array.from(result).map((a) => a.transcript.trim()).filter(Boolean);
        els.heard.textContent = alternatives[0] ? `Ho sentito: “${alternatives[0]}”` : "";
        if (result.isFinal) finish(myRound, alternatives);
    };
    // Chrome stops recognition after some silence: restart it if there is still time.
    recognition.onend = () => {
        if (running && micOn && myRound === round && current && !current.answered) {
            try { recognition.start(); } catch (_) { /* already started */ }
        }
    };
    recognition.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            els.feedback.textContent = "Microfono non consentito: giudica tu con ✔ / ✘";
            setMic(false);
        }
    };
    recognition.start();
}

// selfAssessed: true/false when the judgement comes from the buttons (or "Non lo so"), null with the mic
async function finish(myRound, spoken, selfAssessed = null) {
    if (myRound !== round || !current || current.answered) return;
    current.answered = true;
    clearTimeout(deadlineTimer);
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();
    freezeTimerBar();
    els.judge.hidden = true;

    let result;
    try {
        result = await api("/api/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verbKey: current.verbKey, direction: current.direction, spoken, selfAssessed }),
        });
    } catch (e) {
        if (myRound !== round) return;
        console.warn(e);
        // the answer could not be checked or saved: show the known answers and carry on
        els.card.className = "card";
        els.feedback.textContent = `Il server non risponde, risposta non salvata. Era: ${formatAnswers(current.answers)}`;
        scheduleNext(PAUSE_AFTER_WRONG_MS);
        return;
    }
    if (myRound !== round) return;

    score.streak = result.currentStreak;
    score.bestStreak = result.bestStreak;
    if (result.correct) {
        score.correct++;
        els.card.className = "card correct";
        els.feedback.textContent = `Giusto! ${formatAnswers(result.expected)}`;
        if (result.newRecord) els.feedback.textContent += ` — Nuovo record! 🏆`;
    } else {
        score.wrong++;
        els.card.className = "card wrong";
        els.feedback.textContent = `${spoken.length ? "Sbagliato" : "La risposta era"}: ${formatAnswers(result.expected)}`;
    }
    updateScore();
    playSound(result.correct);
    loadStats();
    if (!result.correct && els.speakPrompt.checked) {
        // after the sound, say the correct answer; the next question starts only once it has finished,
        // so the mic doesn't pick up the computer's voice
        await wait(700);
        if (myRound !== round) return;
        await speak(result.expected[0], current.answerLang);
        if (myRound !== round) return;
    }
    scheduleNext(result.correct ? PAUSE_AFTER_CORRECT_MS : PAUSE_AFTER_WRONG_MS);
}

// Show at most MAX_SHOWN_ANSWERS accepted answers, then "…"
const MAX_SHOWN_ANSWERS = 3;
function formatAnswers(answers) {
    const shown = answers.slice(0, MAX_SHOWN_ANSWERS).join(" / ");
    return answers.length > MAX_SHOWN_ANSWERS ? `${shown} …` : shown;
}

function showOffline() {
    els.card.className = "card";
    els.direction.textContent = "Il server non risponde, riprovo tra poco…";
    els.prompt.textContent = "⏳";
    els.heard.textContent = "";
    els.feedback.textContent = "";
    els.judge.hidden = true;
    resetTimerBar();
    els.timerBar.style.transform = "scaleX(0)";
}

function stopListening() {
    if (!recognition) return;
    recognition.onend = null;
    recognition.onresult = null;
    try { recognition.abort(); } catch (_) { /* ignore */ }
    recognition = null;
}

function resetTimerBar() {
    els.timerBar.style.transition = "none";
    els.timerBar.style.transform = "scaleX(1)";
}
function startTimerBar(seconds) {
    void els.timerBar.offsetWidth; // force a reflow so the animation restarts
    els.timerBar.style.transition = `transform ${seconds}s linear`;
    els.timerBar.style.transform = "scaleX(0)";
}
function freezeTimerBar() {
    const current = getComputedStyle(els.timerBar).transform;
    els.timerBar.style.transition = "none";
    els.timerBar.style.transform = current;
}

function updateScore() {
    els.correct.textContent = score.correct;
    els.wrong.textContent = score.wrong;
    els.streak.textContent = score.streak;
    els.bestStreak.textContent = score.bestStreak;
}

function startGame() {
    // the AudioContext must be created after a user click, otherwise the browser blocks it
    if (!audioCtx && window.AudioContext) audioCtx = new AudioContext();
    audioCtx?.resume();
    running = true;
    paused = false;
    pauseRequested = false;
    // after the first start, "Inizia" is replaced by the pause/resume button
    els.start.hidden = true;
    els.pause.hidden = false;
    els.skip.disabled = false;
    els.stop.disabled = false;
    updatePauseButton();
    countdown();
}

// Goes on to the next question, or pauses if a pause was requested in the meantime
function scheduleNext(ms) {
    nextTimer = setTimeout(() => (pauseRequested ? enterPause() : nextQuestion()), ms);
}

function enterPause() {
    paused = true;
    pauseRequested = false;
    round++;
    els.skip.disabled = true;
    els.judge.hidden = true;
    els.card.className = "card";
    els.direction.textContent = "In pausa: premi “Riprendi” per continuare";
    els.prompt.textContent = "⏸";
    els.heard.textContent = "";
    resetTimerBar();
    els.timerBar.style.transform = "scaleX(0)";
    updatePauseButton();
}

function onPauseClick() {
    if (!running || paused) return startGame();
    // a second click before the question ends cancels the request
    pauseRequested = !pauseRequested;
    updatePauseButton();
}

function updatePauseButton() {
    const waiting = running && !paused && pauseRequested;
    els.pause.textContent = !running || paused ? "▶ Riprendi" : waiting ? "⏳ Pausa a fine domanda" : "⏸ Pausa";
    els.pause.title = waiting ? "Clicca di nuovo per annullare la pausa" : "";
    els.pause.classList.toggle("pending", waiting);
}

// 3, 2, 1, Go! before the first question
async function countdown() {
    const myRound = ++round;
    els.card.className = "card countdown";
    els.direction.textContent = "Preparati…";
    els.heard.textContent = "";
    els.feedback.textContent = "";
    resetTimerBar();
    els.timerBar.style.transform = "scaleX(0)";
    for (const n of ["3", "2", "1"]) {
        els.prompt.textContent = n;
        beep(660, 0.15);
        await wait(1000);
        if (!running || myRound !== round) return;
    }
    els.prompt.textContent = "Via!";
    beep(990, 0.35);
    await wait(600);
    if (!running || myRound !== round) return;
    if (pauseRequested) enterPause();
    else nextQuestion();
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopGame() {
    running = false;
    paused = false;
    pauseRequested = false;
    round++;
    current = null;
    clearTimeout(deadlineTimer);
    clearTimeout(nextTimer);
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();
    els.judge.hidden = true;
    resetTimerBar();
    els.timerBar.style.transform = "scaleX(0)";
    els.skip.disabled = true;
    els.stop.disabled = true;
    updatePauseButton();
    els.card.className = "card";
    els.direction.textContent = "Premi “Riprendi” e rispondi a voce!";
    els.prompt.textContent = "🎤";
}

els.start.addEventListener("click", startGame);
els.pause.addEventListener("click", onPauseClick);
els.stop.addEventListener("click", stopGame);
els.skip.addEventListener("click", () => {
    if (current && !current.answered) finish(round, [], false);
});
els.judgeOk.addEventListener("click", () => finish(round, [], true));
els.judgeKo.addEventListener("click", () => finish(round, [], false));
els.mic.addEventListener("click", () => setMic(!micOn));

// ---------- Mic on/off ----------
function updateMicButton() {
    els.mic.textContent = micOn ? "🎤 Microfono attivo" : "🔇 Microfono spento";
    els.mic.classList.toggle("off", !micOn);
}

// Can be toggled during a question too: takes effect immediately
function setMic(on) {
    micOn = on && !!SpeechRecognition;
    storageSet("mic", micOn ? "on" : "off");
    updateMicButton();
    if (!running || !current || current.answered || !current.answering) return;
    if (micOn) {
        if (!current.revealed) {
            els.judge.hidden = true;
            listen(round);
        }
    } else {
        stopListening();
        els.judge.hidden = false;
    }
}

// ---------- Voice settings ----------
els.speakPrompt.checked = storageGet("speak-prompt") !== "off";
els.speakPrompt.addEventListener("change", () => storageSet("speak-prompt", els.speakPrompt.checked ? "on" : "off"));
if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
}
for (const [lang, select] of Object.entries(VOICE_SELECTS)) {
    select.addEventListener("change", () => storageSet(`voice-${lang}`, select.value));
}
$("test-it").addEventListener("click", () => speak("diventare, guidare, mangiare", "it-IT"));
$("test-en").addEventListener("click", () => speak("become, drive, eat", "en-US"));

els.sounds.checked = storageGet("sounds") !== "off";
els.sounds.addEventListener("change", () => {
    storageSet("sounds", els.sounds.checked ? "on" : "off");
    if (!audioCtx && window.AudioContext) audioCtx = new AudioContext();
    playSound(true);
});

// ---------- Statistics ----------
function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function pct(value) {
    return value == null ? "–" : `${value}%`;
}

async function loadStats() {
    let s;
    try {
        s = await api("/api/stats");
    } catch (e) {
        console.warn(e);
        return;
    }
    score.streak = s.currentStreak;
    score.bestStreak = s.bestStreak;
    updateScore();

    $("since").textContent = `Statistiche dal ${formatDate(s.since)}`;
    $("percent").textContent = pct(s.percent);
    $("percent-detail").textContent = `${s.correct} su ${s.total}`;
    $("best").textContent = s.bestStreak;
    $("best-at").textContent = s.bestStreakAt ? formatDate(s.bestStreakAt) : "";
    $("current").textContent = s.currentStreak;
    $("mastered").textContent = `${s.verbsMastered} / ${s.verbCount}`;
    $("mastered-detail").textContent = `${s.verbsSeen} verbi già usciti`;

    for (const d of s.byDirection) {
        const prefix = d.direction === "IT_TO_EN" ? "it-en" : "en-it";
        $(prefix).textContent = pct(d.percent);
        $(`${prefix}-detail`).textContent = `${d.correct} su ${d.total}`;
    }

    const body = $("wrong-list");
    body.innerHTML = "";
    s.mostWrong.forEach((v, i) => {
        const tr = document.createElement("tr");
        const recent = v.recent.map((ok) => `<span class="dot ${ok ? "ok" : "ko"}"></span>`).join("");
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><b></b> <span class="it"></span></td>
            <td class="num">${v.wrong}</td>
            <td class="num">${v.attempts}</td>
            <td class="num">${v.errorPercent}%</td>
            <td class="recent">${recent}</td>`;
        tr.querySelector("b").textContent = v.english;
        tr.querySelector(".it").textContent = v.italian;
        body.appendChild(tr);
    });
    $("no-wrong").hidden = s.mostWrong.length > 0;

    lastStats = s;
    renderTrendSummary(s.trend);
    renderDailyTable(s.daily);
    renderChart();
}

// ---------- Trend chart ----------
let lastStats = null;
let chartView = storageGet("chart-view") === "daily" ? "daily" : "rolling";
const SVG_NS = "http://www.w3.org/2000/svg";
/** Below this change (in percentage points) the trend counts as stable. */
const TREND_STABLE_POINTS = 5;

function svgEl(tag, attrs = {}, parent = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
}

function parseDay(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function renderTrendSummary(trend) {
    const box = $("trend-summary");
    box.replaceChildren();
    if (!trend) {
        box.textContent = "Servono almeno 10 risposte per vedere la tendenza.";
        return;
    }
    const kind = trend.delta >= TREND_STABLE_POINTS ? "up" : trend.delta <= -TREND_STABLE_POINTS ? "down" : "flat";
    const badge = document.createElement("span");
    badge.className = `trend-badge ${kind}`;
    badge.textContent = { up: "↗ In miglioramento", down: "↘ In calo", flat: "→ Stabile" }[kind];
    const sign = trend.delta > 0 ? "+" : "";
    box.append(
        badge,
        `${trend.recentPercent}% giuste nelle ultime ${trend.window} risposte, ` +
        `contro ${trend.previousPercent}% nelle ${trend.window} precedenti (${sign}${trend.delta} punti)`,
    );
}

function renderDailyTable(daily) {
    const body = $("daily-table");
    body.replaceChildren();
    for (const d of [...daily].reverse()) {
        const tr = document.createElement("tr");
        for (const [text, cls] of [
            [parseDay(d.date).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }), ""],
            [d.correct, "num"], [d.total, "num"], [`${d.percent}%`, "num"],
        ]) {
            const td = document.createElement("td");
            td.textContent = text;
            if (cls) td.className = cls;
            tr.appendChild(td);
        }
        body.appendChild(tr);
    }
}

/** Points to plot for the current view: { value (0-100), label (x axis), tip (tooltip detail) } */
function chartPoints(s) {
    if (chartView === "daily") {
        return s.daily.map((d) => {
            const day = parseDay(d.date);
            return {
                value: d.percent,
                label: day.toLocaleDateString("it-IT", { day: "numeric", month: "short" }),
                tip: `${day.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })} · ${d.correct} giuste su ${d.total}`,
            };
        });
    }
    // rolling[i] averages answers first+i .. first+i+window-1 (numbered from 1 over the whole history)
    const span = Math.min(s.answersRecorded, s.rolling.length + s.rollingWindow - 1);
    const first = s.answersRecorded - span + 1;
    return s.rolling.map((value, i) => {
        const last = first + i + s.rollingWindow - 1;
        return { value, label: `n° ${last}`, tip: `risposte ${last - s.rollingWindow + 1}–${last}` };
    });
}

function renderChart() {
    const box = $("chart");
    box.replaceChildren();
    for (const b of document.querySelectorAll(".segmented button")) {
        b.setAttribute("aria-pressed", String(b.dataset.view === chartView));
    }
    $("chart-note").textContent = chartView === "daily"
        ? "Percentuale di risposte giuste in ogni giorno di gioco."
        : `Ogni punto è la percentuale di risposte giuste su ${lastStats?.rollingWindow ?? 20} risposte di fila (ultime 200 risposte).`;
    if (!lastStats) return;

    const pts = chartPoints(lastStats);
    if (!pts.length) {
        const p = document.createElement("p");
        p.className = "chart-empty";
        p.textContent = chartView === "daily"
            ? "Ancora nessuna risposta registrata."
            : `Servono almeno ${lastStats.rollingWindow} risposte per disegnare l'andamento.`;
        box.appendChild(p);
        return;
    }

    const W = Math.max(box.clientWidth, 280);
    const H = 220;
    const m = { l: 40, r: 44, t: 14, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const x = (i) => m.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => m.t + ih * (1 - v / 100);

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, tabindex: "0", role: "img" }, box);
    const lastPt = pts[pts.length - 1];
    svg.setAttribute("aria-label", `Andamento: ${pts.length} punti, ultimo valore ${lastPt.value}%. Usa le frecce per scorrere.`);

    for (const v of [0, 25, 50, 75, 100]) {
        svgEl("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
        svgEl("text", { class: "tick", x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = `${v}%`;
    }

    // x labels: first, last and (if there is room) the middle one
    const xLabels = pts.length === 1 ? [0] : pts.length < 3 ? [0, pts.length - 1] : [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    for (const i of xLabels) {
        const anchor = pts.length === 1 ? "middle" : i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
        svgEl("text", { class: "tick", x: x(i), y: H - 6, "text-anchor": anchor }, svg).textContent = pts[i].label;
    }

    if (pts.length > 1) {
        const linePath = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
        svgEl("path", { class: "area", d: `${linePath} L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z` }, svg);
        svgEl("path", { class: "line", d: linePath }, svg);
    }
    const n = pts.length - 1;
    svgEl("circle", { class: "dot", cx: x(n), cy: y(lastPt.value), r: 4 }, svg);
    svgEl("text", { class: "end-label", x: x(n) + 8, y: y(lastPt.value) + 4 }, svg).textContent = `${lastPt.value}%`;

    // hover / keyboard layer: crosshair snapping to the nearest point + tooltip
    const crosshair = svgEl("line", { class: "crosshair", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
    const hoverDot = svgEl("circle", { class: "dot", r: 5, visibility: "hidden" }, svg);
    const overlay = svgEl("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    box.appendChild(tooltip);

    let active = n;
    const show = (i) => {
        active = Math.max(0, Math.min(n, i));
        const p = pts[active];
        const scale = box.clientWidth / W;
        for (const attr of ["x1", "x2"]) crosshair.setAttribute(attr, x(active));
        hoverDot.setAttribute("cx", x(active));
        hoverDot.setAttribute("cy", y(p.value));
        crosshair.setAttribute("visibility", "visible");
        hoverDot.setAttribute("visibility", "visible");
        const value = document.createElement("b");
        value.textContent = `${p.value}%`;
        tooltip.replaceChildren(value, p.tip);
        tooltip.style.left = `${Math.min(Math.max(x(active) * scale, 70), box.clientWidth - 70)}px`;
        tooltip.style.top = `${y(p.value) * scale}px`;
        tooltip.hidden = false;
    };
    const hide = () => {
        crosshair.setAttribute("visibility", "hidden");
        hoverDot.setAttribute("visibility", "hidden");
        tooltip.hidden = true;
    };
    overlay.addEventListener("pointermove", (e) => {
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) * W) / rect.width;
        show(n === 0 ? 0 : Math.round(((px - m.l) / iw) * n));
    });
    overlay.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(active));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") show(active - 1);
        else if (e.key === "ArrowRight") show(active + 1);
        else return;
        e.preventDefault();
    });
}

for (const b of document.querySelectorAll(".segmented button")) {
    b.addEventListener("click", () => {
        chartView = b.dataset.view;
        storageSet("chart-view", chartView);
        renderChart();
    });
}
window.addEventListener("resize", renderChart);

$("reset").addEventListener("click", async () => {
    if (!confirm("Vuoi davvero azzerare tutte le statistiche? Non si può annullare.")) return;
    try {
        await api("/api/stats", { method: "DELETE" });
    } catch (e) {
        console.warn(e);
        alert("Il server non risponde: statistiche non azzerate.");
        return;
    }
    // also reset the ✔ / ✘ counters of the current game
    score.correct = 0;
    score.wrong = 0;
    loadStats();
});

init();
