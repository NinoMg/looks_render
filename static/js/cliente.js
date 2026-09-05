// ---------------- helpers ----------------
const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');

const NUMERO_WHATSAPP = '2604693013';
function linkWhatsapp(mensaje) {
  return `https://wa.me/54${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
}

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
const state = {
  peluqueros: [], abierto: true, peluqueroId: null, servicioId: null,
  fecha: hoyISO(), hora: null, horariosDisponibles: [],
  cargandoHorarios: false, notaFecha: '',
};

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
        <div class="badge-logo"><img src="/fotos/looks_logo.png" alt="Looks"></div>
        ${p.foto_url ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nombre)}">` : `<div class="foto-placeholder">${esc(p.iniciales)}</div>`}
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
  state.notaFecha = '';
  $('#seccion-reserva').style.display = 'block';
  renderPanelReserva();
  $('#seccion-reserva').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fmtFechaCorta(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Busca desde state.fecha en adelante el primer día con horarios libres, y
// si no es el mismo día que ya estaba elegido, salta ahí y avisa por qué.
async function buscarProximoDisponible() {
  const fechaOriginal = state.fecha;
  try {
    const r = await api(`/api/peluqueros/${state.peluqueroId}/proximo-disponible?servicio_id=${state.servicioId}&desde=${state.fecha}`);
    if (r.fecha) {
      state.horariosDisponibles = r.horarios;
      state.fecha = r.fecha;
      state.notaFecha = r.fecha !== fechaOriginal
        ? `No había turnos libres el ${fmtFechaCorta(fechaOriginal)} — te mostramos el próximo día con lugar.`
        : '';
    } else {
      state.horariosDisponibles = [];
      state.notaFecha = 'No encontramos horarios libres en los próximos dos meses. Probá con otro peluquero o servicio.';
    }
  } catch (e) {
    state.horariosDisponibles = [];
  }
}

// Trae los horarios de la fecha EXACTA que el cliente eligió a mano (sin
// saltar a otro día solo).
async function cargarHorarios() {
  if (!state.servicioId) { state.horariosDisponibles = []; return; }
  try {
    const r = await api(`/api/peluqueros/${state.peluqueroId}/disponibilidad?servicio_id=${state.servicioId}&fecha=${state.fecha}`);
    state.horariosDisponibles = r.horarios;
  } catch (e) {
    state.horariosDisponibles = [];
  }
}

function renderPanelReserva() {
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
      <div class="campo-fecha" style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="irDia(-1)" ${state.fecha <= hoyISO() ? 'disabled' : ''} aria-label="Día anterior">‹</button>
        <input type="date" id="input-fecha" value="${state.fecha}" min="${hoyISO()}" onchange="cambiarFecha(this.value)">
        <button type="button" class="btn btn-ghost btn-sm" onclick="irDia(1)" aria-label="Día siguiente">›</button>
      </div>

      <span class="step-label">3. Elegí el horario</span>
      <div class="ruler"></div>
      ${state.notaFecha ? `<p class="aviso">${esc(state.notaFecha)}</p>` : ''}
      <div class="grid-horarios" id="grid-horarios">${renderContenidoHorarios()}</div>

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

      <button class="btn btn-primary btn-block" id="btn-confirmar" form="form-reserva" type="submit"
        ${(!servicio || !state.hora) ? 'disabled' : ''}
        Confirmar turno${servicio ? ' · ' + fmt(servicio.precio) : ''}
      </button>
    </div>
  `;
}

function renderContenidoHorarios() {
  if (!state.servicioId) {
    return `<p class="sin-horarios">Elegí un servicio primero.</p>`;
  }
  if (state.cargandoHorarios) {
    return `<p class="sin-horarios">Buscando el próximo horario libre…</p>`;
  }
  if (!state.horariosDisponibles.length) {
    return `<p class="sin-horarios">No hay horarios disponibles ese día.
      <button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px;" onclick="buscarDesdeAqui()">Buscar el próximo día libre</button>
    </p>`;
  }
  return state.horariosDisponibles.map(h => `
    <button type="button" class="franja ${h === state.hora ? 'selected' : ''}" onclick="elegirHora('${h}')">${h}</button>
  `).join('');
}

async function elegirServicio(id) {
  state.servicioId = id;
  state.hora = null;
  state.notaFecha = '';
  state.cargandoHorarios = true;
  renderPanelReserva();
  await buscarProximoDisponible();
  state.cargandoHorarios = false;
  renderPanelReserva();
}

// El cliente cambió la fecha a mano (con el date picker o las flechas):
// respetamos exactamente esa fecha, sin saltar sola a otro día.
async function cambiarFecha(valor) {
  state.fecha = valor;
  state.hora = null;
  state.notaFecha = '';
  if (state.servicioId) {
    state.cargandoHorarios = true;
    renderPanelReserva();
    await cargarHorarios();
    state.cargandoHorarios = false;
  }
  renderPanelReserva();
}

function irDia(delta) {
  const d = new Date(state.fecha + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const nueva = d.toISOString().slice(0, 10);
  if (nueva < hoyISO()) return;
  cambiarFecha(nueva);
}

// Desde el mensaje "no hay horarios ese día": busca el próximo libre a
// partir de la fecha que se estaba mirando.
async function buscarDesdeAqui() {
  state.cargandoHorarios = true;
  renderPanelReserva();
  await buscarProximoDisponible();
  state.cargandoHorarios = false;
  renderPanelReserva();
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
    renderPanelReserva();
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
