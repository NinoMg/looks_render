import random
import string
from datetime import datetime, date as date_cls, time as time_cls, timedelta

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']


def _codigo_turno():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


class Peluquero(db.Model):
    __tablename__ = 'peluqueros'

    id = db.Column(db.String(40), primary_key=True)  # slug, ej: 'rodrigo'
    nombre = db.Column(db.String(120), nullable=False)
    especialidad = db.Column(db.String(120), default='')
    iniciales = db.Column(db.String(4), default='')
    color = db.Column(db.String(20), default='pink')  # pink | cyan | navy (paleta del front)
    foto = db.Column(db.String(200), default='')

    # días que atiende: lista de enteros 0=lunes ... 6=domingo, guardado como "0,1,2"
    dias_atencion = db.Column(db.String(20), default='0,1,2,3,4')
    hora_inicio = db.Column(db.String(5), default='10:00')   # "HH:MM"
    hora_fin = db.Column(db.String(5), default='19:00')
    pausa_inicio = db.Column(db.String(5), nullable=True)    # almuerzo, opcional
    pausa_fin = db.Column(db.String(5), nullable=True)

    # login para la vista de agenda propia (opcional, se puede crear después)
    username = db.Column(db.String(80), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=True)

    activo = db.Column(db.Boolean, default=True)

    servicios = db.relationship('Servicio', backref='peluquero', cascade='all, delete-orphan')
    turnos = db.relationship('Turno', backref='peluquero', cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return bool(self.password_hash) and check_password_hash(self.password_hash, password)

    def dias_lista(self):
        if not self.dias_atencion:
            return []
        return [int(d) for d in self.dias_atencion.split(',') if d != '']

    def dias_texto(self):
        idx = self.dias_lista()
        if not idx:
            return ''
        nombres = [DIAS_SEMANA[i][:3].capitalize() for i in sorted(idx)]
        return ' · '.join(nombres)

    def atiende_fecha(self, fecha: date_cls):
        return fecha.weekday() in self.dias_lista()

    def to_dict(self, incluir_servicios=True):
        data = {
            'id': self.id,
            'nombre': self.nombre,
            'especialidad': self.especialidad,
            'iniciales': self.iniciales,
            'color': self.color,
            'foto': self.foto,
            'dias': self.dias_texto(),
            'dias_atencion': self.dias_lista(),
            'horario_texto': f'{self.hora_inicio} – {self.hora_fin}',
            'hora_inicio': self.hora_inicio,
            'hora_fin': self.hora_fin,
            'pausa_inicio': self.pausa_inicio,
            'pausa_fin': self.pausa_fin,
            'activo': self.activo,
            'tiene_login': bool(self.username),
        }
        if incluir_servicios:
            data['servicios'] = [s.to_dict() for s in self.servicios]
        return data


class Servicio(db.Model):
    __tablename__ = 'servicios'

    id = db.Column(db.Integer, primary_key=True)
    peluquero_id = db.Column(db.String(40), db.ForeignKey('peluqueros.id'), nullable=False)
    nombre = db.Column(db.String(120), nullable=False)
    duracion_min = db.Column(db.Integer, nullable=False)
    precio = db.Column(db.Integer, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'nombre': self.nombre,
            'duracion_min': self.duracion_min,
            'duracion': f'{self.duracion_min} min',
            'precio': self.precio,
        }


class Turno(db.Model):
    __tablename__ = 'turnos'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(6), unique=True, default=_codigo_turno)

    peluquero_id = db.Column(db.String(40), db.ForeignKey('peluqueros.id'), nullable=False)
    servicio_id = db.Column(db.Integer, db.ForeignKey('servicios.id'), nullable=False)
    servicio_nombre = db.Column(db.String(120))  # copia histórica, por si el servicio cambia/borra después
    precio = db.Column(db.Integer)

    fecha = db.Column(db.Date, nullable=False)
    hora_inicio = db.Column(db.String(5), nullable=False)  # "HH:MM"
    hora_fin = db.Column(db.String(5), nullable=False)

    cliente = db.Column(db.String(120), nullable=False)
    telefono = db.Column(db.String(40), nullable=False)

    estado = db.Column(db.String(20), default='pendiente')  # pendiente|confirmado|atendido|cancelado
    creado_en = db.Column(db.DateTime, default=datetime.utcnow)

    servicio = db.relationship('Servicio')

    def to_dict(self):
        return {
            'id': self.id,
            'codigo': self.codigo,
            'peluquero_id': self.peluquero_id,
            'peluquero_nombre': self.peluquero.nombre if self.peluquero else None,
            'peluquero_color': self.peluquero.color if self.peluquero else None,
            'servicio_id': self.servicio_id,
            'servicio': self.servicio_nombre,
            'precio': self.precio,
            'fecha': self.fecha.isoformat(),
            'hora': self.hora_inicio,
            'hora_fin': self.hora_fin,
            'cliente': self.cliente,
            'telefono': self.telefono,
            'estado': self.estado,
        }


