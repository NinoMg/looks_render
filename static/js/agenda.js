const $ = sel => document.querySelector(sel);
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

let fecha = hoyISO();

async function cambiarFecha(valor) {
  fecha = valor;
  await cargar();
}

async function cargar() {
  const { turnos } = await api(`/api/agenda/${window.PELUQUERO_ID}?fecha=${fecha}`);
  if (!turnos.length) {
    $('#tabla-agenda').innerHTML = `<p class="sin-horarios">No hay turnos ese día.</p>`;
    return;
  }
  // Solo lectura: para cancelar, reprogramar o marcar un turno como atendido,
  // se avisa al encargado, que lo hace desde mesa de entrada.
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
