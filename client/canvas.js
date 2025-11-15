/* client/canvas.js
   Canvas drawing utilities, smoothing and replay logic.
   Exposes CanvasApp API used by main.js
*/
const CanvasApp = (function(){
  const canvas = document.getElementById('canvas');
  const cursorsEl = document.getElementById('cursors');
  const ctx = canvas.getContext('2d', { alpha: false });

  // high-DPI friendly resizing
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const DPR = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(rect.width * DPR);
    canvas.height = Math.round(rect.height * DPR);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    redraw();
  }
  window.addEventListener('resize', resize);
  resize();

  // state
  let committedOps = []; // array of ops from server
  const activeOps = new Map(); // opId -> op (remote or local)
  const remoteCursors = new Map(); // userId -> dom element
  const localUserId = () => (window.WS && window.WS.id ? window.WS.id() : null);

  // drawing defaults
  let tool = 'brush';
  let color = '#000000';
  let width = 4;

  // smoothing using quadratic to midpoints
  function drawOp(op, ctx) {
    if (!op || !op.points || op.points.length === 0) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = op.meta.width;
    if (op.meta.isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = op.meta.color;
    }
    ctx.beginPath();
    const pts = op.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i-1];
      const curr = pts[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    // clear
    ctx.clearRect(0,0,canvas.width,canvas.height);
    // background white
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();

    // draw committed
    for (const op of committedOps) drawOp(op, ctx);
    // draw active (in-progress) on top
    for (const op of activeOps.values()) drawOp(op, ctx);
  }

  // Cursor handling
  function createCursorEl(userId, name) {
    const el = document.createElement('div');
    el.className = 'cursor';
    el.dataset.userid = userId;
    el.innerHTML = `<div class="dot"></div><div class="name">${escapeHtml(name || 'anon')}</div>`;
    cursorsEl.appendChild(el);
    return el;
  }
  function updateCursor(userId, x, y, name) {
    let el = remoteCursors.get(userId);
    if (!el) {
      el = createCursorEl(userId, name);
      remoteCursors.set(userId, el);
    }
    // position in DOM coordinates (canvas parent rect)
    const rect = canvas.getBoundingClientRect();
    el.style.left = (rect.left + x) + 'px'; // we'll rebase below
    el.style.top = (rect.top + y) + 'px';
    // convert to container relative
    const wrapRect = cursorsEl.getBoundingClientRect();
    el.style.left = (x) + 'px';
    el.style.top = (y) + 'px';
  }
  function removeCursor(userId) {
    const el = remoteCursors.get(userId);
    if (el) { el.remove(); remoteCursors.delete(userId); }
  }

  // helpers
  function escapeHtml(s){ return (''+s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

  // API used by main.js and websocket messages
  return {
    setTool(t){ tool = t; },
    setColor(c){ color = c; },
    setWidth(w){ width = w; },
    resize: resize,

    // local-op creation (optimistic rendering)
    beginLocalOp(opId) {
      const op = { id: opId, points: [], meta: { userId: localUserId(), name: null, color, width, isEraser: tool === 'eraser' }, finished: false };
      activeOps.set(opId, op);
      redraw();
    },
    appendLocalPoint(opId, pt) {
      const op = activeOps.get(opId);
      if (!op) return;
      op.points.push(pt);
      // small throttle redraw could be implemented; leave immediate for responsiveness
      redraw();
    },
    finishLocalOp(opId) {
      const op = activeOps.get(opId);
      if (!op) return;
      op.finished = true;
      // move to committed
      activeOps.delete(opId);
      committedOps.push(op);
      redraw();
    },

    // remote op handlers
    applyRemoteBegin(data) {
      // data: { opId, color, width, isEraser, userId, name }
      const op = { id: data.opId, points: [], meta: { userId: data.userId, name: data.name, color: data.color, width: data.width, isEraser: !!data.isEraser }, finished: false };
      activeOps.set(data.opId, op);
      redraw();
    },
    applyRemotePoint(data) {
      const op = activeOps.get(data.opId);
      if (!op) return;
      op.points.push({ x: data.x, y: data.y });
      redraw();
    },
    applyRemoteEnd(payload) {
      // payload: { op }
      const op = payload.op;
      if (!op) return;
      // ensure shape matches local structure (meta present)
      activeOps.delete(op.id);
      committedOps.push(op);
      redraw();
    },

    // snapshot / history
    applySnapshot(ops) {
      committedOps = ops.map(o => ({ id: o.id, points: o.points || [], meta: o.meta || {} }));
      activeOps.clear();
      redraw();
    },

    // undo/redo
    removeOpById(opId) {
      committedOps = committedOps.filter(o => o.id !== opId);
      activeOps.delete(opId);
      redraw();
    },
    addOp(op) {
      committedOps.push(op);
      redraw();
    },

    clearAll() {
      committedOps = [];
      activeOps.clear();
      redraw();
    },

    // cursor API
    updateRemoteCursor(userId, x, y, name) {
      updateCursor(userId, x, y, name);
    },
    removeRemoteCursor(userId) {
      removeCursor(userId);
    },

    // expose raw canvas for coordinate conversion
    canvas,
    ctx
  };
})();
window.CanvasApp = CanvasApp;
