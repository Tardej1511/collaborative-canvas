/* client/websocket.js
   Connect to socket.io (server on same origin). Exposes WS global.
   Prompts for name if not provided in input on topbar.
*/
(function(){
  function getParam(key){
    const search = new URLSearchParams(location.search);
    return search.get(key);
  }
  // we'll connect after user presses enter in name or uses default
  window.WS = {
    socket: null,
    connect: (opts = {}) => {
      const q = { room: opts.room || 'main', name: opts.name || undefined };
      const socket = io(undefined, { query: q });
      window.WS.socket = socket;
      return socket;
    },
    on: (ev, cb) => {
      if (!window.WS.socket) return;
      window.WS.socket.on(ev, cb);
    },
    emit: (ev, data) => {
      if (!window.WS.socket) return;
      window.WS.socket.emit(ev, data);
    },
    id: () => (window.WS.socket ? window.WS.socket.id : null)
  };
})();
