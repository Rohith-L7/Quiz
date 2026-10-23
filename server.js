const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── In-Memory Data Store ────────────────────────────────────────────
const rooms = {};        // roomCode -> { host, teams, questions, currentQ, status, settings, scores, answers }
const defaultQuestions = require('./questions.json');

// ─── Helper: generate room code ─────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Helper: random avatar seed ─────────────────────────────────────
function randomAvatarSeed() {
  return Math.random().toString(36).substring(2, 10);
}

// ─── Helper: shuffle array ──────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── REST: get default questions ─────────────────────────────────────
app.get('/api/questions', (req, res) => {
  res.json(defaultQuestions);
});

// ─── REST: get categories ────────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(defaultQuestions.map(q => q.category))];
  res.json(categories);
});

// ─── Socket.IO ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  // HOST creates a room
  socket.on('host:create', ({ hostName, selectedCategories, questionMode, customQuestions, timePerQuestion }) => {
    const roomCode = generateRoomCode();
    let questions = [];

    if (questionMode === 'random') {
      // pick from default questions matching selected categories
      const filtered = defaultQuestions.filter(q => selectedCategories.includes(q.category));
      questions = shuffle(filtered).slice(0, 20);
    } else if (questionMode === 'custom') {
      questions = customQuestions || [];
    } else {
      // 'default' — use all from selected categories
      questions = defaultQuestions.filter(q => selectedCategories.includes(q.category));
    }

    rooms[roomCode] = {
      host: { id: socket.id, name: hostName },
      teams: [],
      questions,
      currentQ: -1,
      status: 'lobby',  // lobby | active | finished
      settings: {
        timePerQuestion: timePerQuestion || 30,
        selectedCategories,
        questionMode
      },
      scores: {},
      answers: {},
      timer: null
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;

    socket.emit('host:created', { roomCode, questions });
    console.log(`🏠 Room ${roomCode} created by ${hostName}`);
  });

  // PLAYER joins
  socket.on('player:join', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error:msg', 'Room not found!');
    if (room.status !== 'lobby') return socket.emit('error:msg', 'Quiz already in progress!');

    const existingTeam = room.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
    if (existingTeam) return socket.emit('error:msg', 'Team name already taken!');

    const avatarSeed = randomAvatarSeed();
    const team = {
      id: socket.id,
      name: teamName,
      avatarSeed,
      score: 0
    };

    room.teams.push(team);
    room.scores[socket.id] = 0;

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.teamName = teamName;
    socket.isHost = false;

    socket.emit('player:joined', { team, roomCode });
    io.to(roomCode).emit('lobby:update', { teams: room.teams });
    console.log(`👤 ${teamName} joined room ${roomCode}`);
  });

  // HOST starts quiz
  socket.on('host:start', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    if (room.questions.length === 0) return socket.emit('error:msg', 'No questions available!');

    room.status = 'active';
    room.currentQ = 0;
    room.answers = {};

    io.to(socket.roomCode).emit('quiz:started');
    sendQuestion(socket.roomCode);
  });

  // HOST skips to next question
  socket.on('host:next', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    nextQuestion(socket.roomCode);
  });

  // HOST ends quiz
  socket.on('host:end', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    endQuiz(socket.roomCode);
  });

  // PLAYER submits answer
  socket.on('player:answer', ({ answerIndex }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'active') return;
    if (room.answers[socket.id]) return; // already answered

    const question = room.questions[room.currentQ];
    const correct = answerIndex === question.correct;
    const timeBonus = room._timeLeft ? Math.ceil(room._timeLeft / room.settings.timePerQuestion * 100) : 0;
    const points = correct ? 100 + timeBonus : 0;

    room.answers[socket.id] = { answerIndex, correct, points };

    const team = room.teams.find(t => t.id === socket.id);
    if (team) {
      team.score += points;
      room.scores[socket.id] = team.score;
    }

    socket.emit('player:result', { correct, points, correctAnswer: question.correct });

    // notify host of answer count
    const answerCount = Object.keys(room.answers).length;
    io.to(room.host.id).emit('host:answerUpdate', {
      answered: answerCount,
      total: room.teams.length
    });

    // if all answered, auto-advance
    if (answerCount >= room.teams.length) {
      clearTimeout(room.timer);
      setTimeout(() => showResults(socket.roomCode), 1500);
    }
  });

  // HOST updates questions live
  socket.on('host:updateQuestions', ({ questions }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.questions = questions;
    socket.emit('host:questionsUpdated', { count: questions.length });
  });

  // HOST adds a question
  socket.on('host:addQuestion', ({ question }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.questions.push(question);
    socket.emit('host:questionsUpdated', { count: room.questions.length });
  });

  // HOST removes a question
  socket.on('host:removeQuestion', ({ index }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.questions.splice(index, 1);
    socket.emit('host:questionsUpdated', { count: room.questions.length });
  });

  // HOST kicks a team
  socket.on('host:kick', ({ teamId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.teams = room.teams.filter(t => t.id !== teamId);
    delete room.scores[teamId];
    io.to(teamId).emit('player:kicked');
    io.to(socket.roomCode).emit('lobby:update', { teams: room.teams });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    if (socket.isHost) {
      io.to(roomCode).emit('room:closed');
      clearTimeout(room.timer);
      delete rooms[roomCode];
      console.log(`🗑️ Room ${roomCode} closed (host left)`);
    } else {
      room.teams = room.teams.filter(t => t.id !== socket.id);
      delete room.scores[socket.id];
      io.to(roomCode).emit('lobby:update', { teams: room.teams });
      console.log(`👋 Player left room ${roomCode}`);
    }
  });
});

