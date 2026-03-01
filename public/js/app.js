// ========== APP STATE ==========
const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 30000
});
let isHost = false;
let myTeam = null;
let roomCode = null;
let imageCount = 2;
let selectedImages = {};
let currentAnswer = '';
let selectedTeam = null;
let blockedTeams = [];

const $ = id => document.getElementById(id);

// ========== SOUND EFFECTS (Web Audio API) ==========
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new AudioCtx();
    return audioCtx;
}

const SFX = {
    // 🔔 Buzz — loud alarm buzzer
    buzz() {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.15);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
    },

    // ✅ Correct — happy rising chime
    correct() {
        const ctx = getAudioCtx();
        const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.12;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.07, t + 0.02);
            gain.gain.linearRampToValueAtTime(0, t + 0.35);
            osc.start(t);
            osc.stop(t + 0.35);
        });
    },

    // ❌ Wrong — low error tone
    wrong() {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.45);
    },

    // 🚀 Round start — ascending whoosh
    roundStart() {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.07, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    },

    // 🔓 Unblock — short pop
    pop() {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
    },

    // ⏭️ Skip — descending tone
    skip() {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
    }
};

const lobbyScreen = $('lobby-screen');
const gameScreen = $('game-screen');
const hostSection = $('host-section');
const imagesDisplay = $('images-display');
const buzzSection = $('buzz-section');
const buzzedStatus = $('buzzed-status');
const resultOverlay = $('result-overlay');
const closedOverlay = $('closed-overlay');

// ========== LOBBY — TEAM SELECTION ==========
$('room-code-input').addEventListener('input', () => {
    const code = $('room-code-input').value.trim();
    if (code.length === 4) {
        socket.emit('check-room', { roomCode: code }, (res) => {
            if (res.exists) {
                $('team-select-area').classList.remove('hidden');
                $('red-count-display').textContent = `(${res.redCount}/2)`;
                $('blue-count-display').textContent = `(${res.blueCount}/2)`;

                // Mark full teams
                document.querySelectorAll('.team-select-btn').forEach(btn => {
                    btn.classList.remove('full');
                });
                if (res.redCount >= 2) document.querySelector('.red-select').classList.add('full');
                if (res.blueCount >= 2) document.querySelector('.blue-select').classList.add('full');
            } else {
                $('team-select-area').classList.add('hidden');
            }
        });
    } else {
        $('team-select-area').classList.add('hidden');
        selectedTeam = null;
        $('join-btn').disabled = true;
    }
});

document.querySelectorAll('.team-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('full')) return;
        document.querySelectorAll('.team-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedTeam = btn.dataset.team;
        $('join-btn').disabled = false;
    });
});

// ========== LOBBY ACTIONS ==========
$('create-btn').addEventListener('click', () => {
    const name = $('host-name').value.trim() || 'الهوست';
    socket.emit('create-room', { name }, (res) => {
        if (res.success) {
            roomCode = res.roomCode;
            isHost = true;
            enterGame();
        }
    });
});

$('join-btn').addEventListener('click', () => {
    const name = $('player-name').value.trim() || 'لاعب';
    const code = $('room-code-input').value.trim().toUpperCase();
    if (!code) { showJoinError('اكتب رمز الغرفة'); return; }
    if (!selectedTeam) { showJoinError('اختر فريقك'); return; }

    socket.emit('join-room', { name, roomCode: code, team: selectedTeam }, (res) => {
        if (res.success) {
            roomCode = res.roomCode;
            myTeam = res.team;
            isHost = false;
            enterGame();
        } else {
            showJoinError(res.error);
        }
    });
});

$('room-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });
$('host-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create-btn').click(); });

