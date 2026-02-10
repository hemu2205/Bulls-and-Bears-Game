/* ═══════════════════════════════════════════════════════════════════
   Bulls & Bears — Game Engine & SPA Controller
   ═══════════════════════════════════════════════════════════════════ */

// ── API Endpoints ─────────────────────────────────────────────────
const API = {
    login:       '/api/login',
    register:    '/api/register',
    logout:      '/api/logout',
    me:          '/api/me',
    profile:     '/api/profile',
    stats:       '/api/stats',
    startGame:   '/api/start_game',
    guess:       '/api/guess',
    leaderboard: '/api/leaderboard',
};

// ── Game Constants ────────────────────────────────────────────────
const MAX_ATTEMPTS = 6;
const GAME_DURATION = 240; // 4 minutes
const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

// ── State ─────────────────────────────────────────────────────────
let currentUser = null;
let currentRole = 'user';
let currentDisplayName = '';
let currentEmail = '';

let guessCount = 0;
let timerInterval = null;
let timeRemaining = GAME_DURATION;
let gameActive = false;
let keyboardState = {}; // letter -> 'green' | 'yellow' | 'gray'

// ═══════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in
    checkSession();

    // Auth form: Enter key support
    document.getElementById('auth-user').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('auth-pass').focus();
    });
    document.getElementById('auth-pass').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAuth();
    });

    // Game input
    const input = document.getElementById('word-input');
    const submitBtn = document.getElementById('submit-btn');

    input.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase();
        submitBtn.disabled = e.target.value.length !== 5;

        // Live preview tiles
        updateActiveTiles(e.target.value);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && input.value.length === 5 && !submitBtn.disabled) {
            submitGuess();
        }
    });
});


// ═══════════════════════════════════════════════════════════════════
//  VIEW ROUTING (SPA)
// ═══════════════════════════════════════════════════════════════════
function navigateTo(view) {
    const views = ['auth', 'rules', 'game', 'leaderboard'];
    views.forEach(v => {
        const el = document.getElementById(`${v}-view`);
        if (v === view) {
            el.classList.add('active-view');
        } else {
            el.classList.remove('active-view');
        }
    });

    // Side effects
    if (view === 'leaderboard') loadLeaderboard();
    if (view === 'rules' || view === 'game') updateNavUsername();
}


// ═══════════════════════════════════════════════════════════════════
//  AUTH LOGIC
// ═══════════════════════════════════════════════════════════════════
let authMode = 'login';

function toggleAuthMode(e) {
    if (e) e.preventDefault();
    authMode = authMode === 'login' ? 'register' : 'login';

    const heading = document.getElementById('auth-heading');
    const subtext = document.getElementById('auth-subtext');
    const btnText = document.getElementById('auth-btn-text');
    const toggleText = document.getElementById('auth-toggle-text');
    const toggleLink = document.getElementById('auth-toggle-link');
    const extraFields = document.getElementById('register-extra-fields');

    if (authMode === 'register') {
        heading.textContent = 'Create Account';
        subtext.textContent = 'Join the arena and start competing';
        btnText.textContent = 'Create Account';
        toggleText.textContent = 'Already have an account?';
        toggleLink.textContent = 'Sign in';
        extraFields.classList.remove('hidden');
    } else {
        heading.textContent = 'Welcome Back';
        subtext.textContent = 'Log in to continue your streak';
        btnText.textContent = 'Sign In';
        toggleText.textContent = "Don't have an account?";
        toggleLink.textContent = 'Create one';
        extraFields.classList.add('hidden');
    }

    hideError('auth-error');
}

