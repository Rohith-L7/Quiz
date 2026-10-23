/* ═══════════════════════════════════════════════════════════════════
   QuizBlitz — Client Application
   ═══════════════════════════════════════════════════════════════════ */

const socket = io();

// ─── State ───────────────────────────────────────────────────────
let state = {
  isHost: false,
  roomCode: null,
  teamName: null,
  avatarSeed: null,
  questions: [],
  customQuestions: [],
  selectedCategories: [],
  questionMode: 'random',
  timePerQuestion: 30,
  currentScreen: 'screen-landing',
  timerTotal: 30,
  editingIndex: -1
};

// ─── Screens ─────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) {
    screen.classList.add('active');
    state.currentScreen = id;
  }
}

// ─── Avatar URL ──────────────────────────────────────────────────
function avatarUrl(seed, size = 80) {
  // Use DiceBear Avatars API (fun style)
  return `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${seed}&size=${size}`;
}

// ─── Init Categories ─────────────────────────────────────────────
async function loadCategories() {
  const res = await fetch('/api/categories');
  const categories = await res.json();
  const grid = document.getElementById('category-selector');
  grid.innerHTML = '';

  const icons = {
    'History': '🏛️',
    'Coding': '💻',
    'Math': '📐',
    'Reasoning': '🧩',
    'Science': '🔬',
    'General Knowledge': '🌍'
  };

  categories.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'category-chip selected';
    chip.textContent = `${icons[cat] || '📚'} ${cat}`;
    chip.dataset.category = cat;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      updateSelectedCategories();
    });
    grid.appendChild(chip);
  });

  state.selectedCategories = [...categories];
}

function updateSelectedCategories() {
  const chips = document.querySelectorAll('.category-chip');
  state.selectedCategories = [];
  chips.forEach(c => {
    if (c.classList.contains('selected')) {
      state.selectedCategories.push(c.dataset.category);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// LANDING SCREEN
// ═══════════════════════════════════════════════════════════════════
document.getElementById('btn-host').addEventListener('click', () => {
  loadCategories();
  showScreen('screen-host-setup');
});

document.getElementById('btn-join').addEventListener('click', () => {
  showScreen('screen-join');
});

// Back buttons
document.getElementById('btn-back-join').addEventListener('click', () => showScreen('screen-landing'));
document.getElementById('btn-back-host').addEventListener('click', () => showScreen('screen-landing'));

// ═══════════════════════════════════════════════════════════════════
// JOIN SCREEN
// ═══════════════════════════════════════════════════════════════════
document.getElementById('input-room-code').addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

document.getElementById('btn-submit-join').addEventListener('click', () => {
  const roomCode = document.getElementById('input-room-code').value.trim();
  const teamName = document.getElementById('input-team-name').value.trim();
  const errEl = document.getElementById('join-error');

  if (!roomCode || roomCode.length < 4) {
    errEl.textContent = 'Please enter a valid room code';
    return;
  }
  if (!teamName) {
    errEl.textContent = 'Please enter a team name';
    return;
  }

  errEl.textContent = '';
  socket.emit('player:join', { roomCode, teamName });
});

// ═══════════════════════════════════════════════════════════════════
// HOST SETUP SCREEN
// ═══════════════════════════════════════════════════════════════════

// Time selector
document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.timePerQuestion = parseInt(btn.dataset.time);
  });
});

// Mode selector
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.questionMode = btn.dataset.mode;

    const customPanel = document.getElementById('custom-questions-panel');
    if (state.questionMode === 'custom') {
      customPanel.classList.remove('hidden');
    } else {
      customPanel.classList.add('hidden');
    }
  });
});

// Add custom question in setup
document.getElementById('btn-add-custom-q').addEventListener('click', () => {
  state.editingIndex = -1;
  clearQuestionForm();
  document.getElementById('add-q-title').innerHTML = 'Add <span class="accent-yellow">Question</span>';
  document.getElementById('modal-add-question').classList.remove('hidden');
});

// Create room
document.getElementById('btn-create-room').addEventListener('click', () => {
  const hostName = document.getElementById('input-host-name').value.trim();
  const errEl = document.getElementById('host-error');

  if (!hostName) {
    errEl.textContent = 'Please enter your name';
    return;
  }
  if (state.selectedCategories.length === 0 && state.questionMode !== 'custom') {
    errEl.textContent = 'Please select at least one category';
    return;
  }
  if (state.questionMode === 'custom' && state.customQuestions.length === 0) {
    errEl.textContent = 'Please add at least one custom question';
    return;
  }

  errEl.textContent = '';
  socket.emit('host:create', {
    hostName,
    selectedCategories: state.selectedCategories,
    questionMode: state.questionMode,
    customQuestions: state.customQuestions,
    timePerQuestion: state.timePerQuestion
  });
});

