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

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const state = { fecha: hoyISO(), abierto: true, peluqueros: [] };

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function cambiarTab(t) {
  $('#vista-turnos').style.display = t === 'turnos' ? 'block' : 'none';
  $('#vista-peluqueros').style.display = t === 'peluqueros' ? 'block' : 'none';
  $('#tab-turnos').classList.toggle('active', t === 'turnos');
  $('#tab-peluqueros').classList.toggle('active', t === 'peluqueros');
  if (t === 'peluqueros') cargarPeluqueros();
}

// ---------------- estado del local ----------------
async function cargarEstadoLocal() {
  const { abierto } = await api('/api/estado-local');
  state.abierto = abierto;
  renderEstadoLocal();
}
function renderEstadoLocal() {
  $('#switch-local').classList.toggle('on', state.abierto);
  $('#control-local-texto').textContent = state.abierto ? 'Local abierto' : 'Local cerrado';
}
async function toggleLocal() {
  const { abierto } = await api('/api/mesa/estado-local', { method: 'POST' });
  state.abierto = abierto;
  renderEstadoLocal();
}

// ---------------- turnos del día ----------------
async function cambiarFechaMesa(valor) {
  state.fecha = valor;
  await cargarTurnos();
}

async function cargarTurnos() {
  const { turnos, stats } = await api(`/api/mesa/turnos?fecha=${state.fecha}`);
  renderStats(stats, turnos);
  renderTabla(turnos);
}

function renderStats(stats, turnos) {
  const porPeluquero = {};
  turnos.forEach(t => {
    if (t.estado === 'cancelado') return;
    porPeluquero[t.peluquero_nombre] = (porPeluquero[t.peluquero_nombre] || 0) + 1;
  });
  $('#stats-row').innerHTML = `
    <div class="stat"><div class="num">${stats.total}</div><div class="lbl">Turnos</div></div>
    <div class="stat"><div class="num">${fmt(stats.ingreso_estimado)}</div><div class="lbl">Ingreso estimado</div></div>
    ${Object.entries(porPeluquero).map(([nombre, n]) => `
      <div class="stat"><div class="num">${n}</div><div class="lbl">${esc(nombre.split(' ')[0])}</div></div>
    `).join('')}
  `;
}

