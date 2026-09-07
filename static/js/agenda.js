const $ = sel => document.querySelector(sel);
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

function lunesDeEstaSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const diaIso = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diaIso);
  return d.toISOString().slice(0, 10);
}

let semanaDesde = lunesDeEstaSemana(hoyISO());

function semanaAnterior() {
  const d = new Date(semanaDesde + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  semanaDesde = d.toISOString().slice(0, 10);
  cargar();
}

function semanaSiguiente() {
  const d = new Date(semanaDesde + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  semanaDesde = d.toISOString().slice(0, 10);
  cargar();
}

function fmtFechaCorta(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

async function cargar() {
  const r = await api(`/api/agenda/${window.PELUQUERO_ID}?desde=${semanaDesde}`);
  semanaDesde = r.desde;
  renderSemana(r);
}

function renderSemana(r) {
  const NOMBRES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const dias = [];
  const base = new Date(r.desde + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dias.push(d.toISOString().slice(0, 10));
  }
  $('#rango-semana').textContent = `${fmtFechaCorta(r.desde)} – ${fmtFechaCorta(r.hasta)}`;

  const porDia = {};
  r.turnos.forEach(t => (porDia[t.fecha] = porDia[t.fecha] || []).push(t));

  let html = `<div class="grilla-semana-header"><div></div>`;
  dias.forEach((f, i) => {
    const num = Number(f.slice(8, 10));
    const esHoy = f === hoyISO();
    html += `<div class="celda-dia-header" style="${esHoy ? 'box-shadow:0 0 0 2px var(--pink) inset;' : ''}">${NOMBRES[i]}<div class="num">${num}</div></div>`;
  });
  html += `</div>`;

  html += `<div class="grilla-semana-fila">`;
  html += `<div class="celda-peluquero-nombre"><span class="tag-peluquero ${esc(r.peluquero.color)}">${esc(r.peluquero.nombre)}</span></div>`;
  dias.forEach(f => {
    const jsDay = new Date(f + 'T00:00:00').getDay();
    const diaIso = (jsDay + 6) % 7;
    const atiende = (r.peluquero.dias_atencion || []).includes(diaIso);
    const turnos = porDia[f] || [];

    if (!atiende) {
      html += `<div class="celda-turno-dia celda-no-atiende">no atiende</div>`;
    } else if (!turnos.length) {
      html += `<div class="celda-turno-dia"><span class="celda-vacia">libre</span></div>`;
    } else {
      html += `<div class="celda-turno-dia">`;
      turnos.forEach(t => {
        html += `<div class="chip-turno ${esc(t.estado)}"><span class="hora-chip">${esc(t.hora)}</span> ${esc(t.cliente.split(' ')[0])}</div>`;
      });
      html += `</div>`;
    }
  });
  html += `</div>`;

  $('#grilla-agenda').innerHTML = html;
}

cargar();
