/* client/main.js
   Wires UI, WS and CanvasApp together.
*/
(function(){
  // elements
  const nameInput = document.getElementById('name');
  const roomSelect = document.getElementById('room');
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const brushBtn = document.getElementById('brushBtn');
  const eraserBtn = document.getElementById('eraserBtn');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const clearBtn = document.getElementById('clear');
  const userList = document.getElementById('userList');

  // initial UI
  colorInput.value = '#000000';
  sizeInput.value = 4;
  let currentRoom = 'main';

  // connect when user sets a name (or use default)
  function startConnection() {
    const name = nameInput.value.trim() || undefined;
    currentRoom = roomSelect.value || 'main';
    const socket = WS.connect({ room: currentRoom, name });
    attachSocketHandlers(socket);
  }

  // attach UI listeners
  brushBtn.addEventListener('click', ()=>{
    CanvasApp.setTool('brush');
    brushBtn.classList.add('active'); eraserBtn.classList.remove('active');
  });
  eraserBtn.addEventListener('click', ()=>{
    CanvasApp.setTool('eraser');
    eraserBtn.classList.add('active'); brushBtn.classList.remove('active');
  });
  colorInput.addEventListener('input', e => CanvasApp.setColor(e.target.value));
  sizeInput.addEventListener('input', e => CanvasApp.setWidth(Number(e.target.value)));

  undoBtn.addEventListener('click', ()=> { WS.emit('undo'); });
  redoBtn.addEventListener('click', ()=> { WS.emit('redo'); });
  clearBtn.addEventListener('click', ()=> { if(confirm('Clear canvas for everyone?')) WS.emit('clear'); });

  // connect immediately with optional default name
  startConnection();

  // pointer drawing logic
  const canvas = CanvasApp.canvas;
  let drawing = false;
  let currentOpId = null;
  let lastPos = null;

  function toCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  }

  // create op id
  function makeOpId() { return `${WS.id() || 'local'}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    currentOpId = makeOpId();
    lastPos = toCanvasPos(e);
    CanvasApp.beginLocalOp(currentOpId);
    WS.emit('begin_stroke', { opId: currentOpId, color: colorInput.value, width: Number(sizeInput.value), isEraser: eraserBtn.classList.contains('active') });
    // initial point
    CanvasApp.appendLocalPoint(currentOpId, lastPos);
    WS.emit('stroke_point', { opId: currentOpId, x: lastPos.x, y: lastPos.y });
  });

  canvas.addEventListener('pointermove', (e) => {
    // send cursor position
    const pos = toCanvasPos(e);
    WS.emit('cursor', { x: pos.x, y: pos.y });
    if (!drawing) return;
    // append point
    CanvasApp.appendLocalPoint(currentOpId, pos);
    WS.emit('stroke_point', { opId: currentOpId, x: pos.x, y: pos.y });
    lastPos = pos;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drawing) return;
    drawing = false;
    CanvasApp.finishLocalOp(currentOpId);
    WS.emit('end_stroke', { opId: currentOpId });
    currentOpId = null;
  });

  // keyboard shortcuts
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); WS.emit('undo'); }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); WS.emit('redo'); }
  });

  // socket handlers
  function attachSocketHandlers(socket) {
    socket.on('init', (data) => {
      // show users
      userList.textContent = data.users.map(u=>u.name).join(', ') || '—';
      CanvasApp.applySnapshot(data.ops);
    });

    socket.on('user_joined', d => {
      // add to list
      userList.textContent = userList.textContent === '—' ? d.name : (userList.textContent + ', ' + d.name);
    });

    socket.on('user_left', d => {
      // best-effort: we don't map id->name in UI; request snapshot to refresh
      socket.emit('request_snapshot');
      CanvasApp.removeRemoteCursor(d.id);
    });

    socket.on('begin_stroke', data => CanvasApp.applyRemoteBegin(data));
    socket.on('stroke_point', data => CanvasApp.applyRemotePoint(data));
    socket.on('end_stroke', data => CanvasApp.applyRemoteEnd(data));
    socket.on('op_removed', data => CanvasApp.removeOpById(data.opId));
    socket.on('op_added', data => CanvasApp.addOp(data.op));
    socket.on('cleared', () => CanvasApp.clearAll());
    socket.on('snapshot', d => CanvasApp.applySnapshot(d.ops));
    socket.on('cursor', d => CanvasApp.updateRemoteCursor(d.userId, d.x, d.y));
  }

  // periodically ask for snapshot in case of missed packets
  setInterval(()=> { if (WS.socket) WS.emit('request_snapshot'); }, 5000);
})();