class Admin(db.Model):
    __tablename__ = 'admins'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Settings(db.Model):
    __tablename__ = 'settings'
    clave = db.Column(db.String(40), primary_key=True)
    valor = db.Column(db.String(200))


def get_setting(clave, default=None):
    row = db.session.get(Settings, clave)
    return row.valor if row else default


def set_setting(clave, valor):
    row = db.session.get(Settings, clave)
    if row is None:
        row = Settings(clave=clave, valor=str(valor))
        db.session.add(row)
    else:
        row.valor = str(valor)


# ---------------- lógica de disponibilidad ----------------

def _to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(':')
    return int(h) * 60 + int(m)


def _to_hhmm(mins: int) -> str:
    return f'{mins // 60:02d}:{mins % 60:02d}'


def horarios_disponibles(peluquero: Peluquero, servicio: Servicio, fecha: date_cls, paso_min=15):
    """Genera franjas horarias posibles para un servicio en una fecha dada,
    respetando horario de atención, pausa/almuerzo, y evitando choques con
    turnos ya reservados (pendiente/confirmado/atendido)."""

    if not peluquero.atiende_fecha(fecha):
        return []

    inicio = _to_minutes(peluquero.hora_inicio)
    fin = _to_minutes(peluquero.hora_fin)
    duracion = servicio.duracion_min

    pausa_ini = _to_minutes(peluquero.pausa_inicio) if peluquero.pausa_inicio else None
    pausa_fin = _to_minutes(peluquero.pausa_fin) if peluquero.pausa_fin else None

    ocupados = Turno.query.filter(
        Turno.peluquero_id == peluquero.id,
        Turno.fecha == fecha,
        Turno.estado != 'cancelado',
    ).all()
    rangos_ocupados = [(_to_minutes(t.hora_inicio), _to_minutes(t.hora_fin)) for t in ocupados]

    # si la fecha es hoy, no ofrecer horarios ya pasados
    ahora_min = None
    if fecha == date_cls.today():
        now = datetime.now()
        ahora_min = now.hour * 60 + now.minute

    disponibles = []
    t = inicio
    while t + duracion <= fin:
        choca_pausa = pausa_ini is not None and t < pausa_fin and pausa_ini < t + duracion
        choca_turno = any(t < f and i < t + duracion for i, f in rangos_ocupados)
        es_pasado = ahora_min is not None and t < ahora_min
        if not choca_pausa and not choca_turno and not es_pasado:
            disponibles.append(_to_hhmm(t))
        t += paso_min

    return disponibles


def hay_solapamiento(peluquero_id, fecha, hora_inicio_str, duracion_min, excluir_turno_id=None):
    nuevo_ini = _to_minutes(hora_inicio_str)
    nuevo_fin = nuevo_ini + duracion_min
    q = Turno.query.filter(
        Turno.peluquero_id == peluquero_id,
        Turno.fecha == fecha,
        Turno.estado != 'cancelado',
    )
    if excluir_turno_id:
        q = q.filter(Turno.id != excluir_turno_id)
    for t in q.all():
        ini = _to_minutes(t.hora_inicio)
        fin = _to_minutes(t.hora_fin)
        if nuevo_ini < fin and ini < nuevo_fin:
            return True
    return False
