// ---------------- helpers ----------------
const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');

// Escapa cualquier valor antes de insertarlo en innerHTML (evita XSS con
// nombres/teléfonos que ingresa el usuario). Regla: TODO texto que venga
// de un input de usuario pasa por acá antes de ir al DOM.
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function hoyISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// ---------------- estado ----------------
const state = { peluqueros: [], abierto: true, peluqueroId: null, servicioId: null, fecha: hoyISO(), hora: null, horariosDisponibles: [] };

// ---------------- estado del local ----------------
async function cargarEstadoLocal() {
  try {
    const { abierto } = await api('/api/estado-local');
    state.abierto = abierto;
  } catch (e) { /* si falla, asumimos abierto */ }
  const pill = $('#status-pill');
  pill.classList.toggle('abierto', state.abierto);
  pill.classList.toggle('cerrado', !state.abierto);
  $('#status-texto').textContent = state.abierto ? 'Local abierto ahora' : 'Local cerrado por ahora';
}

// ---------------- grilla de peluqueros ----------------
async function cargarPeluqueros() {
  try {
    state.peluqueros = await api('/api/peluqueros');
  } catch (e) {
    $('#grid-peluqueros').innerHTML = `<p class="sin-horarios">No se pudo cargar la lista de peluqueros.</p>`;
    return;
  }
  renderPeluqueros();
}

function renderPeluqueros() {
  $('#grid-peluqueros').innerHTML = state.peluqueros.map((p, i) => `
    <div class="card-peluquero ${p.color}">
      <div class="foto-wrap ${p.color}">
        <span class="numero">N.° ${String(i + 1).padStart(2, '0')}</span>
        <div class="badge-logo"><img src="/fotos/looks_logo.png" alt="Looks"></div>
        ${p.foto ? `<img src="/fotos/${esc(p.foto)}" alt="${esc(p.nombre)}">` : `<div class="foto-placeholder">${esc(p.iniciales)}</div>`}
        <div class="shine"></div>
      </div>
      <div class="nameplate">
        <h3>${esc(p.nombre)}</h3>
        <div class="especialidad">${esc(p.especialidad)}</div>
      </div>
      <div class="card-footer">
        <div class="dias-badge">${esc(p.dias)} · ${esc(p.horario_texto)}</div>
        <button class="btn btn-primary btn-block" onclick="elegirPeluquero('${p.id}')">Ver disponibilidad</button>
      </div>
    </div>
  `).join('');
}

function porId(id) { return state.peluqueros.find(p => p.id === id); }

