const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Sesión vencida'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

let fecha = hoyISO();

async function cambiarFecha(valor) {
  fecha = valor;
  await cargar();
}

async function cargar() {
  const { peluquero, turnos } = await api(`/api/agenda?fecha=${fecha}`);
  $('#titulo-agenda').textContent = `Agenda de ${peluquero.nombre}`;
  if (!turnos.length) {
    $('#tabla-agenda').innerHTML = `<p class="sin-horarios">No tenés turnos ese día.</p>`;
    return;
  }
  // Solo lectura: para cancelar, reprogramar o marcar un turno como atendido,
  // el peluquero avisa al encargado, que lo hace desde mesa de entrada.
  $('#tabla-agenda').innerHTML = turnos.map(t => `
    <div class="fila-turno" style="grid-template-columns:70px 1fr 90px 90px;">
      <div class="hora">${esc(t.hora)}</div>
      <div class="cliente">${esc(t.cliente)}<span class="tel">${esc(t.telefono)}</span></div>
      <div>${esc(t.servicio)}</div>
      <div class="estado ${esc(t.estado)}">${esc(t.estado)}</div>
    </div>
  `).join('');
}

$('#input-fecha-agenda').value = fecha;
cargar();
