const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling', 'websocket'],
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 10 * 1024 * 1024 // 10MB for base64 images
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== ROOMS ==========
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms[code] ? generateRoomCode() : code;
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Create room
  socket.on('create-room', (data, callback) => {
    const code = generateRoomCode();
    rooms[code] = {
      host: socket.id,
      hostName: data.name || 'Host',
      players: [],
      teams: { red: [], blue: [] },
      scores: { red: 0, blue: 0 },
      currentRound: null,
      roundNumber: 0,
      gameStarted: false
    };
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    callback({ success: true, roomCode: code });
    console.log(`Room ${code} created`);
  });

  // Join room — player chooses team
  socket.on('join-room', (data, callback) => {
    const code = data.roomCode?.toUpperCase();
    const room = rooms[code];

    if (!room) return callback({ success: false, error: 'الغرفة مو موجودة' });
    if (room.players.length >= 4) return callback({ success: false, error: 'الغرفة ممتلئة' });

    const team = data.team; // player chooses
    if (team !== 'red' && team !== 'blue') return callback({ success: false, error: 'اختر فريق' });
    if (room.teams[team].length >= 2) return callback({ success: false, error: 'الفريق ممتلئ' });

    const player = {
      id: socket.id,
      name: data.name || `لاعب ${room.players.length + 1}`,
      team: team
    };

    room.players.push(player);
    room.teams[team].push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.team = team;
    socket.playerName = player.name;

    callback({ success: true, team, roomCode: code });

    io.to(code).emit('room-update', {
      players: room.players,
      teams: room.teams,
      scores: room.scores,
      gameStarted: room.gameStarted
    });

    console.log(`${player.name} joined ${code} → team ${team}`);
  });

  // Check room — get team counts before joining
  socket.on('check-room', (data, callback) => {
    const code = data.roomCode?.toUpperCase();
    const room = rooms[code];
    if (!room) return callback({ exists: false });
    callback({
      exists: true,
      redCount: room.teams.red.length,
      blueCount: room.teams.blue.length
    });
  });

  // Host starts round (images sent as base64)
  socket.on('start-round', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    const images = data.images || [];
    const answer = data.answer || '';

    room.currentRound = {
      images: images, // base64 strings
      answer: answer.trim(),
      buzzed: null,
      revealed: false,
      blockedTeams: []
    };

    room.gameStarted = true;
    room.roundNumber++;

    io.to(code).emit('round-started', {
      roundNumber: room.roundNumber,
      images: images,
      imageCount: images.length
    });
  });

  // Player buzzes
  socket.on('buzz', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.currentRound) return;
    if (room.currentRound.buzzed) return;
    if (room.currentRound.revealed) return;

    const team = socket.team;
    if (!team) return;

    // Check if this team is blocked
    if (room.currentRound.blockedTeams.includes(team)) return;

    room.currentRound.buzzed = {
      playerId: socket.id,
      playerName: socket.playerName,
      team: team
    };

    io.to(code).emit('player-buzzed', {
      playerName: socket.playerName,
      team: team
    });
  });

  // Host judges
  socket.on('judge', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (!room.currentRound || !room.currentRound.buzzed) return;

    const buzzedTeam = room.currentRound.buzzed.team;
    const buzzedPlayer = room.currentRound.buzzed.playerName;

    if (data.correct) {
      room.scores[buzzedTeam]++;
      room.currentRound.revealed = true;

      io.to(code).emit('round-result', {
        winnerTeam: buzzedTeam,
        answer: room.currentRound.answer,
        scores: room.scores,
        guesser: buzzedPlayer
      });
    } else {
      // Block this team so only the other team can buzz
      room.currentRound.blockedTeams.push(buzzedTeam);
      room.currentRound.buzzed = null;

      io.to(code).emit('buzz-wrong', {
        playerName: buzzedPlayer,
        team: buzzedTeam
      });
    }
  });

  // Host unblocks a team (let them try again)
  socket.on('unblock-team', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (!room.currentRound) return;

    const team = data.team;
    room.currentRound.blockedTeams = room.currentRound.blockedTeams.filter(t => t !== team);
    room.currentRound.buzzed = null;

    io.to(code).emit('team-unblocked', { team });
  });

  // Host skips round
  socket.on('skip-round', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (!room.currentRound) return;

    const answer = room.currentRound.answer;
    room.currentRound.revealed = true;

    io.to(code).emit('round-skipped', {
      answer: answer,
      scores: room.scores
    });
  });

  // Host new round
  socket.on('new-round', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    room.currentRound = null;

    io.to(code).emit('new-round-ready', {
      roundNumber: room.roundNumber + 1,
      scores: room.scores
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (socket.isHost) {
      io.to(code).emit('room-closed');
      delete rooms[code];
    } else {
      room.players = room.players.filter(p => p.id !== socket.id);
      room.teams.red = room.teams.red.filter(p => p.id !== socket.id);
      room.teams.blue = room.teams.blue.filter(p => p.id !== socket.id);

      io.to(code).emit('room-update', {
        players: room.players,
        teams: room.teams,
        scores: room.scores,
        gameStarted: room.gameStarted
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Server running at http://localhost:${PORT}`);
});
