const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts = {}) {
  const esFormData = opts.body instanceof FormData;
  const headers = esFormData ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(path, { headers, credentials: 'same-origin', ...opts });
  if (res.status === 401) { window.location.href = '/administrador'; throw new Error('Sesión vencida'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const state = { fecha: hoyISO(), abierto: true, peluqueros: [] };
let turnosCache = {}; // id -> turno completo, para el modal de detalle

function guardarEnCache(turnos) {
  turnos.forEach(t => { turnosCache[t.id] = t; });
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/administrador';
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

// ---------------- turnos del día / semana ----------------
let vistaTurnos = 'dia';
let semanaDesde = lunesDeEstaSemana(state.fecha);

function lunesDeEstaSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const diaIso = (d.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo
  d.setDate(d.getDate() - diaIso);
  return d.toISOString().slice(0, 10);
}

function cambiarVistaTurnos(v) {
  vistaTurnos = v;
  $('#vista-dia-btn').classList.toggle('active', v === 'dia');
  $('#vista-semana-btn').classList.toggle('active', v === 'semana');
  $('#vista-dia-turnos').style.display = v === 'dia' ? 'block' : 'none';
  $('#vista-semana-turnos').style.display = v === 'semana' ? 'block' : 'none';
  $('#input-fecha-mesa').style.display = v === 'dia' ? 'inline-block' : 'none';
  if (v === 'semana') cargarSemana();
}

async function cambiarFechaMesa(valor) {
  state.fecha = valor;
  await cargarTurnos();
}

async function cargarTurnos() {
  const { turnos, stats } = await api(`/api/mesa/turnos?fecha=${state.fecha}`);
  guardarEnCache(turnos);
  renderStats(stats, turnos);
  renderTabla(turnos);
}

function semanaAnterior() {
  const d = new Date(semanaDesde + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  semanaDesde = d.toISOString().slice(0, 10);
  cargarSemana();
}

function semanaSiguiente() {
  const d = new Date(semanaDesde + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  semanaDesde = d.toISOString().slice(0, 10);
  cargarSemana();
}

async function cargarSemana() {
  const r = await api(`/api/mesa/turnos-semana?desde=${semanaDesde}`);
  semanaDesde = r.desde; // el backend normaliza al lunes
  guardarEnCache(r.turnos);
  renderSemana(r);
}

function fmtFechaCorta(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
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

  const porCelda = {};
  r.turnos.forEach(t => {
    const key = `${t.peluquero_id}_${t.fecha}`;
    (porCelda[key] = porCelda[key] || []).push(t);
  });

  let html = `<div class="grilla-semana-header"><div></div>`;
  dias.forEach((f, i) => {
    const num = Number(f.slice(8, 10));
    const esHoy = f === hoyISO();
    html += `<div class="celda-dia-header" style="${esHoy ? 'box-shadow:0 0 0 2px var(--pink) inset;' : ''}">${NOMBRES[i]}<div class="num">${num}</div></div>`;
  });
  html += `</div>`;

  if (!r.peluqueros.length) {
    $('#grilla-semana').innerHTML = html + `</div><p class="sin-horarios">No hay peluqueros activos.</p>`;
    return;
  }

  r.peluqueros.forEach(p => {
    html += `<div class="grilla-semana-fila">`;
    html += `<div class="celda-peluquero-nombre"><span class="tag-peluquero ${esc(p.color)}">${esc(p.nombre)}</span></div>`;
    dias.forEach(f => {
      const jsDay = new Date(f + 'T00:00:00').getDay();
      const diaIso = (jsDay + 6) % 7;
      const atiende = (p.dias_atencion || []).includes(diaIso);
      const turnos = porCelda[`${p.id}_${f}`] || [];

      if (!atiende) {
        html += `<div class="celda-turno-dia celda-no-atiende">no atiende</div>`;
      } else if (!turnos.length) {
        html += `<div class="celda-turno-dia"><span class="celda-vacia">libre</span></div>`;
      } else {
        html += `<div class="celda-turno-dia">`;
        turnos.slice(0, 4).forEach(t => {
          html += `<div class="chip-turno ${esc(t.estado)}" onclick="abrirModalTurno(${t.id})" title="Ver y gestionar"><span class="hora-chip">${esc(t.hora)}</span> ${esc(t.cliente.split(' ')[0])}</div>`;
        });
        if (turnos.length > 4) html += `<div class="chip-mas">+${turnos.length - 4} más</div>`;
        html += `</div>`;
      }
    });
    html += `</div>`;
  });

  $('#grilla-semana').innerHTML = html;
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

// Botones de acción según el estado del turno — se reutiliza en la tabla
// del día y en el modal que se abre desde la grilla semanal.
function botonesAccionTurno(t) {
  if (t.estado === 'atendido' || t.estado === 'cancelado') return '';
  let botones = '';
  if (t.estado === 'pendiente') {
    botones += `<button onclick="marcarEstado(${t.id}, 'confirmado')">Confirmar</button>`;
  }
  botones += `<button onclick="marcarEstado(${t.id}, 'atendido')">Atendido</button>`;
  botones += `<button onclick="marcarEstado(${t.id}, 'cancelado')">Rechazar</button>`;
  botones += `<button onclick="recordatorio(${t.id})">WhatsApp</button>`;
  return botones;
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
      <div class="fila-acciones">${botonesAccionTurno(t)}</div>
    </div>
  `).join('');
}

async function marcarEstado(id, estado) {
  await api(`/api/mesa/turnos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) });
  cerrarModal();
  if (vistaTurnos === 'semana') { await cargarSemana(); } else { await cargarTurnos(); }
}

async function recordatorio(id) {
  const { whatsapp_url } = await api(`/api/mesa/turnos/${id}/recordatorio`);
  window.open(whatsapp_url, '_blank');
}

// ---------------- modal de detalle de turno (vista semanal) ----------------
function abrirModalTurno(id) {
  const t = turnosCache[id];
  if (!t) return;
  const fechaTxt = new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#modal-turno-contenido').innerHTML = `
    <div class="tag-peluquero ${esc(t.peluquero_color)}" style="margin-bottom:10px;">${esc(t.peluquero_nombre)}</div>
    <h3 style="margin-bottom:2px;">${esc(t.cliente)}</h3>
    <div style="font-size:.85rem;color:rgba(27,25,38,.6);margin-bottom:14px;">${esc(t.telefono)}</div>
    <div class="ticket-row"><span class="label">Servicio</span><span>${esc(t.servicio)}</span></div>
    <div class="ticket-row"><span class="label">Día</span><span>${esc(fechaTxt)}</span></div>
    <div class="ticket-row"><span class="label">Hora</span><span>${esc(t.hora)} hs</span></div>
    <div class="ticket-row"><span class="label">Seña / total</span><span>${fmt(t.precio)}</span></div>
    <div class="ticket-row"><span class="label">Estado</span><span class="estado ${esc(t.estado)}">${esc(t.estado)}</span></div>
    <div class="fila-acciones" style="margin-top:16px;justify-content:flex-end;">${botonesAccionTurno(t) || '<span style="font-size:.8rem;color:rgba(27,25,38,.5);">Este turno ya está cerrado.</span>'}</div>
  `;
  $('#modal-turno').style.display = 'flex';
}

function cerrarModal() {
  const m = $('#modal-turno');
  if (m) m.style.display = 'none';
}

function cerrarModalSiFondo(e) {
  if (e.target.id === 'modal-turno') cerrarModal();
}

// ---------------- gestión de peluqueros ----------------
let editandoPeluquero = null;
let editandoServicio = null;

async function cargarPeluqueros() {
  state.peluqueros = await api('/api/mesa/peluqueros'); // trae también los suspendidos
  renderPeluqueros();
  renderHorariosNuevo();
}

function filaHorarioDia(i, h) {
  const activo = !!h;
  const horaIni = h ? h.hora_inicio : '09:00';
  const horaFin = h ? h.hora_fin : '18:00';
  const pausaIni = h ? (h.pausa_inicio || '') : '';
  const pausaFin = h ? (h.pausa_fin || '') : '';
  const tienePausa = !!(pausaIni && pausaFin);
  return `
    <div class="fila-horario-dia" data-dia="${i}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0;">
      <label style="display:flex;align-items:center;gap:4px;min-width:70px;">
        <input type="checkbox" class="chk-dia" data-dia="${i}" ${activo ? 'checked' : ''} onchange="toggleFilaHorario(this)">
        ${DIAS[i]}
      </label>
      <input type="time" class="hd-inicio" value="${horaIni}" ${activo ? '' : 'disabled'} style="padding:6px;border-radius:6px;border:1px solid var(--line);">
      <span>a</span>
      <input type="time" class="hd-fin" value="${horaFin}" ${activo ? '' : 'disabled'} style="padding:6px;border-radius:6px;border:1px solid var(--line);">
      <label style="display:flex;align-items:center;gap:4px;font-size:.78rem;color:rgba(27,25,38,.55);">
        <input type="checkbox" class="chk-pausa" ${tienePausa ? 'checked' : ''} ${activo ? '' : 'disabled'} onchange="togglePausaHorario(this)">
        pausa
      </label>
      <input type="time" class="hd-pausa-inicio" title="Pausa desde" value="${pausaIni}" ${activo && tienePausa ? '' : 'disabled'} style="padding:6px;border-radius:6px;border:1px solid var(--line);">
      <span>a</span>
      <input type="time" class="hd-pausa-fin" title="Pausa hasta" value="${pausaFin}" ${activo && tienePausa ? '' : 'disabled'} style="padding:6px;border-radius:6px;border:1px solid var(--line);">
    </div>
  `;
}

function togglePausaHorario(chk) {
  const fila = chk.closest('.fila-horario-dia');
  const ini = fila.querySelector('.hd-pausa-inicio');
  const fin = fila.querySelector('.hd-pausa-fin');
  ini.disabled = !chk.checked;
  fin.disabled = !chk.checked;
  if (!chk.checked) {
    ini.value = '';
    fin.value = '';
  } else {
    if (!ini.value) ini.value = '13:00';
    if (!fin.value) fin.value = '14:00';
  }
}

function renderHorariosNuevo() {
  $('#np-horarios').innerHTML = DIAS.map((d, i) => filaHorarioDia(i, i < 5 ? { hora_inicio: '10:00', hora_fin: '19:00' } : null)).join('');
}

function toggleFilaHorario(chk) {
  const fila = chk.closest('.fila-horario-dia');
  const activo = chk.checked;
  fila.querySelectorAll('input[type="time"]').forEach(inp => inp.disabled = !activo);
}

function leerHorariosDeContenedor(contenedor) {
  return Array.from(contenedor.querySelectorAll('.fila-horario-dia'))
    .filter(fila => fila.querySelector('.chk-dia').checked)
    .map(fila => ({
      dia_semana: Number(fila.dataset.dia),
      hora_inicio: fila.querySelector('.hd-inicio').value,
      hora_fin: fila.querySelector('.hd-fin').value,
      pausa_inicio: fila.querySelector('.hd-pausa-inicio').value || null,
      pausa_fin: fila.querySelector('.hd-pausa-fin').value || null,
    }));
}

function renderPeluqueros() {
  $('#lista-peluqueros').innerHTML = state.peluqueros.map(p => `
    <div class="gestion-peluquero ${!p.activo ? 'suspendido' : ''}">
      ${editandoPeluquero === p.id ? renderFormEdicionPeluquero(p) : renderVistaPeluquero(p)}
    </div>
  `).join('') || '<p class="sin-horarios">Todavía no hay peluqueros cargados.</p>';
}

function renderVistaPeluquero(p) {
  return `
    <div class="gestion-peluquero-head">
      <div style="display:flex;align-items:center;gap:12px;">
        ${p.foto_url
          ? `<img src="${esc(p.foto_url)}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
          : `<div class="avatar ${esc(p.color)}" style="width:44px;height:44px;font-size:.9rem;flex-shrink:0;">${esc(p.iniciales)}</div>`}
        <div>
          <strong>${esc(p.nombre)}</strong>
          ${!p.activo ? '<span class="badge-suspendido">Suspendido</span>' : ''}
          <span class="especialidad"> · ${esc(p.especialidad)}</span>
          <div class="dias-badge" style="text-align:left;margin-top:4px;">${esc(p.dias)} · ${esc(p.horario_texto)}</div>
        </div>
      </div>
      <div class="fila-acciones">
        <button onclick="toggleEditarPeluquero('${p.id}')">Editar</button>
        <button onclick="toggleActivoPeluquero('${p.id}', ${p.activo})">${p.activo ? 'Suspender' : 'Reactivar'}</button>
        <button onclick="borrarPeluquero('${p.id}')">Eliminar</button>
      </div>
    </div>
    <div class="servicios-mini">
      ${p.servicios.map(s => renderServicioMini(p, s)).join('') || 'Sin servicios cargados'}
    </div>
    <form style="display:flex;gap:8px;margin-top:10px;" onsubmit="return agregarServicio(event, '${p.id}')">
      <input type="text" placeholder="Servicio" class="srv-nombre" required style="flex:2;padding:7px;border-radius:6px;border:1px solid var(--line);">
      <input type="number" placeholder="Min" class="srv-duracion" required min="5" style="flex:1;padding:7px;border-radius:6px;border:1px solid var(--line);">
      <input type="text" inputmode="numeric" placeholder="Precio (sin puntos)" class="srv-precio" required style="flex:1;padding:7px;border-radius:6px;border:1px solid var(--line);">
      <button class="btn btn-ghost btn-sm" type="submit">+ Servicio</button>
    </form>
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
      <input type="file" accept="image/jpeg,image/png,image/webp" id="foto-${p.id}" style="font-size:.75rem;max-width:200px;">
      <button class="btn btn-ghost btn-sm" type="button" onclick="subirFoto('${p.id}')">${p.foto_url ? 'Cambiar foto' : 'Subir foto'}</button>
    </div>
  `;
}

function renderServicioMini(p, s) {
  if (editandoServicio === s.id) {
    return `<span class="servicio-edit">
      <input type="text" id="es-nombre-${s.id}" value="${escAttr(s.nombre)}">
      <input type="number" id="es-duracion-${s.id}" value="${s.duracion_min}" title="Minutos">
      <input type="text" inputmode="numeric" id="es-precio-${s.id}" value="${s.precio}" title="Precio, sin puntos">
      <button class="ok" onclick="guardarEdicionServicio(${s.id})" title="Guardar">✓</button>
      <button class="no" onclick="toggleEditarServicio(${s.id})" title="Cancelar">✕</button>
    </span>`;
  }
  return `<span class="servicio-chip">${esc(s.nombre)} (${fmt(s.precio)})
    <button onclick="toggleEditarServicio(${s.id})" title="Editar">✎</button>
    <button onclick="borrarServicio(${s.id}, '${p.id}')" title="Borrar">✕</button>
  </span>`;
}

function renderFormEdicionPeluquero(p) {
  const porDia = {};
  (p.horarios || []).forEach(h => porDia[h.dia_semana] = h);
  return `
    <form class="form-nuevo-peluquero" style="margin-top:0;box-shadow:none;border:none;padding:0;" onsubmit="return guardarEdicionPeluquero(event, '${p.id}')">
      <label>Nombre completo <input type="text" id="ep-nombre-${p.id}" value="${escAttr(p.nombre)}" required></label>
      <label>Especialidad <input type="text" id="ep-especialidad-${p.id}" value="${escAttr(p.especialidad)}"></label>
      <label>Color de tarjeta
        <select id="ep-color-${p.id}">
          <option value="pink" ${p.color === 'pink' ? 'selected' : ''}>Rosa</option>
          <option value="cyan" ${p.color === 'cyan' ? 'selected' : ''}>Cyan</option>
          <option value="navy" ${p.color === 'navy' ? 'selected' : ''}>Navy</option>
        </select>
      </label>
      <div class="full">
        <div style="font-size:.8rem;color:rgba(27,25,38,.6);margin-bottom:6px;">Días y horario de atención (cada día puede tener su propio horario)</div>
        <div class="full" id="ep-horarios-${p.id}" style="display:flex;flex-direction:column;gap:2px;">
          ${DIAS.map((d, i) => filaHorarioDia(i, porDia[i])).join('')}
        </div>
      </div>
      <div id="mensaje-editar-${p.id}" class="full"></div>
      <div class="full" style="display:flex;gap:8px;">
        <button class="btn btn-primary" type="submit">Guardar cambios</button>
        <button class="btn btn-ghost" type="button" onclick="toggleEditarPeluquero('${p.id}')">Cancelar</button>
      </div>
    </form>
  `;
}

function toggleEditarPeluquero(id) {
  editandoPeluquero = editandoPeluquero === id ? null : id;
  renderPeluqueros();
}

function toggleEditarServicio(id) {
  editandoServicio = editandoServicio === id ? null : id;
  renderPeluqueros();
}

async function guardarEdicionPeluquero(e, id) {
  e.preventDefault();
  const horarios = leerHorariosDeContenedor(document.getElementById(`ep-horarios-${id}`));
  const msg = document.getElementById(`mensaje-editar-${id}`);
  try {
    await api(`/api/mesa/peluqueros/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        nombre: document.getElementById(`ep-nombre-${id}`).value.trim(),
        especialidad: document.getElementById(`ep-especialidad-${id}`).value.trim(),
        color: document.getElementById(`ep-color-${id}`).value,
        horarios: horarios,
      }),
    });
    editandoPeluquero = null;
    await cargarPeluqueros();
  } catch (err) {
    if (msg) msg.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
  return false;
}

async function guardarEdicionServicio(id) {
  const nombre = $(`#es-nombre-${id}`).value.trim();
  const duracion_min = $(`#es-duracion-${id}`).value;
  const precio = $(`#es-precio-${id}`).value;
  try {
    await api(`/api/mesa/servicios/${id}`, { method: 'PUT', body: JSON.stringify({ nombre, duracion_min, precio }) });
    editandoServicio = null;
    await cargarPeluqueros();
  } catch (err) {
    alert(err.message);
  }
}

async function toggleActivoPeluquero(id, activoActual) {
  const accion = activoActual ? 'suspender' : 'reactivar';
  if (!confirm(`¿Seguro que querés ${accion} a este peluquero?`)) return;
  try {
    await api(`/api/mesa/peluqueros/${id}`, { method: 'PUT', body: JSON.stringify({ activo: !activoActual }) });
    await cargarPeluqueros();
  } catch (err) {
    alert(err.message);
  }
}

async function subirFoto(id) {
  const input = document.getElementById(`foto-${id}`);
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('foto', input.files[0]);
  try {
    await api(`/api/mesa/peluqueros/${id}`, { method: 'PUT', body: fd });
    await cargarPeluqueros();
  } catch (err) {
    alert(err.message);
  }
}

async function borrarPeluquero(id) {
  if (!confirm('¿Eliminar (o suspender si tiene turnos futuros) este peluquero?')) return;
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
  try {
    await api(`/api/mesa/peluqueros/${peluqueroId}/servicios`, {
      method: 'POST', body: JSON.stringify({ nombre, duracion_min, precio }),
    });
    await cargarPeluqueros();
  } catch (err) {
    alert(err.message);
  }
  return false;
}

async function crearPeluquero(e) {
  e.preventDefault();
  const msg = $('#mensaje-nuevo-peluquero');
  msg.innerHTML = '';
  const horarios = leerHorariosDeContenedor($('#np-horarios'));

  const fd = new FormData();
  fd.append('id', $('#np-id').value.trim().toLowerCase());
  fd.append('nombre', $('#np-nombre').value.trim());
  fd.append('especialidad', $('#np-especialidad').value.trim());
  fd.append('color', $('#np-color').value);
  fd.append('horarios', JSON.stringify(horarios));
  const fotoInput = $('#np-foto');
  if (fotoInput.files[0]) fd.append('foto', fotoInput.files[0]);

  try {
    await api('/api/mesa/peluqueros', { method: 'POST', body: fd });
    $('#form-nuevo-peluquero').reset();
    renderHorariosNuevo();
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