function showJoinError(msg) {
    const el = $('join-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function showError(msg) {
    const el = $('lobby-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ========== ENTER GAME ==========
function enterGame() {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    $('display-room-code').textContent = roomCode;

    if (isHost) {
        hostSection.classList.remove('hidden');
        setupHostControls();
    } else {
        showWaiting();
    }
}

function showWaiting() {
    imagesDisplay.innerHTML = `
    <div class="waiting-message">
      <div class="waiting-icon">⏳</div>
      <p>انتظر الهوست يبدأ الجولة...</p>
    </div>
  `;
    imagesDisplay.classList.remove('hidden');
    buzzSection.classList.add('hidden');
    buzzedStatus.classList.add('hidden');
}

// ========== HOST CONTROLS ==========
function setupHostControls() {
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            imageCount = parseInt(btn.dataset.count);
            selectedImages = {};
            renderImageSlots();
            checkReady();
        });
    });
    renderImageSlots();

    $('start-round-btn').addEventListener('click', startRound);

    // Judge
    $('judge-correct-btn').addEventListener('click', () => {
        socket.emit('judge', { correct: true });
        $('judge-controls').classList.add('hidden');
    });
    $('judge-wrong-btn').addEventListener('click', () => {
        socket.emit('judge', { correct: false });
        $('judge-controls').classList.add('hidden');
    });

    // New round
    $('new-round-btn').addEventListener('click', () => {
        socket.emit('new-round');
        $('host-actions').classList.add('hidden');
        $('judge-controls').classList.add('hidden');
        $('upload-area').classList.remove('hidden');
        resultOverlay.classList.add('hidden');
        selectedImages = {};
        blockedTeams = [];
        renderImageSlots();
        $('answer-input').value = '';
        checkReady();
        updateUnblockButtons();
    });

    // Skip round
    $('skip-round-btn').addEventListener('click', () => {
        socket.emit('skip-round');
    });

    // Unblock team
    $('unblock-red-btn').addEventListener('click', () => {
        socket.emit('unblock-team', { team: 'red' });
    });
    $('unblock-blue-btn').addEventListener('click', () => {
        socket.emit('unblock-team', { team: 'blue' });
    });
}

function renderImageSlots() {
    const container = $('image-slots');
    container.innerHTML = '';
    for (let i = 0; i < imageCount; i++) {
        const slot = document.createElement('div');
        slot.className = 'image-slot';
        slot.innerHTML = `
      <span class="slot-icon">📷</span>
      <span class="slot-text">صورة ${i + 1}</span>
      <input type="file" accept="image/*" data-index="${i}">
    `;
        const input = slot.querySelector('input');
        slot.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => handleImageSelect(e, i, slot));
        container.appendChild(slot);
    }
}

function handleImageSelect(e, index, slot) {
    const file = e.target.files[0];
    if (!file) return;
    selectedImages[index] = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const existing = slot.querySelector('img');
        if (existing) existing.remove();
        const img = document.createElement('img');
        img.src = ev.target.result;
        slot.appendChild(img);
    };
    reader.readAsDataURL(file);
    checkReady();
}

function checkReady() {
    const allImages = Object.keys(selectedImages).length === imageCount;
    $('start-round-btn').disabled = !allImages;
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const answerField = $('answer-input');
        if (answerField) {
            answerField.addEventListener('input', checkReady);
            answerField.addEventListener('change', checkReady);
            answerField.addEventListener('keyup', checkReady);
            answerField.addEventListener('paste', () => setTimeout(checkReady, 50));
        }
    }, 100);
});

