import os
import json
from datetime import datetime, date as date_cls
from functools import wraps

from flask import Flask, request, jsonify, session, render_template, redirect, url_for, send_from_directory, Response

from models import (
    db, Peluquero, Servicio, Turno, Admin, Settings,
    get_setting, set_setting, horarios_disponibles, hay_solapamiento, _to_minutes,
)
import seed as seed_module

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-cambiar-en-produccion')

# Render (y Heroku) entregan la URL de Postgres con el prefijo viejo
# "postgres://", que las versiones actuales de SQLAlchemy ya no aceptan
# (piden "postgresql://"). Lo normalizamos acá para no tener que tocar
# nada en el panel de Render.
_db_url = os.environ.get('DATABASE_URL', f"sqlite:///{os.path.join(BASE_DIR, 'looks.db')}")
if _db_url.startswith('postgres://'):
    _db_url = _db_url.replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_DATABASE_URI'] = _db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()
    seed_module.seed()


# ==================================================================
#  AUTENTICACIÓN (sesión simple basada en cookie firmada de Flask)
# ==================================================================

def login_admin(admin):
    session.clear()
    session['user_type'] = 'admin'
    session['user_id'] = admin.id
    session['nombre'] = admin.username


def login_peluquero(p):
    session.clear()
    session['user_type'] = 'peluquero'
    session['user_id'] = p.id
    session['nombre'] = p.nombre


def current_user():
    return {'user_type': session.get('user_type'), 'user_id': session.get('user_id'), 'nombre': session.get('nombre')}


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if session.get('user_type') != 'admin':
            return jsonify({'error': 'No autorizado. Iniciá sesión como mesa de entrada.'}), 401
        return fn(*a, **kw)
    return wrapper


def peluquero_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if session.get('user_type') != 'peluquero':
            return jsonify({'error': 'No autorizado. Iniciá sesión como peluquero.'}), 401
        return fn(*a, **kw)
    return wrapper


@app.post('/api/auth/login')
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    admin = Admin.query.filter_by(username=username).first()
    if admin and admin.check_password(password):
        login_admin(admin)
        return jsonify({'ok': True, 'user_type': 'admin', 'nombre': admin.username})

    p = Peluquero.query.filter_by(username=username, activo=True).first()
    if p and p.check_password(password):
        login_peluquero(p)
        return jsonify({'ok': True, 'user_type': 'peluquero', 'peluquero_id': p.id, 'nombre': p.nombre})

    return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401


@app.post('/api/auth/logout')
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@app.get('/api/auth/me')
def api_me():
    return jsonify(current_user())


# ==================================================================
#  API PÚBLICA — vista cliente
# ==================================================================

@app.get('/api/estado-local')
def api_estado_local():
    return jsonify({'abierto': get_setting('local_abierto', '1') == '1'})


@app.get('/api/peluqueros')
def api_peluqueros():
    activos = Peluquero.query.filter_by(activo=True).all()
    return jsonify([p.to_dict() for p in activos])


