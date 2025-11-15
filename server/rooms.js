/* server/rooms.js
   Lightweight room manager - holds a DrawingState per room
*/
const { DrawingState } = require('./drawing-state');

class RoomManager {
  constructor() {
    /** Map<string, DrawingState> */
    this.rooms = new Map();
  }

  getOrCreate(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new DrawingState(roomId));
    }
    return this.rooms.get(roomId);
  }
}

module.exports = { RoomManager };
