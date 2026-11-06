# 🍹 Micheladas El Mismísimo — POS y control de bar

Sistema de punto de venta e inventario para el bar (Guatemala, Quetzales, interfaz en español). Funciona en el navegador y se puede instalar como app en tabletas y celulares.

**Tecnología:** Node.js 22.5+ · Express 5 · SQLite (`node:sqlite`, sin base de datos externa) · JavaScript puro en el navegador (sin frameworks).

> ⚠️ **Mantén este repositorio PRIVADO.** Incluye el menú y los precios del negocio (`src/base_inicial`) y las contraseñas de fábrica están documentadas aquí. Nunca subas la carpeta `data/` (es la base real de ventas), archivos `.env` ni respaldos.

## Publicar en GitHub

1. Crea en GitHub un repositorio **privado** y no inicialices archivos desde la página.
2. Desde esta carpeta, inicializa y revisa lo que se va a subir:

   ```bash
   git init
   git add .
   git status --short
   ```

   Comprueba que no aparezcan `.env`, `data/`, `node_modules/` ni respaldos. La base `src/base_inicial/base_inicial.sqlite` sí se incluye porque contiene los datos iniciales del sistema.
3. Crea el primer commit y enlaza el repositorio (cambia la URL por la que te muestra GitHub):

   ```bash
   git commit -m "Preparar despliegue en Proxmox"
   git branch -M main
   git remote add origin https://github.com/USUARIO/REPOSITORIO.git
   git push -u origin main
   ```

No publiques este proyecto en un repositorio público: contiene información propia del negocio y usuarios/contraseñas iniciales.

## Instalar en una VM de Proxmox

Proxmox aloja la máquina virtual; dentro de ella instala Ubuntu Server 24.04 LTS. Como punto de partida, asigna 2 CPU, 2 GB de RAM y espacio de disco suficiente para el negocio y sus respaldos. Configura una IP fija o una reserva DHCP en tu red.

### 1. Instalar Docker en Ubuntu

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### 2. Descargar el proyecto y configurarlo

Autoriza una clave SSH de la VM para leer el repositorio privado en GitHub y luego clónalo:

```bash
git clone git@github.com:USUARIO/REPOSITORIO.git
cd REPOSITORIO
cp .env.example .env
```

Si quieres usar un puerto distinto, cambia `PORT_PUBLICO` en `.env`. No compartas ni subas ese archivo.

### 3. Iniciar y comprobar

```bash
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

Cuando `docker compose ps` indique que el servicio está sano y la respuesta muestre `"base_datos":"ok"`, abre `http://IP_DE_LA_VM:3000` desde los equipos de la red. El puerto publicado debe permitirse en el firewall de Ubuntu y en la red. Para acceso desde Internet, configura un dominio, HTTPS y un proxy inverso; no expongas directamente el puerto sin protección.

La base de datos y la clave de sesiones se guardan en el volumen Docker `mismisimo_pos_data`, que sobrevive a reinicios y reconstrucciones del contenedor. Al iniciar por primera vez, el sistema copia allí la base inicial del dueño.

Al entrar por primera vez, cambia las contraseñas de fábrica desde **Personal** antes de dar acceso al sistema.

### Actualizar el sistema

Desde la carpeta del proyecto en la VM:

```bash
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose ps
```

Las actualizaciones no reemplazan el volumen con los datos del negocio. Antes de actualizar, haz un respaldo. Para crear uno con la aplicación detenida:

```bash
sudo docker compose stop
sudo docker run --rm \
  -v mismisimo_pos_data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'tar -czf /backup/respaldo-pos-$(date +%F-%H%M).tar.gz -C /data .'
sudo docker compose start
```

Guarda el archivo de respaldo fuera de esta carpeta y nunca lo subas a GitHub.

## Arrancar en tu computadora

```bash
npm ci
npm start          # http://localhost:3000
```

Usuarios de fábrica (el sistema avisa al administrador mientras siga con la contraseña de fábrica: **cámbialas en Personal** antes de usarlo en serio): `admin / admin123` y `vendedor / vendedor123`.

## Variables de entorno (todas opcionales)

| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000). |
| `DATA_DIR` | Carpeta donde se guarda la base de datos (por defecto `data/`). |
| `JWT_SECRET` | Clave de las sesiones, mínimo 32 caracteres. Si falta, se genera una y se guarda en `data/.jwt_secret`. |
| `LOGIN_INTENTOS`, `LOGIN_VENTANA_SEG` | Límite de intentos fallidos de login (8 cada 5 min por defecto). |

## Subir a Hostinger (Node.js)

1. Descarga este repositorio como ZIP (o conéctalo desde GitHub) y súbelo **sin** `node_modules` ni `data`.
2. En el panel: entrada de la app = `src/server.js`, instalar dependencias (`npm ci --omit=dev`) y reiniciar.
3. Comprueba `tu-sitio/api/health` → debe decir `"base_datos":"ok"`.
4. Define `JWT_SECRET` en las variables de entorno.

**Antes de cada actualización, copia la carpeta `data`** (ahí está toda la información del negocio). Las actualizaciones solo agregan; nunca borran ni reemplazan datos.

## Qué hay en cada carpeta

```
src/            servidor (Express): rutas, base de datos, inventario, stock, login
  routes/       admin, auth, inventario, POS (ventas y cajas), traspasos
  base_inicial/ base de arranque con el menú (solo se usa si no existe data/)
public/         la aplicación en el navegador (index.html, js/app.js, css, íconos, sw.js)
CAMBIOS.md      historial detallado de todos los cambios y cómo se verificaron
```

## Herramientas incluidas

- `GET /api/health` — estado del sistema y de la base de datos.
- `GET /api/health?velocidad=1` — prueba de velocidad (internet, aparato y servidor) para diagnosticar lentitud en tabletas.