def _parse_fecha(fecha_str):
    try:
        return datetime.strptime(fecha_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


@app.get('/api/peluqueros/<peluquero_id>/disponibilidad')
def api_disponibilidad(peluquero_id):
    p = Peluquero.query.get_or_404(peluquero_id)
    servicio_id = request.args.get('servicio_id', type=int)
    fecha = _parse_fecha(request.args.get('fecha', ''))

    if not servicio_id or not fecha:
        return jsonify({'error': 'Faltan parámetros servicio_id y/o fecha (YYYY-MM-DD)'}), 400
    if fecha < date_cls.today():
        return jsonify({'horarios': []})

    servicio = Servicio.query.filter_by(id=servicio_id, peluquero_id=peluquero_id).first()
    if not servicio:
        return jsonify({'error': 'Servicio inválido para este peluquero'}), 404

    horarios = horarios_disponibles(p, servicio, fecha)
    return jsonify({'horarios': horarios, 'atiende': p.atiende_fecha(fecha)})


@app.post('/api/turnos')
def api_crear_turno():
    if get_setting('local_abierto', '1') != '1':
        return jsonify({'error': 'El local está cerrado en este momento, no se pueden confirmar turnos nuevos.'}), 409

    data = request.get_json(silent=True) or {}
    peluquero_id = data.get('peluquero_id')
    servicio_id = data.get('servicio_id')
    fecha = _parse_fecha(data.get('fecha', ''))
    hora = (data.get('hora') or '').strip()
    cliente = (data.get('cliente') or '').strip()
    telefono = (data.get('telefono') or '').strip()

    if not all([peluquero_id, servicio_id, fecha, hora, cliente, telefono]):
        return jsonify({'error': 'Faltan datos obligatorios'}), 400
    if len(cliente) > 120 or len(telefono) > 40:
        return jsonify({'error': 'Datos demasiado largos'}), 400

    p = Peluquero.query.filter_by(id=peluquero_id, activo=True).first()
    if not p:
        return jsonify({'error': 'Peluquero inválido'}), 404
    servicio = Servicio.query.filter_by(id=servicio_id, peluquero_id=peluquero_id).first()
    if not servicio:
        return jsonify({'error': 'Servicio inválido'}), 404
    if not p.atiende_fecha(fecha) or fecha < date_cls.today():
        return jsonify({'error': 'El peluquero no atiende ese día'}), 409

    # re-chequeo de disponibilidad en el servidor (evita choques por reservas simultáneas)
    disponibles = horarios_disponibles(p, servicio, fecha)
    if hora not in disponibles:
        return jsonify({'error': 'Ese horario ya no está disponible, elegí otro.'}), 409

    hora_fin_min = _to_minutes(hora) + servicio.duracion_min
    hora_fin = f'{hora_fin_min // 60:02d}:{hora_fin_min % 60:02d}'

    turno = Turno(
        peluquero_id=peluquero_id, servicio_id=servicio_id, servicio_nombre=servicio.nombre,
        precio=servicio.precio, fecha=fecha, hora_inicio=hora, hora_fin=hora_fin,
        cliente=cliente, telefono=telefono, estado='pendiente',
    )
    db.session.add(turno)
    db.session.commit()
    return jsonify(turno.to_dict()), 201


@app.get('/api/turnos/buscar')
def api_buscar_turno():
    """Autoservicio del cliente: busca sus turnos por teléfono + código."""
    telefono = (request.args.get('telefono') or '').strip()
    codigo = (request.args.get('codigo') or '').strip().upper()
    if not telefono or not codigo:
        return jsonify({'error': 'Ingresá teléfono y código de turno'}), 400

    turno = Turno.query.filter_by(telefono=telefono, codigo=codigo).first()
    if not turno:
        return jsonify({'error': 'No encontramos un turno con esos datos'}), 404
    return jsonify(turno.to_dict())


def _validar_propietario_turno(turno, data):
    return turno.telefono == (data.get('telefono') or '').strip() and turno.codigo == (data.get('codigo') or '').strip().upper()


@app.patch('/api/turnos/<int:turno_id>/cancelar')
def api_cancelar_turno(turno_id):
    data = request.get_json(silent=True) or {}
    turno = Turno.query.get_or_404(turno_id)
    if not _validar_propietario_turno(turno, data):
        return jsonify({'error': 'Teléfono o código incorrecto'}), 403
    if turno.estado == 'atendido':
        return jsonify({'error': 'Ese turno ya fue atendido, no se puede cancelar'}), 409
    turno.estado = 'cancelado'
    db.session.commit()
    return jsonify(turno.to_dict())


@app.patch('/api/turnos/<int:turno_id>/reprogramar')
def api_reprogramar_turno(turno_id):
    """El cliente cambia fecha/hora de su propio turno (mismo peluquero y servicio)."""
    data = request.get_json(silent=True) or {}
    turno = Turno.query.get_or_404(turno_id)
    if not _validar_propietario_turno(turno, data):
        return jsonify({'error': 'Teléfono o código incorrecto'}), 403
    if turno.estado in ('atendido', 'cancelado'):
        return jsonify({'error': f'Ese turno ya está {turno.estado}, no se puede modificar'}), 409

    nueva_fecha = _parse_fecha(data.get('fecha', ''))
    nueva_hora = (data.get('hora') or '').strip()
    if not nueva_fecha or not nueva_hora:
        return jsonify({'error': 'Faltan fecha y/u hora nuevas'}), 400

    p = turno.peluquero
    servicio = turno.servicio
    if not p.atiende_fecha(nueva_fecha) or nueva_fecha < date_cls.today():
        return jsonify({'error': 'El peluquero no atiende ese día'}), 409

    disponibles = horarios_disponibles(p, servicio, nueva_fecha)
    # si el nuevo horario es el mismo día/hora actual, permitirlo igual
    if nueva_hora not in disponibles and not (nueva_fecha == turno.fecha and nueva_hora == turno.hora_inicio):
        return jsonify({'error': 'Ese horario no está disponible'}), 409

    hora_fin_min = _to_minutes(nueva_hora) + servicio.duracion_min
    turno.fecha = nueva_fecha
    turno.hora_inicio = nueva_hora
    turno.hora_fin = f'{hora_fin_min // 60:02d}:{hora_fin_min % 60:02d}'
    turno.estado = 'pendiente'
    db.session.commit()
    return jsonify(turno.to_dict())


# ==================================================================
#  MESA DE ENTRADA (admin) — requiere sesión de admin
# ==================================================================

@app.get('/api/mesa/turnos')
@admin_required
def api_mesa_turnos():
    fecha = _parse_fecha(request.args.get('fecha', '')) or date_cls.today()
    turnos = Turno.query.filter_by(fecha=fecha).order_by(Turno.hora_inicio).all()
    activos = [t for t in turnos if t.estado != 'cancelado']
    return jsonify({
        'turnos': [t.to_dict() for t in turnos],
        'stats': {
            'total': len(turnos),
            'ingreso_estimado': sum(t.precio or 0 for t in activos),
        },
    })


@app.patch('/api/mesa/turnos/<int:turno_id>/estado')
@admin_required
def api_mesa_cambiar_estado(turno_id):
    data = request.get_json(silent=True) or {}
    nuevo_estado = data.get('estado')
    if nuevo_estado not in ('pendiente', 'confirmado', 'atendido', 'cancelado'):
        return jsonify({'error': 'Estado inválido'}), 400
    turno = Turno.query.get_or_404(turno_id)
    turno.estado = nuevo_estado
    db.session.commit()
    return jsonify(turno.to_dict())


@app.post('/api/mesa/estado-local')
@admin_required
def api_mesa_toggle_local():
    actual = get_setting('local_abierto', '1') == '1'
    set_setting('local_abierto', '0' if actual else '1')
    db.session.commit()
    return jsonify({'abierto': not actual})


# ---- CRUD de peluqueros (solo admin) ----

FOTO_MIME_PERMITIDOS = {'image/jpeg', 'image/png', 'image/webp'}
FOTO_TAMANO_MAX = 3 * 1024 * 1024  # 3 MB


def _procesar_foto_subida(p):
    """Si vino un archivo 'foto' en el form-data, lo valida y lo guarda en
    la columna LargeBinary (en Postgres, no en el disco del servidor).
    Lanza ValueError con un mensaje legible si algo no es válido."""
    archivo = request.files.get('foto')
    if not archivo or not archivo.filename:
        return
    if archivo.mimetype not in FOTO_MIME_PERMITIDOS:
        raise ValueError('La foto tiene que ser JPG, PNG o WEBP')
    contenido = archivo.read()
    if not contenido:
        return
    if len(contenido) > FOTO_TAMANO_MAX:
        raise ValueError('La foto no puede pesar más de 3 MB')
    p.foto_blob = contenido
    p.foto_mimetype = archivo.mimetype


def _datos_entrada():
    """Acepta tanto JSON (para pruebas/integraciones) como form-data
    (lo que manda el navegador cuando además se sube una foto)."""
    if request.form:
        return request.form
    return request.get_json(silent=True) or {}


@app.post('/api/mesa/peluqueros')
@admin_required
def api_crear_peluquero():
    data = _datos_entrada()
    pid = (data.get('id') or '').strip().lower()
    nombre = (data.get('nombre') or '').strip()
    if not pid or not nombre:
        return jsonify({'error': 'id y nombre son obligatorios'}), 400
    if db.session.get(Peluquero, pid):
        return jsonify({'error': 'Ya existe un peluquero con ese id'}), 409

    dias_raw = data.get('dias_atencion', [0, 1, 2, 3, 4])
    dias = json.loads(dias_raw) if isinstance(dias_raw, str) else dias_raw

    p = Peluquero(
        id=pid, nombre=nombre,
        especialidad=data.get('especialidad', ''),
        iniciales=data.get('iniciales') or nombre[:2].upper(),
        color=data.get('color', 'pink'),
        dias_atencion=','.join(str(d) for d in dias),
        hora_inicio=data.get('hora_inicio', '10:00'),
        hora_fin=data.get('hora_fin', '19:00'),
        pausa_inicio=data.get('pausa_inicio') or None,
        pausa_fin=data.get('pausa_fin') or None,
    )
    if data.get('username') and data.get('password'):
        p.username = data['username']
        p.set_password(data['password'])

    try:
        _procesar_foto_subida(p)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    db.session.add(p)
    db.session.flush()

    servicios_raw = data.get('servicios')
    if servicios_raw:
        servicios = json.loads(servicios_raw) if isinstance(servicios_raw, str) else servicios_raw
        for s in servicios:
            db.session.add(Servicio(
                peluquero_id=pid, nombre=s['nombre'],
                duracion_min=int(s['duracion_min']), precio=int(s['precio']),
            ))

    db.session.commit()
    return jsonify(p.to_dict()), 201


@app.put('/api/mesa/peluqueros/<peluquero_id>')
@admin_required
def api_editar_peluquero(peluquero_id):
    p = Peluquero.query.get_or_404(peluquero_id)
    data = _datos_entrada()
    for campo in ['nombre', 'especialidad', 'iniciales', 'color', 'hora_inicio', 'hora_fin', 'pausa_inicio', 'pausa_fin']:
        if campo in data and data.get(campo) not in (None, ''):
            setattr(p, campo, data[campo])
    if 'dias_atencion' in data:
        dias_raw = data['dias_atencion']
        dias = json.loads(dias_raw) if isinstance(dias_raw, str) else dias_raw
        p.dias_atencion = ','.join(str(d) for d in dias)
    if 'activo' in data:
        p.activo = data['activo'] in (True, 'true', '1', 1)
    if data.get('username') and data.get('password'):
        p.username = data['username']
        p.set_password(data['password'])

    try:
        _procesar_foto_subida(p)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    db.session.commit()
    return jsonify(p.to_dict())


@app.delete('/api/mesa/peluqueros/<peluquero_id>')
@admin_required
def api_borrar_peluquero(peluquero_id):
    p = Peluquero.query.get_or_404(peluquero_id)
    tiene_turnos_futuros = Turno.query.filter(
        Turno.peluquero_id == peluquero_id,
        Turno.fecha >= date_cls.today(),
        Turno.estado.in_(['pendiente', 'confirmado']),
    ).count()
    if tiene_turnos_futuros:
        # no lo borramos de la base (perderíamos el historial de turnos), lo desactivamos
        p.activo = False
        db.session.commit()
        return jsonify({'ok': True, 'desactivado': True, 'motivo': 'Tiene turnos futuros; se desactivó en vez de borrarlo.'})

    db.session.delete(p)
    db.session.commit()
    return jsonify({'ok': True, 'eliminado': True})


# ---- servicios de un peluquero (admin) ----

@app.post('/api/mesa/peluqueros/<peluquero_id>/servicios')
@admin_required
def api_agregar_servicio(peluquero_id):
    Peluquero.query.get_or_404(peluquero_id)
    data = request.get_json(silent=True) or {}
    if not data.get('nombre') or not data.get('duracion_min') or not data.get('precio'):
        return jsonify({'error': 'nombre, duracion_min y precio son obligatorios'}), 400
    s = Servicio(peluquero_id=peluquero_id, nombre=data['nombre'],
                 duracion_min=int(data['duracion_min']), precio=int(data['precio']))
    db.session.add(s)
    db.session.commit()
    return jsonify(s.to_dict()), 201


@app.delete('/api/mesa/servicios/<int:servicio_id>')
@admin_required
def api_borrar_servicio(servicio_id):
    s = Servicio.query.get_or_404(servicio_id)
    db.session.delete(s)
    db.session.commit()
    return jsonify({'ok': True})


# ---- recordatorio por WhatsApp (link manual, sin API externa) ----

def _link_whatsapp(telefono, mensaje):
    solo_numeros = ''.join(c for c in telefono if c.isdigit())
    # si no viene con código de país, asumimos Argentina (+54). Ajustable según el negocio.
    if not solo_numeros.startswith('54'):
        solo_numeros = '54' + solo_numeros
    from urllib.parse import quote
    return f'https://wa.me/{solo_numeros}?text={quote(mensaje)}'


@app.get('/api/mesa/turnos/<int:turno_id>/recordatorio')
@admin_required
def api_recordatorio_admin(turno_id):
    t = Turno.query.get_or_404(turno_id)
    mensaje = (
        f'Hola {t.cliente}! Te recordamos tu turno en Looks con {t.peluquero.nombre} '
        f'el {t.fecha.strftime("%d/%m")} a las {t.hora_inicio} hs para {t.servicio_nombre}. '
        f'¡Te esperamos!'
    )
    return jsonify({'whatsapp_url': _link_whatsapp(t.telefono, mensaje)})


# ==================================================================
#  AGENDA DEL PELUQUERO — requiere sesión de peluquero
#
#  Es de SOLO LECTURA a propósito: el peluquero consulta su grilla para
#  organizarse, pero cualquier cambio (marcar atendido, cancelar, mandar
#  recordatorio) lo hace el encargado desde "mesa de entrada". Por eso acá
#  no hay ningún endpoint PATCH/POST — si en el futuro se decide dar más
#  autonomía a los peluqueros, es cuestión de reincorporarlos (están en el
#  historial de git / en la versión anterior de este archivo).
# ==================================================================

@app.get('/api/agenda')
@peluquero_required
def api_agenda():
    peluquero_id = session['user_id']
    fecha = _parse_fecha(request.args.get('fecha', '')) or date_cls.today()
    turnos = Turno.query.filter_by(peluquero_id=peluquero_id, fecha=fecha).order_by(Turno.hora_inicio).all()
    p = db.session.get(Peluquero, peluquero_id)
    return jsonify({
        'peluquero': p.to_dict(incluir_servicios=False),
        'fecha': fecha.isoformat(),
        'turnos': [t.to_dict() for t in turnos],
    })


# ==================================================================
#  PÁGINAS (server-rendered, el JS de cada una llama a la API de arriba)
# ==================================================================

@app.get('/')
def pagina_inicio():
    return render_template('index.html')


@app.get('/mi-turno')
def pagina_mi_turno():
    return render_template('mi_turno.html')


@app.get('/login')
def pagina_login():
    return render_template('login.html')


@app.get('/mesa')
def pagina_mesa():
    if session.get('user_type') != 'admin':
        return redirect(url_for('pagina_login'))
    return render_template('mesa.html')


@app.get('/agenda')
def pagina_agenda():
    if session.get('user_type') != 'peluquero':
        return redirect(url_for('pagina_login'))
    return render_template('agenda.html')


@app.get('/fotos/<path:filename>')
def fotos(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'static', 'fotos'), filename)


@app.get('/fotos-db/<peluquero_id>')
def foto_desde_db(peluquero_id):
    """Sirve la foto que un admin subió desde el panel (vive en Postgres,
    no en el disco, para que sobreviva a los redeploys de Render)."""
    p = db.session.get(Peluquero, peluquero_id)
    if not p or not p.foto_blob:
        return '', 404
    return Response(p.foto_blob, mimetype=p.foto_mimetype or 'image/jpeg')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug)