// Render custom questions in setup panel
function renderCustomQuestions() {
  const list = document.getElementById('custom-questions-list');
  list.innerHTML = '';
  state.customQuestions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'custom-q-item';
    item.innerHTML = `
      <span class="q-category">${q.category}</span>
      <span class="q-text">${q.question}</span>
      <button onclick="removeCustomQuestion(${i})" title="Remove">🗑️</button>
    `;
    list.appendChild(item);
  });
}

window.removeCustomQuestion = function (idx) {
  state.customQuestions.splice(idx, 1);
  renderCustomQuestions();
};

// ═══════════════════════════════════════════════════════════════════
// HOST LOBBY
// ═══════════════════════════════════════════════════════════════════

document.getElementById('room-code-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    const box = document.getElementById('room-code-copy');
    box.style.borderColor = '#00E676';
    setTimeout(() => { box.style.borderColor = ''; }, 1500);
  });
});

document.getElementById('btn-start-quiz').addEventListener('click', () => {
  socket.emit('host:start');
});

// Edit questions button
document.getElementById('btn-edit-questions').addEventListener('click', () => {
  openEditor();
});

// ═══════════════════════════════════════════════════════════════════
// QUESTION EDITOR MODAL
// ═══════════════════════════════════════════════════════════════════
function openEditor() {
  const modal = document.getElementById('modal-editor');
  modal.classList.remove('hidden');
  populateEditorFilter();
  renderEditorList();
}

document.getElementById('btn-close-editor').addEventListener('click', () => {
  document.getElementById('modal-editor').classList.add('hidden');
});

document.getElementById('btn-editor-save').addEventListener('click', () => {
  socket.emit('host:updateQuestions', { questions: state.questions });
  document.getElementById('modal-editor').classList.add('hidden');
  document.getElementById('question-count').textContent = state.questions.length;
});

document.getElementById('editor-category-filter').addEventListener('change', () => {
  renderEditorList();
});

document.getElementById('btn-editor-add').addEventListener('click', () => {
  state.editingIndex = -1;
  clearQuestionForm();
  document.getElementById('add-q-title').innerHTML = 'Add <span class="accent-yellow">Question</span>';
  document.getElementById('modal-add-question').classList.remove('hidden');
});

function populateEditorFilter() {
  const select = document.getElementById('editor-category-filter');
  const cats = [...new Set(state.questions.map(q => q.category))];
  select.innerHTML = '<option value="all">All Categories</option>';
  cats.forEach(c => {
    select.innerHTML += `<option value="${c}">${c}</option>`;
  });
}

function renderEditorList() {
  const filter = document.getElementById('editor-category-filter').value;
  const list = document.getElementById('editor-questions-list');
  list.innerHTML = '';

  state.questions.forEach((q, i) => {
    if (filter !== 'all' && q.category !== filter) return;

    const item = document.createElement('div');
    item.className = 'editor-q-item';
    item.innerHTML = `
      <span class="editor-q-num">${i + 1}</span>
      <span class="editor-q-cat">${q.category}</span>
      <span class="editor-q-text">${q.question}</span>
      <div class="editor-q-actions">
        <button class="btn-edit-q" onclick="editQuestion(${i})" title="Edit">✏️</button>
        <button class="btn-delete-q" onclick="deleteQuestion(${i})" title="Delete">🗑️</button>
      </div>
    `;
    list.appendChild(item);
  });

  if (list.children.length === 0) {
    list.innerHTML = '<p class="muted-text" style="padding:2rem;">No questions in this category</p>';
  }
}

window.editQuestion = function (idx) {
  state.editingIndex = idx;
  const q = state.questions[idx];

  document.getElementById('aq-category').value = q.category;
  document.getElementById('aq-question').value = q.question;
  document.getElementById('aq-opt-0').value = q.options[0];
  document.getElementById('aq-opt-1').value = q.options[1];
  document.getElementById('aq-opt-2').value = q.options[2];
  document.getElementById('aq-opt-3').value = q.options[3];
  document.getElementById('aq-correct').value = q.correct;
  document.getElementById('aq-explanation').value = q.explanation || '';

  document.getElementById('add-q-title').innerHTML = 'Edit <span class="accent-yellow">Question</span>';
  document.getElementById('modal-add-question').classList.remove('hidden');
};

