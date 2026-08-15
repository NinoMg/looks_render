"""Carga los datos iniciales: los 3 peluqueros originales de la demo,
un usuario admin para 'mesa de entrada', y turnos de ejemplo para hoy."""

from datetime import date
from models import db, Peluquero, Servicio, Turno, Admin, set_setting


def seed():
    if Peluquero.query.first():
        return  # ya hay datos, no pisar nada

    rodrigo = Peluquero(
        id='rodrigo', nombre='Rodrigo Ibáñez', especialidad='Fades y diseños',
        iniciales='RI', color='pink', foto='barber1.png',
        dias_atencion='1,2,3,4,5',  # martes a sábado
        hora_inicio='10:00', hora_fin='19:00',
        pausa_inicio='12:40', pausa_fin='14:00',
    )
    rodrigo.set_password('rodrigo123')
    rodrigo.username = 'rodrigo'

    facundo = Peluquero(
        id='facundo', nombre='Facundo Torres', especialidad='Clásico y barba',
        iniciales='FT', color='cyan', foto='barber2.png',
        dias_atencion='0,1,2,3,4',  # lunes a viernes
        hora_inicio='09:30', hora_fin='18:30',
        pausa_inicio='12:30', pausa_fin='13:30',
    )
    facundo.set_password('facundo123')
    facundo.username = 'facundo'

    bruno = Peluquero(
        id='bruno', nombre='Bruno Salas', especialidad='Color y texturas',
        iniciales='BS', color='navy', foto='barber3.png',
        dias_atencion='2,3,4,5,6',  # miércoles a domingo
        hora_inicio='11:00', hora_fin='20:00',
        pausa_inicio='13:15', pausa_fin='15:00',
    )
    bruno.set_password('bruno123')
    bruno.username = 'bruno'

    db.session.add_all([rodrigo, facundo, bruno])
    db.session.flush()

    servicios = [
        Servicio(peluquero_id='rodrigo', nombre='Corte fade', duracion_min=40, precio=9000),
        Servicio(peluquero_id='rodrigo', nombre='Corte + diseño', duracion_min=55, precio=12000),
        Servicio(peluquero_id='rodrigo', nombre='Perfilado de barba', duracion_min=25, precio=5500),

        Servicio(peluquero_id='facundo', nombre='Corte clásico', duracion_min=35, precio=8000),
        Servicio(peluquero_id='facundo', nombre='Corte moderno', duracion_min=55, precio=12500),
        Servicio(peluquero_id='facundo', nombre='Afeitado a navaja', duracion_min=30, precio=7000),

        Servicio(peluquero_id='bruno', nombre='Corte con textura', duracion_min=45, precio=10000),
        Servicio(peluquero_id='bruno', nombre='Color / mechas', duracion_min=90, precio=22000),
        Servicio(peluquero_id='bruno', nombre='Corte + color', duracion_min=110, precio=27000),
    ]
    db.session.add_all(servicios)

    admin = Admin(username='admin')
    admin.set_password('admin123')
    db.session.add(admin)

    set_setting('local_abierto', '1')

    db.session.commit()
    print('Datos iniciales cargados.')
    print('Login mesa de entrada -> usuario: admin / clave: admin123')
    print('Login peluqueros -> rodrigo/rodrigo123, facundo/facundo123, bruno/bruno123')
    print('(Cambiá estas claves antes de usarlo con datos reales)')
