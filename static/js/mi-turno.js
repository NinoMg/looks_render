const $ = sel => document.querySelector(sel);
const fmt = n => '$' + Number(n).toLocaleString('es-AR');
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }

const NUMERO_WHATSAPP = '2604693013';
function linkWhatsapp(mensaje) {
  return `https://wa.me/54${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

async function buscarTurno(e) {
  e.preventDefault();
  const telefono = $('#input-telefono').value.replace(/\D/g, '');
  $('#mensaje-buscar').innerHTML = '';
  try {
    const turno = await api(`/api/turnos/buscar?telefono=${encodeURIComponent(telefono)}`);
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
        <p class="sin-horarios">¿Necesitás cambiar el día, el horario o cancelar? Escribinos por WhatsApp.</p>
        <a class="btn btn-primary btn-block" href="${linkWhatsapp('Hola! Quería modificar mi turno N.° ' + turno.id + '.')}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>
      ` : `<p class="sin-horarios">Este turno ya no se puede modificar (está ${esc(turno.estado)}).</p>`}
    </div>
  `;
}