// Compress image before upload
function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve) => {
        // If file is small enough (< 200KB), skip compression
        if (file.size < 200 * 1024) {
            resolve(file);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    const compressed = new File([blob], file.name, { type: 'image/jpeg' });
                    resolve(compressed);
                }, 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function startRound() {
    currentAnswer = $('answer-input').value.trim();
    const formData = new FormData();
    formData.append('roomCode', roomCode);
    formData.append('answer', currentAnswer || '');

    $('start-round-btn').disabled = true;
    $('start-round-btn').textContent = '⏳ جاري ضغط الصور...';

    // Compress all images before upload
    for (let i = 0; i < imageCount; i++) {
        if (selectedImages[i]) {
            const compressed = await compressImage(selectedImages[i]);
            formData.append('images', compressed);
        }
    }

    $('start-round-btn').textContent = '⏳ جاري الرفع...';

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const res = await fetch('/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await res.json();
        if (data.success) {
            socket.emit('start-round');
            $('upload-area').classList.add('hidden');
            $('host-actions').classList.remove('hidden');
            $('new-round-btn').classList.remove('hidden');
            blockedTeams = [];
            updateUnblockButtons();
        }
    } catch (err) {
        console.error(err);
        if (err.name === 'AbortError') {
            alert('الرفع أخذ وقت طويل، جرب صور أصغر');
        } else {
            alert('حصل خطأ بالرفع، جرب مرة ثانية');
        }
    }

    $('start-round-btn').disabled = false;
    $('start-round-btn').textContent = '🚀 ابدأ الجولة';
}

function updateUnblockButtons() {
    const hasBlocked = blockedTeams.length > 0;
    if (hasBlocked) {
        $('unblock-area').classList.remove('hidden');
    } else {
        $('unblock-area').classList.add('hidden');
    }
    $('unblock-red-btn').classList.toggle('hidden', !blockedTeams.includes('red'));
    $('unblock-blue-btn').classList.toggle('hidden', !blockedTeams.includes('blue'));
}

// ========== BUZZ BUTTON ==========
$('buzz-btn').addEventListener('click', () => {
    SFX.buzz();
    socket.emit('buzz');
    $('buzz-btn').disabled = true;
});

// ========== LIGHTBOX ==========
function openLightbox(src) {
    $('lightbox-img').src = src;
    $('lightbox').classList.remove('hidden');
}
// Make closeLightbox global
window.closeLightbox = function () {
    $('lightbox').classList.add('hidden');
};

// ========== SOCKET EVENTS ==========
socket.on('room-update', (data) => { updateTeams(data); });

// Round started
socket.on('round-started', (data) => {
    SFX.roundStart();
    $('round-badge').textContent = `الجولة: ${data.roundNumber}`;
    $('red-guesses').innerHTML = '';
    $('blue-guesses').innerHTML = '';
    blockedTeams = [];

    displayImages(data.images);
    buzzedStatus.classList.add('hidden');
    resultOverlay.classList.add('hidden');

    if (isHost) {
        $('judge-controls').classList.add('hidden');
        $('host-actions').classList.remove('hidden');
        updateUnblockButtons();
    } else {
        buzzSection.classList.remove('hidden');
        $('buzz-btn').disabled = false;
    }
});

// Someone buzzed
socket.on('player-buzzed', (data) => {
    SFX.buzz();
    const teamName = data.team === 'red' ? 'الأحمر 🔴' : 'الأزرق 🔵';
    buzzSection.classList.add('hidden');
    buzzedStatus.classList.remove('hidden');
    $('buzzed-name-display').textContent = `${data.playerName} — ${teamName}`;

    if (isHost) {
        $('judge-controls').classList.remove('hidden');
        $('buzzed-player-name').textContent = data.playerName;
        const badge = $('buzzed-team-badge');
        badge.textContent = data.team === 'red' ? 'أحمر' : 'أزرق';
        badge.className = 'buzzed-team-badge ' + (data.team === 'red' ? 'red-badge' : 'blue-badge');
        $('judge-answer-text').textContent = currentAnswer;
    }
});

// Wrong buzz
socket.on('buzz-wrong', (data) => {
    SFX.wrong();
    buzzedStatus.classList.add('hidden');

    const container = $(`${data.team}-guesses`);
    const item = document.createElement('div');
    item.className = 'guess-log-item wrong-log';
    item.textContent = `❌ ${data.playerName} — خطأ`;
    container.appendChild(item);

    // Track blocked teams
    if (!blockedTeams.includes(data.team)) blockedTeams.push(data.team);

    if (isHost) {
        updateUnblockButtons();
    }

    // If my team is not blocked, show buzz button
    if (!isHost && !blockedTeams.includes(myTeam)) {
        buzzSection.classList.remove('hidden');
        $('buzz-btn').disabled = false;
    }
});

// Team unblocked
socket.on('team-unblocked', (data) => {
    SFX.pop();
    blockedTeams = blockedTeams.filter(t => t !== data.team);

    if (isHost) {
        updateUnblockButtons();
    }

    // If I'm on the unblocked team, show buzz button
    if (!isHost && data.team === myTeam) {
        buzzSection.classList.remove('hidden');
        $('buzz-btn').disabled = false;
    }
});

// Round result
socket.on('round-result', (data) => {
    SFX.correct();
    $('score-red').textContent = data.scores.red;
    $('score-blue').textContent = data.scores.blue;

    const container = $(`${data.winnerTeam}-guesses`);
    const item = document.createElement('div');
    item.className = 'guess-log-item correct-log';
    item.textContent = `✅ ${data.guesser} — صح!`;
    container.appendChild(item);

    const teamName = data.winnerTeam === 'red' ? 'الفريق الأحمر 🔴' : 'الفريق الأزرق 🔵';
    $('result-emoji').textContent = '🎉';
    $('result-title').textContent = 'الجواب الصحيح!';
    $('result-answer').textContent = data.answer;
    $('result-detail').textContent = `${data.guesser} من ${teamName} فاز بالجولة!`;
    resultOverlay.classList.remove('hidden');

    buzzSection.classList.add('hidden');
    buzzedStatus.classList.add('hidden');

    if (isHost) {
        $('judge-controls').classList.add('hidden');
    }

    setTimeout(() => { resultOverlay.classList.add('hidden'); }, 5000);
});

// Round skipped
socket.on('round-skipped', (data) => {
    SFX.skip();
    $('result-emoji').textContent = '⏭️';
    $('result-title').textContent = 'تم تخطي الجولة';
    $('result-answer').textContent = data.answer;
    $('result-detail').textContent = 'ما أحد جاوب صح!';
    resultOverlay.classList.remove('hidden');

    buzzSection.classList.add('hidden');
    buzzedStatus.classList.add('hidden');

    if (isHost) {
        $('judge-controls').classList.add('hidden');
    }

    setTimeout(() => { resultOverlay.classList.add('hidden'); }, 4000);
});

// New round
socket.on('new-round-ready', () => {
    resultOverlay.classList.add('hidden');
    buzzSection.classList.add('hidden');
    buzzedStatus.classList.add('hidden');
    blockedTeams = [];
    if (!isHost) showWaiting();
});

socket.on('room-closed', () => { closedOverlay.classList.remove('hidden'); });

// ========== UI HELPERS ==========
function updateTeams(data) {
    const redList = $('team-red-players');
    redList.innerHTML = '';
    if (data.teams.red.length === 0) {
        redList.innerHTML = '<div class="player-empty">في انتظار لاعبين...</div>';
    } else {
        data.teams.red.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            redList.appendChild(li);
        });
    }

    const blueList = $('team-blue-players');
    blueList.innerHTML = '';
    if (data.teams.blue.length === 0) {
        blueList.innerHTML = '<div class="player-empty">في انتظار لاعبين...</div>';
    } else {
        data.teams.blue.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            blueList.appendChild(li);
        });
    }

    $('score-red').textContent = data.scores.red;
    $('score-blue').textContent = data.scores.blue;
}

function displayImages(images) {
    imagesDisplay.classList.remove('hidden');
    imagesDisplay.innerHTML = '';

    const equation = document.createElement('div');
    equation.className = 'images-equation';

    const imgsDiv = document.createElement('div');
    imgsDiv.className = 'game-images';

    images.forEach((src, i) => {
        const img = document.createElement('img');
        img.className = 'game-img';
        img.src = src;
        img.style.animationDelay = `${i * 0.15}s`;
        img.alt = `صورة ${i + 1}`;
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(src);
        });
        imgsDiv.appendChild(img);

        if (i < images.length - 1) {
            const plus = document.createElement('span');
            plus.className = 'plus-sign';
            plus.textContent = '+';
            plus.style.animationDelay = `${i * 0.15 + 0.08}s`;
            imgsDiv.appendChild(plus);
        }
    });

    const equalsSign = document.createElement('div');
    equalsSign.className = 'equation-equals';
    equalsSign.textContent = '=';

    const answerBox = document.createElement('div');
    answerBox.className = 'equation-answer';
    answerBox.textContent = '❓';

    equation.appendChild(imgsDiv);
    equation.appendChild(equalsSign);
    equation.appendChild(answerBox);
    imagesDisplay.appendChild(equation);
}
