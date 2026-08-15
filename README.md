# Looks — backend real (Flask + SQLite)

Reescritura de la demo `looksGit` conectada a un backend de verdad: los datos
viven en una base SQLite (no en arrays de JavaScript), hay login separado
para "mesa de entrada" y para cada peluquero, y se agregaron las funciones
que pediste.

## Qué cambió respecto a la demo original

- **Persistencia real**: peluqueros, servicios y turnos viven en `looks.db`
  (SQLite vía SQLAlchemy). Ya no se pierden al refrescar la página, y dos
  personas reservando al mismo tiempo se ven entre sí.
- **CRUD de peluqueros**: desde "Mesa de entrada → Peluqueros" se pueden
  agregar, editar servicios y eliminar peluqueros (si tienen turnos futuros
  pendientes, se desactivan en vez de borrarse, para no perder el
  historial).
- **Agenda propia del peluquero, de solo lectura**: cada peluquero tiene su
  usuario y contraseña y entra a `/agenda` para ver sus turnos del día que
  elija y organizarse — pero no puede cancelar, reprogramar, marcar como
  atendido ni mandar recordatorios. Cualquier cambio lo hace el encargado
  desde mesa de entrada (`/mesa`), que sí ve y gestiona los turnos de todos
  los peluqueros. Esto es intencional: el encargado es quien atiende el
  teléfono y organiza los turnos, así que es el único con permiso de
  escritura sobre ellos.
- **Edición/cancelación por el cliente**: en `/mi-turno`, el cliente busca su
  turno con teléfono + el código de 6 caracteres que le dieron al reservar,
  y puede cancelarlo o cambiar día/horario él mismo.
- **Recordatorio por WhatsApp**: desde mesa de entrada, cada turno tiene un
  botón "WhatsApp" que abre `wa.me` con el mensaje precargado, listo para
  que el encargado lo envíe con un clic. Mandarlo *automático* sin
  intervención humana requiere una cuenta de un proveedor externo (Twilio o
  la API de WhatsApp Business de Meta) — no la armé porque necesita
  credenciales tuyas, pero el backend ya arma el mensaje, así que cuando
  tengas esa cuenta es cuestión de reemplazar esta función por una llamada
  a esa API.
- **Corrección de bugs de la demo**: los horarios disponibles ahora se
  calculan según la duración real de cada servicio (antes un corte de 90
  min podía superponerse con el siguiente turno), se puede elegir fecha
  (antes solo dejaba reservar "para hoy"), y los datos que ingresa el
  cliente se escapan antes de mostrarse en pantalla (la demo original tenía
  una vulnerabilidad XSS ahí).

## Estructura

```
app.py          → toda la API REST + las rutas de página
models.py       → modelos de base de datos y lógica de horarios disponibles
seed.py         → carga los 3 peluqueros originales + turnos de ejemplo la primera vez
templates/      → páginas (Jinja): reservar, mi-turno, login, mesa, agenda
static/         → CSS, JS de cada página, y las fotos originales
requirements.txt, Procfile → para correrlo/desplegarlo
```

## Correrlo en tu máquina

```bash
cd looks-backend
python3 -m venv venv
source venv/bin/activate        # en Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abrí `http://localhost:5000`. La primera vez que corre, crea `looks.db` y
carga los 3 peluqueros originales con estos usuarios (**cambialos antes de
usarlo con datos reales** — están en `seed.py`):

| Rol                | Usuario   | Contraseña   |
|---------------------|-----------|--------------|
| Mesa de entrada      | `admin`   | `admin123`   |
| Peluquero Rodrigo    | `rodrigo` | `rodrigo123` |
| Peluquero Facundo    | `facundo` | `facundo123` |
| Peluquero Bruno      | `bruno`   | `bruno123`   |

Para borrar todo y volver a empezar de cero, simplemente borrá `looks.db` y
volvé a correr `python app.py`.

⚠️ **Ojo con `DATABASE_URL` en tu máquina**: si en tu servidor corrés más de
un proyecto (como te pasó con `AgendaConsultorios`), fijate que no quede
exportada globalmente en `~/.bashrc` o similar — cada proyecto debería
manejar la suya. Para correr Looks en local con SQLite, asegurate de que
`echo $DATABASE_URL` no devuelva nada (o hacé `unset DATABASE_URL` antes).