// ─── Quiz Flow Helpers ───────────────────────────────────────────────
function sendQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const q = room.questions[room.currentQ];
  room.answers = {};
  room._timeLeft = room.settings.timePerQuestion;

  const questionData = {
    index: room.currentQ,
    total: room.questions.length,
    question: q.question,
    options: q.options,
    category: q.category,
    timeLimit: room.settings.timePerQuestion
  };

  io.to(roomCode).emit('quiz:question', questionData);

  // countdown timer
  clearTimeout(room.timer);
  const startTime = Date.now();
  const duration = room.settings.timePerQuestion * 1000;

  const tickInterval = setInterval(() => {
    if (!rooms[roomCode]) { clearInterval(tickInterval); return; }
    const elapsed = Date.now() - startTime;
    room._timeLeft = Math.max(0, Math.ceil((duration - elapsed) / 1000));
    io.to(roomCode).emit('quiz:tick', { timeLeft: room._timeLeft });
    if (room._timeLeft <= 0) clearInterval(tickInterval);
  }, 1000);

  room.timer = setTimeout(() => {
    clearInterval(tickInterval);
    showResults(roomCode);
  }, duration + 500);
}

function showResults(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const q = room.questions[room.currentQ];
  const leaderboard = room.teams
    .map(t => ({ name: t.name, score: t.score, avatarSeed: t.avatarSeed }))
    .sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('quiz:results', {
    correctAnswer: q.correct,
    correctText: q.options[q.correct],
    explanation: q.explanation || '',
    leaderboard,
    questionIndex: room.currentQ,
    totalQuestions: room.questions.length
  });
}

function nextQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearTimeout(room.timer);

  room.currentQ++;
  if (room.currentQ >= room.questions.length) {
    endQuiz(roomCode);
  } else {
    sendQuestion(roomCode);
  }
}

function endQuiz(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearTimeout(room.timer);
  room.status = 'finished';

  const leaderboard = room.teams
    .map(t => ({ name: t.name, score: t.score, avatarSeed: t.avatarSeed }))
    .sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('quiz:finished', { leaderboard });
}

// ─── Start Server ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 QuizBlitz running at http://localhost:${PORT}\n`);
});