async function handleAuth() {
    const username = document.getElementById('auth-user').value.trim();
    const password = document.getElementById('auth-pass').value;
    const display_name = document.getElementById('auth-display')?.value?.trim() || '';
    const email = document.getElementById('auth-email')?.value?.trim() || '';

    if (!username || !password) {
        showError('auth-error', 'Please fill in all required fields.');
        return;
    }

    const btn = document.getElementById('auth-submit-btn');
    const btnText = document.getElementById('auth-btn-text');
    const loader = document.getElementById('auth-btn-loader');

    btn.disabled = true;
    btnText.classList.add('hidden');
    loader.classList.remove('hidden');

    const endpoint = authMode === 'login' ? API.login : API.register;
    const body = { username, password };
    if (authMode === 'register') {
        body.display_name = display_name || username;
        body.email = email;
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();

        if (res.ok) {
            if (authMode === 'register') {
                showToast('Account created! Signing you in...', 'success');
                // Auto-login after register
                const loginRes = await fetch(API.login, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                const loginData = await loginRes.json();
                if (loginRes.ok) {
                    setUser(loginData);
                    navigateTo('rules');
                } else {
                    showToast('Registered! Please sign in.', 'success');
                    toggleAuthMode();
                }
            } else {
                setUser(data);
                showToast(`Welcome back, ${currentDisplayName}!`, 'success');
                navigateTo('rules');
            }
        } else {
            showError('auth-error', data.error || 'Something went wrong.');
        }
    } catch (err) {
        console.error(err);
        showError('auth-error', 'Connection failed. Is the server running?');
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
    }
}

async function checkSession() {
    try {
        const res = await fetch(API.me);
        if (res.ok) {
            const data = await res.json();
            setUser(data);
            navigateTo('rules');
        }
    } catch (e) { /* Not logged in */ }
}

function setUser(data) {
    currentUser = data.username;
    currentRole = data.role || 'user';
    currentDisplayName = data.display_name || data.username;
    currentEmail = data.email || '';
    updateNavUsername();
}

function updateNavUsername() {
    const spans = document.querySelectorAll('#nav-username, #nav-username-game');
    spans.forEach(s => { s.textContent = currentDisplayName || 'Profile'; });
}

async function handleLogout() {
    try {
        await fetch(API.logout, { method: 'POST' });
    } catch (e) {}
    currentUser = null;
    currentRole = 'user';
    currentDisplayName = '';
    gameActive = false;
    clearInterval(timerInterval);
    navigateTo('auth');
    showToast('Logged out successfully.', 'success');
}


// ═══════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═══════════════════════════════════════════════════════════════════
async function startNewGame() {
    const res = await fetch(API.startGame, { method: 'POST' });
    if (!res.ok) {
        const data = await res.json();
        showToast(data.error || 'Failed to start game.', 'error');
        return;
    }

    // Reset state
    guessCount = 0;
    gameActive = true;
    timeRemaining = GAME_DURATION;
    keyboardState = {};

    // Reset UI
    document.getElementById('attempts-display').textContent = `0 / ${MAX_ATTEMPTS}`;
    document.getElementById('player-display').textContent = currentDisplayName || '—';
    document.getElementById('word-input').value = '';
    document.getElementById('word-input').disabled = false;
    document.getElementById('submit-btn').disabled = true;

    buildGrid();
    buildKeyboard();
    navigateTo('game');
    startTimer();
    document.getElementById('word-input').focus();
}

function buildGrid() {
    const grid = document.getElementById('game-grid');
    grid.innerHTML = '';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const row = document.createElement('div');
        row.className = 'grid-row';
        row.id = `row-${i}`;
        for (let j = 0; j < 5; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.id = `tile-${i}-${j}`;
            row.appendChild(tile);
        }
        grid.appendChild(row);
    }
}

function buildKeyboard() {
    const kb = document.getElementById('keyboard-tracker');
    kb.innerHTML = '';
    KEYBOARD_ROWS.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';
        rowDiv.style.gap = '5px';
        rowDiv.style.justifyContent = 'center';
        rowDiv.style.marginBottom = '5px';
        for (const letter of row) {
            const key = document.createElement('div');
            key.className = 'kb-key';
            key.id = `kb-${letter}`;
            key.textContent = letter;
            rowDiv.appendChild(key);
        }
        kb.appendChild(rowDiv);
    });
}

