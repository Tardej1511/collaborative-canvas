/* server/drawing-state.js
   Keeps in-memory history and supports global undo/redo.
   Op structure: { id, points: [{x,y}], meta: { userId, name, color, width, isEraser }, finished }
*/
class DrawingState {
  constructor(roomId) {
    this.roomId = roomId;
    this.users = new Map(); // id -> { id, name }
    this.history = []; // committed ops in chronological order
    this.activeOps = new Map(); // opId -> partial op until finished
    this.redoStack = [];
  }

  // User management
  addUser(id, name) { this.users.set(id, { id, name }); }
  removeUser(id) { this.users.delete(id); }
  getUsers() { return Array.from(this.users.values()); }

  // Op lifecycle
  startOp(opId, meta) {
    const op = { id: opId, points: [], meta: { ...meta }, finished: false };
    this.activeOps.set(opId, op);
    // new action invalidates redo stack
    this.redoStack = [];
  }
  appendPoint(opId, pt) {
    const op = this.activeOps.get(opId);
    if (op) op.points.push(pt);
  }
  finishOp(opId) {
    const op = this.activeOps.get(opId);
    if (!op) return;
    op.finished = true;
    this.history.push(op);
    this.activeOps.delete(opId);
  }
  getOpById(opId) {
    return this.history.find(o => o.id === opId) || this.activeOps.get(opId) || null;
  }

  // Undo / redo (global)
  undo() {
    if (this.history.length === 0) return null;
    const op = this.history.pop();
    this.redoStack.push(op);
    return op;
  }
  redo() {
    if (this.redoStack.length === 0) return null;
    const op = this.redoStack.pop();
    this.history.push(op);
    return op;
  }

  clear() {
    this.history = [];
    this.activeOps.clear();
    this.redoStack = [];
  }

  getHistorySnapshot() {
    // shallow copy of ops but include points and meta
    return this.history.map(o => ({ id: o.id, points: o.points, meta: o.meta }));
  }
}

module.exports = { DrawingState };
