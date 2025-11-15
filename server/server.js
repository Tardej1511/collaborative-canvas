/* server/server.js
   Express + Socket.io server.
   Serves client/ as static and maintains rooms via rooms.js
*/
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000
});

const rooms = new RoomManager();

io.on('connection', socket => {
  const q = socket.handshake.query || {};
  const roomId = q.room || 'main';
  const name = q.name || `User-${socket.id.slice(0,4)}`;

  socket.join(roomId);
  socket.data.name = name;

  const room = rooms.getOrCreate(roomId);
  room.addUser(socket.id, name);

  // Send initial snapshot: users + committed ops
  socket.emit('init', {
    id: socket.id,
    name,
    users: room.getUsers(),
    ops: room.getHistorySnapshot()
  });

  // Notify others
  socket.to(roomId).emit('user_joined', { id: socket.id, name });

  // Drawing events (begin, point, end) with simple reliability
  socket.on('begin_stroke', (data) => {
    // data: { opId, color, width, isEraser }
    room.startOp(data.opId, { userId: socket.id, name, color: data.color, width: data.width, isEraser: !!data.isEraser });
    socket.to(roomId).emit('begin_stroke', { ...data, userId: socket.id, name });
  });

  socket.on('stroke_point', (data) => {
    // data: { opId, x, y, ts? }
    room.appendPoint(data.opId, { x: data.x, y: data.y });
    socket.to(roomId).emit('stroke_point', { ...data, userId: socket.id });
  });

  socket.on('end_stroke', (data) => {
    // data: { opId }
    room.finishOp(data.opId);
    const op = room.getOpById(data.opId);
    // broadcast the finished op to everyone (including origin is okay)
    io.in(roomId).emit('end_stroke', { op, userId: socket.id });
  });

  // cursor position (for showing remote cursors)
  socket.on('cursor', (d) => {
    socket.to(roomId).emit('cursor', { userId: socket.id, x: d.x, y: d.y });
  });

  // undo / redo (global LIFO)
  socket.on('undo', () => {
    const removed = room.undo();
    if (removed) io.in(roomId).emit('op_removed', { opId: removed.id });
  });

  socket.on('redo', () => {
    const restored = room.redo();
    if (restored) io.in(roomId).emit('op_added', { op: restored });
  });

  // clear canvas
  socket.on('clear', () => {
    room.clear();
    io.in(roomId).emit('cleared');
  });

  // request fresh snapshot (client can call periodically / on reconnect)
  socket.on('request_snapshot', () => {
    socket.emit('snapshot', { ops: room.getHistorySnapshot() });
  });

  socket.on('disconnect', () => {
    room.removeUser(socket.id);
    socket.to(roomId).emit('user_left', { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