function updateActiveTiles(value) {
    if (!gameActive) return;
    for (let j = 0; j < 5; j++) {
        const tile = document.getElementById(`tile-${guessCount}-${j}`);
        if (!tile) return;
        if (j < value.length) {
            tile.textContent = value[j];
            tile.classList.add('active-tile');
            tile.classList.add('pop');
            setTimeout(() => tile.classList.remove('pop'), 150);
        } else {
            tile.textContent = '';
            tile.classList.remove('active-tile');
        }
    }
}

async function submitGuess() {
    const input = document.getElementById('word-input');
    const word = input.value.toUpperCase();
    if (word.length !== 5 || !gameActive) return;

    input.disabled = true;
    document.getElementById('submit-btn').disabled = true;

    try {
        const res = await fetch(API.guess, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guess: word }),
        });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            input.disabled = false;
            document.getElementById('submit-btn').disabled = false;
            return;
        }

        // Animate tiles
        renderRow(guessCount, word, data.feedback);

        // Update keyboard tracker
        for (let i = 0; i < 5; i++) {
            const letter = word[i];
            const fb = data.feedback[i];
            // Priority: green > yellow > gray
            if (fb === 'green') {
                keyboardState[letter] = 'green';
            } else if (fb === 'yellow' && keyboardState[letter] !== 'green') {
                keyboardState[letter] = 'yellow';
            } else if (fb === 'gray' && !keyboardState[letter]) {
                keyboardState[letter] = 'gray';
            }
        }
        updateKeyboardDisplay();

        guessCount++;
        document.getElementById('attempts-display').textContent = `${guessCount} / ${MAX_ATTEMPTS}`;

        if (data.game_over) {
            gameActive = false;
            clearInterval(timerInterval);
            input.disabled = true;

            // Small delay for tile animation
            setTimeout(() => {
                showGameResult(data);
            }, 600);
        } else {
            input.disabled = false;
            input.value = '';
            input.focus();
            document.getElementById('submit-btn').disabled = true;
        }
    } catch (err) {
        console.error(err);
        showToast('Connection error. Try again.', 'error');
        input.disabled = false;
    }
}

function renderRow(rowIndex, word, feedback) {
    for (let i = 0; i < 5; i++) {
        const tile = document.getElementById(`tile-${rowIndex}-${i}`);
        tile.textContent = word[i];
        tile.classList.remove('active-tile');

        // Staggered flip animation
        setTimeout(() => {
            tile.classList.add('flip');
            setTimeout(() => {
                tile.classList.add(feedback[i]); // green, yellow, gray
            }, 250);
        }, i * 120);
    }
}

function updateKeyboardDisplay() {
    for (const [letter, state] of Object.entries(keyboardState)) {
        const key = document.getElementById(`kb-${letter}`);
        if (key) {
            key.className = 'kb-key ' + state;
        }
    }
}


// ── Timer ─────────────────────────────────────────────────────────
function startTimer() {
    clearInterval(timerInterval);
    timeRemaining = GAME_DURATION;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            gameActive = false;
            document.getElementById('word-input').disabled = true;
            document.getElementById('submit-btn').disabled = true;

            showGameResult({
                game_over: true,
                result: 'LOSS',
                score: 0,
                correct_word: '—',
                attempts: guessCount,
                time_taken: GAME_DURATION,
            });
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const s = (timeRemaining % 60).toString().padStart(2, '0');
    const display = document.getElementById('timer-display');
    display.textContent = `${m}:${s}`;

    // Urgency effect when < 30 seconds
    if (timeRemaining <= 30) {
        display.classList.add('urgent');
    } else {
        display.classList.remove('urgent');
    }
}