## Desplegarlo para mostrarlo (Render / PythonAnywhere)

El código ya está listo para producción con `gunicorn` (ver `Procfile`), y
lee `SECRET_KEY` y `DATABASE_URL` de variables de entorno si existen, así
que no hay que tocar nada al mudarlo. Dos cosas importantes antes de subirlo:

1. **Cambiá las contraseñas por defecto** en `seed.py` (o creá los
   peluqueros/admin de nuevo a mano y borrá los de ejemplo) antes de
   compartir el link con nadie.
2. **Definí `SECRET_KEY`** como variable de entorno en el hosting (cualquier
   string largo y random) — si no, usa una por defecto que no es segura para
   producción.

### Render (con GitHub y Postgres)

Estos son los pasos completos para tu caso — repo de GitHub que ya tenés, y
Postgres desde el arranque (no SQLite):

**1. Subí este código al repo.** Reemplazá el contenido del repo por esta
carpeta (o copiá los archivos adentro) y pusheá:
```bash
cd looks-backend
git add .
git commit -m "Backend Flask con Postgres, roles admin/peluquero"
git push origin main
```
(si tu rama se llama `master` en vez de `main`, ajustá el último comando)

**2. Creá la base Postgres primero.** En el dashboard de Render: **New +**
→ **PostgreSQL** → elegís el plan Free → le ponés un nombre (ej.
`looks-db`) → misma región que vas a usar para el web service (así la
latencia es mínima) → **Create Database**. Cuando termine de aprovisionar,
copiá el valor de **"Internal Database URL"** (no la externa — al estar
ambos servicios en la misma red de Render, la interna es más rápida y no
tiene límite de conexiones externas).

**3. Creá el Web Service.** **New +** → **Web Service** → conectás tu repo
de GitHub → Render va a detectar automáticamente el `Procfile`
(`gunicorn app:app`), así que no hace falta tocar el "Start Command". Como
build command dejá `pip install -r requirements.txt`.

**4. Variables de entorno.** En la sección "Environment" del web service,
agregá:
- `DATABASE_URL` → pegás la Internal Database URL del paso 2
- `SECRET_KEY` → un string random y largo. Lo generás así:
  ```bash
  python3 -c "import secrets; print(secrets.token_hex(32))"
  ```

**5. Deploy.** Render arranca el build solo. La primera vez que corre,
`seed.py` va a crear los peluqueros y el admin de ejemplo automáticamente
en la base Postgres (mismos usuarios/contraseñas por defecto que en local
— **cambialos antes de compartir el link**, ver `seed.py`).

Con esto, aunque Render reinicie el servicio o hagas un redeploy, los
turnos quedan guardados en la base Postgres (no se pierden como pasaría con
SQLite en el plan free).

### PythonAnywhere

El plan free de PythonAnywhere sí tiene almacenamiento persistente, así que
`looks.db` no se borra entre reinicios — para una demo o incluso un
lanzamiento chico alcanza bien.

Pasos: subís el código (con git o el uploader de archivos) → creás un
virtualenv e instalás `requirements.txt` → en la pestaña "Web" configurás
una app Flask apuntando a `app.py` (variable `app`) → en "Static files"
mapeás `/static/` y `/fotos/` a las carpetas correspondientes del proyecto
→ reload.

### Cuando pases a la "etapa tres" (tu propio servidor)

Como ya tenés experiencia con Hetzner: esta misma app corre igual detrás de
`gunicorn` + `nginx` + un servicio de `systemd`, sin cambiar nada del
código — ahí sí `looks.db` persiste normalmente en el disco del servidor (o
podés migrar a Postgres si crece el volumen de turnos). Si llegás a esa
etapa y querés una mano con la config de nginx/systemd o la migración a
Postgres, avisame.

## Próximos pasos sugeridos

- HTTPS en el hosting final (Render y PythonAnywhere lo dan gratis).
- Si migrás a Postgres, usar `flask-migrate`/Alembic para versionar cambios
  de esquema en vez de `db.create_all()`.
- Backups periódicos de la base si vas a manejar turnos reales.
- Si más adelante querés WhatsApp automático, avisame y armamos la
  integración con Twilio (es la opción más simple de las dos).
# looks_render