window.deleteQuestion = function (idx) {
  state.questions.splice(idx, 1);
  renderEditorList();
  populateEditorFilter();
};

// ═══════════════════════════════════════════════════════════════════
// ADD / EDIT QUESTION MODAL
// ═══════════════════════════════════════════════════════════════════
document.getElementById('btn-close-add-q').addEventListener('click', () => {
  document.getElementById('modal-add-question').classList.add('hidden');
});

function clearQuestionForm() {
  document.getElementById('aq-category').value = '';
  document.getElementById('aq-question').value = '';
  document.getElementById('aq-opt-0').value = '';
  document.getElementById('aq-opt-1').value = '';
  document.getElementById('aq-opt-2').value = '';
  document.getElementById('aq-opt-3').value = '';
  document.getElementById('aq-correct').value = '0';
  document.getElementById('aq-explanation').value = '';
}

document.getElementById('btn-save-question').addEventListener('click', () => {
  const category = document.getElementById('aq-category').value.trim();
  const question = document.getElementById('aq-question').value.trim();
  const options = [
    document.getElementById('aq-opt-0').value.trim(),
    document.getElementById('aq-opt-1').value.trim(),
    document.getElementById('aq-opt-2').value.trim(),
    document.getElementById('aq-opt-3').value.trim()
  ];
  const correct = parseInt(document.getElementById('aq-correct').value);
  const explanation = document.getElementById('aq-explanation').value.trim();

  if (!category || !question || options.some(o => !o)) {
    alert('Please fill in all required fields');
    return;
  }

  const qObj = { category, question, options, correct, explanation };

  // If we're in the host setup custom mode
  if (state.currentScreen === 'screen-host-setup') {
    if (state.editingIndex >= 0) {
      state.customQuestions[state.editingIndex] = qObj;
    } else {
      state.customQuestions.push(qObj);
    }
    renderCustomQuestions();
  } else {
    // We're editing in the editor modal
    if (state.editingIndex >= 0) {
      state.questions[state.editingIndex] = qObj;
    } else {
      state.questions.push(qObj);
    }
    renderEditorList();
    populateEditorFilter();
  }

  state.editingIndex = -1;
  document.getElementById('modal-add-question').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════════
// QUIZ ACTIVE SCREEN
// ═══════════════════════════════════════════════════════════════════

document.getElementById('btn-next-q').addEventListener('click', () => {
  socket.emit('host:next');
});

document.getElementById('btn-end-quiz').addEventListener('click', () => {
  if (confirm('Are you sure you want to end the quiz?')) {
    socket.emit('host:end');
  }
});

// ═══════════════════════════════════════════════════════════════════
// RESULTS SCREEN
// ═══════════════════════════════════════════════════════════════════

document.getElementById('btn-results-next').addEventListener('click', () => {
  socket.emit('host:next');
});

document.getElementById('btn-results-end').addEventListener('click', () => {
  if (confirm('End the quiz now?')) {
    socket.emit('host:end');
  }
});

// ═══════════════════════════════════════════════════════════════════
// FINAL SCREEN
// ═══════════════════════════════════════════════════════════════════

document.getElementById('btn-play-again').addEventListener('click', () => {
  window.location.reload();
});

// ═══════════════════════════════════════════════════════════════════
// SOCKET EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

// ─── Host Created ─────────────────────────────────────────────────
socket.on('host:created', ({ roomCode, questions }) => {
  state.isHost = true;
  state.roomCode = roomCode;
  state.questions = questions;

  document.getElementById('lobby-room-code').textContent = roomCode;
  document.getElementById('room-code-text').textContent = roomCode;
  document.getElementById('question-count').textContent = questions.length;

  showScreen('screen-host-lobby');
});

// ─── Player Joined ────────────────────────────────────────────────
socket.on('player:joined', ({ team, roomCode }) => {
  state.isHost = false;
  state.roomCode = roomCode;
  state.teamName = team.name;
  state.avatarSeed = team.avatarSeed;

  document.getElementById('player-room-code').textContent = roomCode;
  document.getElementById('player-team-display').textContent = team.name;
  document.getElementById('player-avatar-lobby').innerHTML =
    `<img src="${avatarUrl(team.avatarSeed, 90)}" alt="Avatar">`;

  showScreen('screen-player-lobby');
});

// ─── Lobby Update ─────────────────────────────────────────────────
socket.on('lobby:update', ({ teams }) => {
  // Host lobby teams
  const hostList = document.getElementById('lobby-teams-list');
  const noTeams = document.getElementById('lobby-no-teams');

  if (teams.length === 0) {
    hostList.innerHTML = '';
    noTeams.style.display = 'block';
  } else {
    noTeams.style.display = 'none';
    hostList.innerHTML = teams.map(t => `
      <div class="team-card">
        <div class="team-avatar">
          <img src="${avatarUrl(t.avatarSeed)}" alt="${t.name}">
        </div>
        <div class="team-name">${escapeHtml(t.name)}</div>
      </div>
    `).join('');
  }

  // Player lobby teams
  const playerList = document.getElementById('player-lobby-teams');
  playerList.innerHTML = teams.map(t => `
    <div class="team-card">
      <div class="team-avatar">
        <img src="${avatarUrl(t.avatarSeed, 48)}" alt="${t.name}">
      </div>
      <div class="team-name">${escapeHtml(t.name)}</div>
    </div>
  `).join('');
});

// ─── Quiz Started ─────────────────────────────────────────────────
socket.on('quiz:started', () => {
  showScreen('screen-quiz');

  // show host controls if host
  document.getElementById('host-controls').style.display = state.isHost ? 'flex' : 'none';
});

// ─── Quiz Question ────────────────────────────────────────────────
socket.on('quiz:question', ({ index, total, question, options, category, timeLimit }) => {
  showScreen('screen-quiz');

  state.timerTotal = timeLimit;

  document.getElementById('q-current').textContent = index + 1;
  document.getElementById('q-total').textContent = total;
  document.getElementById('q-progress-fill').style.width = `${((index + 1) / total) * 100}%`;
  document.getElementById('q-category').textContent = category;
  document.getElementById('question-text').textContent = question;
  document.getElementById('timer-text').textContent = timeLimit;

  // Reset timer circle
  const circle = document.getElementById('timer-circle');
  circle.classList.remove('urgent');
  circle.style.strokeDashoffset = '0';
  document.getElementById('timer-text').classList.remove('urgent');

  // Options
  const grid = document.getElementById('options-grid');
  const letters = ['A', 'B', 'C', 'D'];
  grid.innerHTML = options.map((opt, i) => `
    <button class="option-btn" data-index="${i}" id="option-${i}">
      <span class="option-letter">${letters[i]}</span>
      <span class="option-text">${escapeHtml(opt)}</span>
    </button>
  `).join('');

  // Bind click events (only for players)
  if (!state.isHost) {
    grid.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('disabled')) return;

        // Mark selected
        grid.querySelectorAll('.option-btn').forEach(b => {
          b.classList.remove('selected');
          b.classList.add('disabled');
        });
        btn.classList.add('selected');

        socket.emit('player:answer', { answerIndex: parseInt(btn.dataset.index) });
      });
    });
  } else {
    grid.querySelectorAll('.option-btn').forEach(b => b.classList.add('disabled'));
  }

  // Reset host controls
  document.getElementById('answer-count').textContent = '0';
  document.getElementById('answer-total').textContent = '0';
  document.getElementById('host-controls').style.display = state.isHost ? 'flex' : 'none';

  // Hide player feedback
  document.getElementById('player-feedback').style.display = 'none';
});

