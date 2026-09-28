const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const $ = (id) => document.getElementById(id);
const els = {
    card: $("card"), direction: $("direction"), prompt: $("prompt"), heard: $("heard"),
    feedback: $("feedback"), timerBar: $("timer-bar"),
    start: $("start"), skip: $("skip"), stop: $("stop"),
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

// correct/wrong sono della partita in corso; streak e bestStreak arrivano dal server (statistiche salvate)
const score = { correct: 0, wrong: 0, streak: 0, bestStreak: 0 };
let running = false;
let current = null;      // domanda in corso
let round = 0;           // incrementato a ogni domanda: invalida callback di round vecchi
let recognition = null;
let deadlineTimer = null;
let nextTimer = null;
// col microfono spento la risposta la giudica un adulto con i pulsanti ✔ / ✘
let micOn = !!SpeechRecognition && storageGet("mic") !== "off";

async function init() {
    if (!SpeechRecognition) {
        $("unsupported").hidden = false;
        els.mic.disabled = true;
    }
    updateMicButton();
    const cfg = await fetch("/api/config").then((r) => r.json());
    els.timeout.value = cfg.answerTimeoutSeconds;
    els.info.textContent = `${cfg.verbCount} verbi caricati. Tempo predefinito dal server: ${cfg.answerTimeoutSeconds}s.`;
    await loadStats();
}

function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

// ---------- Voce ----------
// Chrome usa la voce di default (inglese) se non gliene diamo una esplicitamente: scegliamo la migliore per lingua.
const VOICE_SELECTS = { it: els.voiceIt, en: els.voiceEn };
// voci "buffe" o di bassa qualità di macOS da evitare
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
        // a volte Chrome non chiama onend: non restiamo bloccati
        const safety = setTimeout(resolve, 5000);
        u.onend = u.onerror = () => { clearTimeout(safety); resolve(); };
        speechSynthesis.speak(u);
    });
}

// ---------- Suoni ----------
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
        // arpeggio allegro Do-Mi-Sol-Do
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.35, "triangle", 0.25));
    } else {
        // due note discendenti "bwoo-bwoo"
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
    if (current) params.set("exclude", current.verbId);
    current = await fetch(`/api/question?${params}`).then((r) => r.json());
    if (!running || myRound !== round) return;

    els.card.className = "card";
    els.direction.textContent = DIRECTION_LABEL[current.direction];
    els.prompt.textContent = current.prompt;
    els.heard.textContent = "";
    els.feedback.textContent = "";
    els.judge.hidden = true;
    resetTimerBar();

    // il tempo parte dopo la lettura, così il microfono non sente la voce del computer
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
    // microfono spento: mostriamo la risposta e aspettiamo il giudizio ✔ / ✘
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
    // Chrome chiude il riconoscimento dopo un po' di silenzio: se c'è ancora tempo, riparte.
    recognition.onend = () => {
        if (running && micOn && myRound === round && current && !current.answered) {
            try { recognition.start(); } catch (_) { /* già avviato */ }
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

// selfAssessed: true/false quando il giudizio arriva dai pulsanti (o da "Non lo so"), null col microfono
async function finish(myRound, spoken, selfAssessed = null) {
    if (myRound !== round || !current || current.answered) return;
    current.answered = true;
    clearTimeout(deadlineTimer);
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();
    freezeTimerBar();
    els.judge.hidden = true;

    const result = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbId: current.verbId, direction: current.direction, spoken, selfAssessed }),
    }).then((r) => r.json());
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
        // dopo il suono, pronuncia la risposta giusta; la domanda successiva parte solo quando ha finito,
        // così il microfono non sente la voce del computer
        await wait(700);
        if (myRound !== round) return;
        await speak(result.expected[0], current.answerLang);
        if (myRound !== round) return;
    }
    nextTimer = setTimeout(nextQuestion, result.correct ? PAUSE_AFTER_CORRECT_MS : PAUSE_AFTER_WRONG_MS);
}

// Mostra al massimo MAX_SHOWN_ANSWERS risposte accettate, poi "…"
const MAX_SHOWN_ANSWERS = 3;
function formatAnswers(answers) {
    const shown = answers.slice(0, MAX_SHOWN_ANSWERS).join(" / ");
    return answers.length > MAX_SHOWN_ANSWERS ? `${shown} …` : shown;
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
    void els.timerBar.offsetWidth; // forza il reflow per far ripartire l'animazione
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
    // l'AudioContext va creato dopo un click dell'utente, altrimenti il browser lo blocca
    if (!audioCtx && window.AudioContext) audioCtx = new AudioContext();
    audioCtx?.resume();
    running = true;
    els.start.disabled = true;
    els.skip.disabled = false;
    els.stop.disabled = false;
    countdown();
}

// 3, 2, 1, Via! prima della prima domanda
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
    nextQuestion();
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopGame() {
    running = false;
    round++;
    current = null;
    clearTimeout(deadlineTimer);
    clearTimeout(nextTimer);
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();
    els.judge.hidden = true;
    resetTimerBar();
    els.timerBar.style.transform = "scaleX(0)";
    els.start.disabled = false;
    els.skip.disabled = true;
    els.stop.disabled = true;
    els.card.className = "card";
    els.direction.textContent = "Premi “Inizia” e rispondi a voce!";
    els.prompt.textContent = "🎤";
}

els.start.addEventListener("click", startGame);
els.stop.addEventListener("click", stopGame);
els.skip.addEventListener("click", () => {
    if (current && !current.answered) finish(round, [], false);
});
els.judgeOk.addEventListener("click", () => finish(round, [], true));
els.judgeKo.addEventListener("click", () => finish(round, [], false));
els.mic.addEventListener("click", () => setMic(!micOn));

// ---------- Microfono on/off ----------
function updateMicButton() {
    els.mic.textContent = micOn ? "🎤 Microfono attivo" : "🔇 Microfono spento";
    els.mic.classList.toggle("off", !micOn);
}

// Si può cambiare anche durante una domanda: vale subito
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

// ---------- Impostazioni voce ----------
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

// ---------- Statistiche ----------
function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function pct(value) {
    return value == null ? "–" : `${value}%`;
}

async function loadStats() {
    const s = await fetch("/api/stats").then((r) => r.json());
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
}

$("reset").addEventListener("click", async () => {
    if (!confirm("Vuoi davvero azzerare tutte le statistiche? Non si può annullare.")) return;
    await fetch("/api/stats", { method: "DELETE" });
    // azzera anche i contatori ✔ / ✘ della partita in corso
    score.correct = 0;
    score.wrong = 0;
    loadStats();
});

init();