// ---------------- flujo de reserva ----------------
function elegirPeluquero(id) {
  state.peluqueroId = id;
  state.servicioId = null;
  state.fecha = hoyISO();
  state.hora = null;
  state.horariosDisponibles = [];
  $('#seccion-reserva').style.display = 'block';
  renderPanelReserva();
  $('#seccion-reserva').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cargarHorarios() {
  if (!state.servicioId) { state.horariosDisponibles = []; return; }
  try {
    const r = await api(`/api/peluqueros/${state.peluqueroId}/disponibilidad?servicio_id=${state.servicioId}&fecha=${state.fecha}`);
    state.horariosDisponibles = r.horarios;
  } catch (e) {
    state.horariosDisponibles = [];
  }
}

async function renderPanelReserva() {
  const p = porId(state.peluqueroId);
  const servicio = p.servicios.find(s => s.id === state.servicioId);

  $('#panel-reserva').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="avatar ${p.color}">${esc(p.iniciales)}</div>
        <div>
          <h3>${esc(p.nombre)}</h3>
          <div class="especialidad">${esc(p.especialidad)} · ${esc(p.dias)}</div>
        </div>
      </div>

      <span class="step-label">1. Elegí el servicio</span>
      <div class="lista-servicios">
        ${p.servicios.map(s => `
          <div class="servicio ${s.id === state.servicioId ? 'selected' : ''}" onclick="elegirServicio(${s.id})">
            <div class="servicio-info">
              <div class="nombre">${esc(s.nombre)}</div>
              <div class="duracion">${esc(s.duracion)}</div>
            </div>
            <div class="precio">${fmt(s.precio)}</div>
          </div>
        `).join('')}
      </div>

      <span class="step-label">2. Elegí el día</span>
      <div class="campo-fecha">
        <input type="date" id="input-fecha" value="${state.fecha}" min="${hoyISO()}" onchange="cambiarFecha(this.value)">
      </div>

      <span class="step-label">3. Elegí el horario</span>
      <div class="ruler"></div>
      <div class="grid-horarios" id="grid-horarios">
        ${!state.servicioId
          ? `<p class="sin-horarios">Elegí un servicio primero.</p>`
          : `<p class="sin-horarios">Buscando horarios…</p>`}
      </div>

      <span class="step-label">4. Tus datos</span>
      <form class="form-datos" id="form-reserva" onsubmit="return confirmarTurno(event)">
        <label>Nombre y apellido
          <input type="text" id="input-nombre" required placeholder="Ej: Juan Gómez" maxlength="120">
        </label>
        <label>Teléfono
          <input type="tel" id="input-telefono" required placeholder="Ej: 260-4123456" maxlength="40">
        </label>
      </form>

      <div id="mensaje-reserva"></div>
      ${!state.abierto ? '<div class="aviso">El local está cerrado en este momento — no se pueden confirmar turnos nuevos.</div>' : ''}

      <button class="btn btn-primary btn-block" id="btn-confirmar" form="form-reserva" type="submit"
        ${(!servicio || !state.hora || !state.abierto) ? 'disabled' : ''}>
        Confirmar turno${servicio ? ' · ' + fmt(servicio.precio) : ''}
      </button>
    </div>
  `;

  if (state.servicioId) {
    await cargarHorarios();
    renderGridHorarios();
  }
}

function renderGridHorarios() {
  const grid = $('#grid-horarios');
  if (!state.horariosDisponibles.length) {
    grid.innerHTML = `<p class="sin-horarios">No hay horarios disponibles ese día. Probá con otra fecha.</p>`;
    return;
  }
  grid.innerHTML = state.horariosDisponibles.map(h => `
    <button type="button" class="franja ${h === state.hora ? 'selected' : ''}" onclick="elegirHora('${h}')">${h}</button>
  `).join('');
}

async function elegirServicio(id) {
  state.servicioId = id;
  state.hora = null;
  await renderPanelReserva();
}

async function cambiarFecha(valor) {
  state.fecha = valor;
  state.hora = null;
  await renderPanelReserva();
}

function elegirHora(h) {
  state.hora = h;
  renderPanelReserva();
}

async function confirmarTurno(e) {
  e.preventDefault();
  if (!state.abierto) return false;
  const p = porId(state.peluqueroId);
  const servicio = p.servicios.find(s => s.id === state.servicioId);
  if (!servicio || !state.hora) return false;

  const nombre = $('#input-nombre').value.trim();
  const telefono = $('#input-telefono').value.trim();
  if (!nombre || !telefono) return false;

  const btn = $('#btn-confirmar');
  btn.disabled = true;
  $('#mensaje-reserva').innerHTML = '';

  try {
    const turno = await api('/api/turnos', {
      method: 'POST',
      body: JSON.stringify({
        peluquero_id: p.id, servicio_id: servicio.id, fecha: state.fecha,
        hora: state.hora, cliente: nombre, telefono,
      }),
    });
    mostrarTicket(p, turno);
  } catch (err) {
    $('#mensaje-reserva').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    btn.disabled = false;
    // el horario pudo haber sido tomado por otra persona justo ahora: refrescamos la grilla
    await cargarHorarios();
    renderGridHorarios();
  }
  return false;
}

function mostrarTicket(p, turno) {
  const fechaTxt = new Date(turno.fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#panel-reserva').innerHTML = `
    <div class="ticket">
      <div class="ticket-num">TURNO N.° ${turno.id}</div>
      <h3 style="margin-top:6px;">¡Turno reservado!</h3>
      <div class="ticket-perf"></div>
      <div class="ticket-row"><span class="label">Peluquero</span><span>${esc(p.nombre)}</span></div>
      <div class="ticket-row"><span class="label">Servicio</span><span>${esc(turno.servicio)}</span></div>
      <div class="ticket-row"><span class="label">Día</span><span>${esc(fechaTxt)}</span></div>
      <div class="ticket-row"><span class="label">Horario</span><span>${esc(turno.hora)} hs</span></div>
      <div class="ticket-row"><span class="label">Cliente</span><span>${esc(turno.cliente)}</span></div>
      <div class="ticket-row"><span class="label">Seña / total</span><span>${fmt(turno.precio)}</span></div>
      <div class="ticket-perf"></div>
      <p style="font-size:.82rem;color:rgba(27,25,38,.6);">Guardá este código para editar o cancelar tu turno más adelante:</p>
      <div class="ticket-codigo">${esc(turno.codigo)}</div>
      <button class="btn btn-ghost btn-block" onclick="volverAGrilla()">Reservar otro turno</button>
    </div>
  `;
}

function volverAGrilla() {
  state.peluqueroId = null;
  state.servicioId = null;
  state.hora = null;
  $('#seccion-reserva').style.display = 'none';
  $('#seccion-peluqueros').scrollIntoView({ behavior: 'smooth' });
}

// ---------------- init ----------------
cargarEstadoLocal();
cargarPeluqueros();