// ─── Timer Tick ───────────────────────────────────────────────────
socket.on('quiz:tick', ({ timeLeft }) => {
  document.getElementById('timer-text').textContent = timeLeft;

  const circumference = 2 * Math.PI * 26; // r=26
  const offset = circumference * (1 - timeLeft / state.timerTotal);
  document.getElementById('timer-circle').style.strokeDashoffset = offset;

  if (timeLeft <= 5) {
    document.getElementById('timer-circle').classList.add('urgent');
    document.getElementById('timer-text').classList.add('urgent');
  }
});

// ─── Player Result ────────────────────────────────────────────────
socket.on('player:result', ({ correct, points, correctAnswer }) => {
  const fb = document.getElementById('player-feedback');
  fb.style.display = 'block';
  fb.className = 'player-feedback ' + (correct ? 'correct-feedback' : 'wrong-feedback');

  document.getElementById('feedback-icon').textContent = correct ? '✅' : '❌';
  document.getElementById('feedback-text').textContent = correct ? 'Correct!' : 'Wrong!';
  document.getElementById('feedback-points').textContent = correct ? `+${points} pts` : '0 pts';

  // Highlight correct/wrong options
  const options = document.querySelectorAll('.option-btn');
  options.forEach(btn => {
    const idx = parseInt(btn.dataset.index);
    if (idx === correctAnswer) {
      btn.classList.add('correct');
    } else if (btn.classList.contains('selected') && idx !== correctAnswer) {
      btn.classList.add('wrong');
    }
    btn.classList.add('disabled');
  });
});