// ═══════════════════════════════════════════════════════════════════
//  GAME RESULT
// ═══════════════════════════════════════════════════════════════════
function showGameResult(data) {
    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const word = document.getElementById('result-word');
    const message = document.getElementById('result-message');
    const score = document.getElementById('result-score');
    const scoreBox = document.getElementById('result-score-box');

    if (data.result === 'WIN') {
        icon.textContent = '🎉';
        title.textContent = 'Victory!';
        title.style.color = 'var(--accent-success)';
        word.textContent = `The word was: ${data.correct_word}`;
        message.textContent = `You cracked it in ${data.attempts} attempt${data.attempts !== 1 ? 's' : ''}!`;
        score.textContent = data.score;
        scoreBox.classList.remove('hidden');
    } else {
        icon.textContent = '💪';
        title.textContent = 'Game Over';
        title.style.color = 'var(--accent-danger)';
        word.textContent = `The word was: ${data.correct_word || '—'}`;
        message.textContent = "Don't worry — every loss is a lesson. Try again!";
        scoreBox.classList.add('hidden');
    }

    document.getElementById('result-modal').classList.remove('hidden');
}

function playAgain() {
    document.getElementById('result-modal').classList.add('hidden');
    startNewGame();
}

function viewLeaderboard() {
    document.getElementById('result-modal').classList.add('hidden');
    navigateTo('leaderboard');
}


// ═══════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════════
async function loadLeaderboard() {
    try {
        const res = await fetch(API.leaderboard);
        const data = await res.json();

        // Podium
        const podium = document.getElementById('podium');
        if (data.length >= 3) {
            podium.classList.remove('hidden');
            for (let i = 0; i < 3; i++) {
                const slot = document.getElementById(`podium-${i + 1}`);
                slot.querySelector('.podium-name').textContent = data[i].display_name || data[i].username;
                slot.querySelector('.podium-score').textContent = `${data[i].score} pts`;
            }
        } else {
            podium.classList.add('hidden');
        }

        // Table
        const tbody = document.getElementById('lb-tbody');
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">No scores yet. Be the first champion!</td></tr>';
            return;
        }

        data.forEach((entry, i) => {
            const tr = document.createElement('tr');
            const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            const timeTaken = entry.time_taken ? formatTime(entry.time_taken) : '—';
            tr.innerHTML = `
                <td>${rank}</td>
                <td>${entry.display_name || entry.username}</td>
                <td><strong>${entry.score}</strong></td>
                <td>${entry.attempts}/6</td>
                <td>${timeTaken}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
        showToast('Failed to load leaderboard.', 'error');
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}


// ═══════════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════════
async function openProfile() {
    // Load latest data
    try {
        const res = await fetch(API.me);
        if (res.ok) {
            const data = await res.json();
            document.getElementById('profile-display').value = data.display_name || '';
            document.getElementById('profile-email').value = data.email || '';
            document.getElementById('profile-username').value = data.username || '';
            document.getElementById('profile-since').value = data.member_since || '';
            document.getElementById('profile-avatar').textContent = (data.display_name || data.username || '?')[0].toUpperCase();
        }
    } catch (e) {}

    // Load stats
    try {
        const res = await fetch(API.stats);
        if (res.ok) {
            const stats = await res.json();
            document.getElementById('p-total').textContent = stats.total_games;
            document.getElementById('p-wins').textContent = stats.wins;
            document.getElementById('p-rate').textContent = `${stats.win_rate}%`;
            document.getElementById('p-best').textContent = stats.best_score;
        }
    } catch (e) {}

    hideError('profile-error');
    document.getElementById('profile-modal').classList.remove('hidden');
}

async function saveProfile() {
    const display_name = document.getElementById('profile-display').value.trim();
    const email = document.getElementById('profile-email').value.trim();

    if (!display_name) {
        showError('profile-error', 'Display name cannot be empty.');
        return;
    }

    try {
        const res = await fetch(API.profile, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name, email }),
        });
        const data = await res.json();
        if (res.ok) {
            currentDisplayName = display_name;
            currentEmail = email;
            updateNavUsername();
            closeModal('profile-modal');
            showToast('Profile updated!', 'success');
        } else {
            showError('profile-error', data.error || 'Failed to save.');
        }
    } catch (err) {
        showError('profile-error', 'Connection error.');
    }
}


// ═══════════════════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════════════════
function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideError(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(`toast-${type}`);

    // Trigger
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}
