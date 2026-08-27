'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function fmtBytes(b) {
  if (!b || b < 0) return '-';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function toast(message, kind = 'info', ms = 4200) {
  const t = el('div', `toast ${kind}`);
  t.textContent = message;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 320);
  }, ms);
}

function showModal({ title, body, actions }) {
  const root = $('#modalRoot');
  root.innerHTML = '';
  root.hidden = false;
  const m = el('div', 'modal');
  m.appendChild(el('h3', '', title));
  if (typeof body === 'string') {
    const p = el('p', '', body);
    m.appendChild(p);
  } else if (body instanceof Node) {
    m.appendChild(body);
  }
  const row = el('div', 'modal-actions');
  for (const a of actions || []) {
    const b = el('button', a.cls === 'cta' ? 'cta' : 'ghost-btn', a.label);
    b.style.padding = a.cls === 'cta' ? '12px 22px' : '10px 18px';
    b.addEventListener('click', () => { closeModal(); a.onClick && a.onClick(); });
    row.appendChild(b);
  }
  m.appendChild(row);
  root.appendChild(m);
  return m;
}

function closeModal() {
  const root = $('#modalRoot');
  root.hidden = true;
  root.innerHTML = '';
}