// ─── Host Answer Update ───────────────────────────────────────────
socket.on('host:answerUpdate', ({ answered, total }) => {
  document.getElementById('answer-count').textContent = answered;
  document.getElementById('answer-total').textContent = total;
});

// ─── Quiz Results (per question) ──────────────────────────────────
socket.on('quiz:results', ({ correctAnswer, correctText, explanation, leaderboard, questionIndex, totalQuestions }) => {
  showScreen('screen-results');

  document.getElementById('correct-answer-text').textContent = correctText;
  document.getElementById('explanation-text').textContent = explanation || '';

  renderLeaderboard('results-leaderboard', leaderboard);

  // Show host controls on results screen
  if (state.isHost) {
    document.getElementById('results-host-controls').style.display = 'block';
    document.getElementById('results-player-msg').style.display = 'none';

    // Update button text for last question
    const nextBtn = document.getElementById('btn-results-next');
    if (questionIndex >= totalQuestions - 1) {
      nextBtn.textContent = 'Finish Quiz 🏆';
    } else {
      nextBtn.textContent = 'Next Question →';
    }
  } else {
    document.getElementById('results-host-controls').style.display = 'none';
    document.getElementById('results-player-msg').style.display = 'block';
  }
});

// ─── Quiz Finished ────────────────────────────────────────────────
socket.on('quiz:finished', ({ leaderboard }) => {
  showScreen('screen-final');

  renderLeaderboard('final-leaderboard', leaderboard);
  renderPodium(leaderboard);
});

// ─── Questions Updated ────────────────────────────────────────────
socket.on('host:questionsUpdated', ({ count }) => {
  document.getElementById('question-count').textContent = count;
});

// ─── Error ────────────────────────────────────────────────────────
socket.on('error:msg', (msg) => {
  const joinErr = document.getElementById('join-error');
  const hostErr = document.getElementById('host-error');

  if (state.currentScreen === 'screen-join') {
    joinErr.textContent = msg;
  } else if (state.currentScreen === 'screen-host-setup') {
    hostErr.textContent = msg;
  } else {
    alert(msg);
  }
});

// ─── Room Closed ──────────────────────────────────────────────────
socket.on('room:closed', () => {
  alert('The host has left. The room is closed.');
  window.location.reload();
});

// ─── Player Kicked ────────────────────────────────────────────────
socket.on('player:kicked', () => {
  alert('You have been removed from the room.');
  window.location.reload();
});

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function renderLeaderboard(containerId, leaderboard) {
  const container = document.getElementById(containerId);
  container.innerHTML = leaderboard.map((team, i) => `
    <div class="lb-row" style="animation-delay: ${i * 0.1}s">
      <span class="lb-rank">${i === 0 ? '👑' : i + 1}</span>
      <div class="lb-avatar">
        <img src="${avatarUrl(team.avatarSeed, 36)}" alt="${team.name}">
      </div>
      <span class="lb-name">${escapeHtml(team.name)}</span>
      <span class="lb-score">${team.score} pts</span>
    </div>
  `).join('');
}

function renderPodium(leaderboard) {
  const podium = document.getElementById('podium');
  if (leaderboard.length === 0) {
    podium.innerHTML = '<p class="muted-text">No teams participated</p>';
    return;
  }

  // Reorder: 2nd, 1st, 3rd for visual podium
  const places = [];
  if (leaderboard[1]) places.push({ ...leaderboard[1], place: 2 });
  if (leaderboard[0]) places.push({ ...leaderboard[0], place: 1 });
  if (leaderboard[2]) places.push({ ...leaderboard[2], place: 3 });

  const placeLabels = { 1: 'first', 2: 'second', 3: 'third' };
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };

  podium.innerHTML = places.map(p => `
    <div class="podium-place">
      <div class="podium-avatar">
        <img src="${avatarUrl(p.avatarSeed, 50)}" alt="${p.name}">
      </div>
      <div class="podium-name">${escapeHtml(p.name)}</div>
      <div class="podium-score">${p.score} pts</div>
      <div class="podium-bar ${placeLabels[p.place]}">${medals[p.place]}</div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