function renderTabla(turnos) {
  if (!turnos.length) {
    $('#tabla-turnos').innerHTML = `<p class="sin-horarios">No hay turnos para ese día.</p>`;
    return;
  }
  $('#tabla-turnos').innerHTML = turnos.map(t => `
    <div class="fila-turno">
      <div class="hora">${esc(t.hora)}</div>
      <div class="cliente">${esc(t.cliente)}<span class="tel">${esc(t.telefono)}</span></div>
      <div class="tag-peluquero ${esc(t.peluquero_color)}">${esc(t.peluquero_nombre)}</div>
      <div>${esc(t.servicio)}</div>
      <div class="precio">${fmt(t.precio)}</div>
      <div class="estado ${esc(t.estado)}">${esc(t.estado)}</div>
      <div class="fila-acciones">
        ${(t.estado === 'pendiente' || t.estado === 'confirmado') ? `
          <button onclick="marcarEstado(${t.id}, 'atendido')">Atendido</button>
          <button onclick="marcarEstado(${t.id}, 'cancelado')">Cancelar</button>
          <button onclick="recordatorio(${t.id})">WhatsApp</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function marcarEstado(id, estado) {
  await api(`/api/mesa/turnos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) });
  await cargarTurnos();
}

async function recordatorio(id) {
  const { whatsapp_url } = await api(`/api/mesa/turnos/${id}/recordatorio`);
  window.open(whatsapp_url, '_blank');
}

// ---------------- gestión de peluqueros ----------------
async function cargarPeluqueros() {
  state.peluqueros = await api('/api/peluqueros'); // trae solo activos; para editar inactivos habría que ampliar el endpoint
  renderPeluqueros();
  renderDiasChecks();
}

function renderDiasChecks() {
  $('#np-dias-checks').innerHTML = DIAS.map((d, i) => `
    <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" value="${i}" ${i < 5 ? 'checked' : ''}> ${d}</label>
  `).join('');
}

function renderPeluqueros() {
  $('#lista-peluqueros').innerHTML = state.peluqueros.map(p => `
    <div class="gestion-peluquero">
      <div class="gestion-peluquero-head">
        <div>
          <strong>${esc(p.nombre)}</strong>
          <span class="especialidad"> · ${esc(p.especialidad)}</span>
          <div class="dias-badge" style="text-align:left;margin-top:4px;">${esc(p.dias)} · ${esc(p.horario_texto)}${p.tiene_login ? ' · con acceso a agenda propia' : ''}</div>
        </div>
        <div class="fila-acciones">
          <button onclick="borrarPeluquero('${p.id}')">Eliminar</button>
        </div>
      </div>
      <div class="servicios-mini">
        ${p.servicios.map(s => `${esc(s.nombre)} (${fmt(s.precio)}) <button style="border:none;background:none;color:var(--red);cursor:pointer;" onclick="borrarServicio(${s.id}, '${p.id}')">✕</button>`).join(' · ') || 'Sin servicios cargados'}
      </div>
      <form style="display:flex;gap:8px;margin-top:10px;" onsubmit="return agregarServicio(event, '${p.id}')">
        <input type="text" placeholder="Servicio" class="srv-nombre" required style="flex:2;padding:7px;border-radius:6px;border:1px solid var(--line);">
        <input type="number" placeholder="Min" class="srv-duracion" required min="5" style="flex:1;padding:7px;border-radius:6px;border:1px solid var(--line);">
        <input type="number" placeholder="Precio" class="srv-precio" required min="0" style="flex:1;padding:7px;border-radius:6px;border:1px solid var(--line);">
        <button class="btn btn-ghost btn-sm" type="submit">+ Servicio</button>
      </form>
    </div>
  `).join('');
}

async function borrarPeluquero(id) {
  if (!confirm('¿Eliminar (o desactivar si tiene turnos futuros) este peluquero?')) return;
  await api(`/api/mesa/peluqueros/${id}`, { method: 'DELETE' });
  await cargarPeluqueros();
}

async function borrarServicio(id, peluqueroId) {
  await api(`/api/mesa/servicios/${id}`, { method: 'DELETE' });
  await cargarPeluqueros();
}

async function agregarServicio(e, peluqueroId) {
  e.preventDefault();
  const form = e.target;
  const nombre = form.querySelector('.srv-nombre').value.trim();
  const duracion_min = form.querySelector('.srv-duracion').value;
  const precio = form.querySelector('.srv-precio').value;
  await api(`/api/mesa/peluqueros/${peluqueroId}/servicios`, {
    method: 'POST', body: JSON.stringify({ nombre, duracion_min, precio }),
  });
  await cargarPeluqueros();
  return false;
}

async function crearPeluquero(e) {
  e.preventDefault();
  const msg = $('#mensaje-nuevo-peluquero');
  msg.innerHTML = '';
  const dias = Array.from(document.querySelectorAll('#np-dias-checks input:checked')).map(c => Number(c.value));
  try {
    await api('/api/mesa/peluqueros', {
      method: 'POST',
      body: JSON.stringify({
        id: $('#np-id').value.trim().toLowerCase(),
        nombre: $('#np-nombre').value.trim(),
        especialidad: $('#np-especialidad').value.trim(),
        color: $('#np-color').value,
        hora_inicio: $('#np-hora-inicio').value,
        hora_fin: $('#np-hora-fin').value,
        pausa_inicio: $('#np-pausa-inicio').value || null,
        pausa_fin: $('#np-pausa-fin').value || null,
        dias_atencion: dias,
        username: $('#np-username').value.trim() || null,
        password: $('#np-password').value || null,
      }),
    });
    $('#form-nuevo-peluquero').reset();
    renderDiasChecks();
    await cargarPeluqueros();
  } catch (err) {
    msg.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
  return false;
}

// ---------------- init ----------------
$('#input-fecha-mesa').value = state.fecha;
cargarEstadoLocal();
cargarTurnos();
