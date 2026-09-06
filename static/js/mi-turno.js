const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

let credenciales = null; // { telefono, codigo } — se guardan solo en memoria de esta pestaña
let modoEdicion = false;
let horariosNuevos = [];
let fechaSeleccionada = null;
let horaSeleccionada = null;

async function buscarTurno(e) {
  e.preventDefault();
  const telefono = $('#input-telefono').value.trim();
  $('#mensaje-buscar').innerHTML = '';
  try {
    const turno = await api(`/api/turnos/buscar?telefono=${encodeURIComponent(telefono)}`);
    credenciales = { telefono };
    modoEdicion = false;
    renderTurno(turno);
  } catch (err) {
    $('#mensaje-buscar').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    $('#resultado-turno').innerHTML = '';
  }
  return false;
}

function renderTurno(turno) {
  const fechaTxt = new Date(turno.fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const puedeModificar = turno.estado === 'pendiente' || turno.estado === 'confirmado';

  $('#resultado-turno').innerHTML = `
    <div class="ticket">
      <div class="ticket-num">TURNO N.° ${turno.id} · <span class="estado ${turno.estado}" style="display:inline-block;">${esc(turno.estado)}</span></div>
      <h3 style="margin-top:6px;">${esc(turno.peluquero_nombre)}</h3>
      <div class="ticket-perf"></div>
      <div class="ticket-row"><span class="label">Servicio</span><span>${esc(turno.servicio)}</span></div>
      <div class="ticket-row"><span class="label">Día</span><span>${esc(fechaTxt)}</span></div>
      <div class="ticket-row"><span class="label">Horario</span><span>${esc(turno.hora)} hs</span></div>
      <div class="ticket-row"><span class="label">Seña / total</span><span>${fmt(turno.precio)}</span></div>
      <div class="ticket-perf"></div>
      ${puedeModificar ? `
        <div style="display:flex;gap:10px;">
          <button class="btn btn-ghost" style="flex:1;" onclick="mostrarReprogramar(${turno.id}, '${turno.peluquero_id}', ${turno.servicio_id})">Cambiar día/horario</button>
          <button class="btn btn-danger" style="flex:1;" onclick="cancelar(${turno.id})">Cancelar turno</button>
        </div>
        <div id="panel-reprogramar" style="margin-top:16px;"></div>
      ` : `<p class="sin-horarios">Este turno ya no se puede modificar (está ${esc(turno.estado)}).</p>`}
    </div>
  `;
}

async function cancelar(turnoId) {
  if (!confirm('¿Seguro que querés cancelar este turno?')) return;
  try {
    const turno = await api(`/api/turnos/${turnoId}/cancelar`, { method: 'PATCH', body: JSON.stringify(credenciales) });
    renderTurno(turno);
  } catch (err) {
    alert(err.message);
  }
}

async function mostrarReprogramar(turnoId, peluqueroId, servicioId) {
  fechaSeleccionada = hoyISO();
  horaSeleccionada = null;
  await renderReprogramar(turnoId, peluqueroId, servicioId);
}

async function renderReprogramar(turnoId, peluqueroId, servicioId) {
  $('#panel-reprogramar').innerHTML = `
    <div class="campo-fecha">
      <input type="date" value="${fechaSeleccionada}" min="${hoyISO()}"
        onchange="cambiarFechaReprogramar(${turnoId}, '${peluqueroId}', ${servicioId}, this.value)">
    </div>
    <div class="grid-horarios" id="grid-horarios-reprog"><p class="sin-horarios">Buscando horarios…</p></div>
    <button class="btn btn-primary btn-block" id="btn-confirmar-reprog" disabled
      onclick="confirmarReprogramar(${turnoId})">Confirmar nuevo horario</button>
  `;
  await cargarHorariosReprogramar(peluqueroId, servicioId);
}

async function cargarHorariosReprogramar(peluqueroId, servicioId) {
  try {
    const r = await api(`/api/peluqueros/${peluqueroId}/disponibilidad?servicio_id=${servicioId}&fecha=${fechaSeleccionada}`);
    horariosNuevos = r.horarios;
  } catch (e) {
    horariosNuevos = [];
  }
  const grid = $('#grid-horarios-reprog');
  if (!grid) return;
  if (!horariosNuevos.length) {
    grid.innerHTML = `<p class="sin-horarios">No hay horarios disponibles ese día.</p>`;
    return;
  }
  grid.innerHTML = horariosNuevos.map(h => `
    <button type="button" class="franja ${h === horaSeleccionada ? 'selected' : ''}" onclick="elegirHoraReprogramar('${h}')">${h}</button>
  `).join('');
}

function elegirHoraReprogramar(h) {
  horaSeleccionada = h;
  document.querySelectorAll('#grid-horarios-reprog .franja').forEach(b => b.classList.toggle('selected', b.textContent === h));
  $('#btn-confirmar-reprog').disabled = false;
}

async function cambiarFechaReprogramar(turnoId, peluqueroId, servicioId, valor) {
  fechaSeleccionada = valor;
  horaSeleccionada = null;
  $('#btn-confirmar-reprog').disabled = true;
  await cargarHorariosReprogramar(peluqueroId, servicioId);
}

async function confirmarReprogramar(turnoId) {
  try {
    const turno = await api(`/api/turnos/${turnoId}/reprogramar`, {
      method: 'PATCH',
      body: JSON.stringify({ ...credenciales, fecha: fechaSeleccionada, hora: horaSeleccionada }),
    });
    renderTurno(turno);
  } catch (err) {
    alert(err.message);
  }
}
