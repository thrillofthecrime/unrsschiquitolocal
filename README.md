# unrsschiquito

Un lector RSS chiquito, para correr en tu propia máquina. Feeds, carpetas y
leído/no leído. Nada más.

---

## Correrlo

### Con Docker

```sh
git clone
cd unrsschiquito
docker compose up -d
```

Vive en http://localhost:8080
Tu base queda en ./data/unrsschiquito.db

### Con Node, sin Docker
Necesitás Node 22.5 o superior que ya trae node:sqlite

```sh
node server.js
```

En Node 18 o 20 no existe `node:sqlite`; instalá el respaldo y funciona igual:

```sh
npm install better-sqlite3 && node server.js
```

---

## Cómo está armado

```
server.js          servidor http: estáticos, API y los comandos de consola
lib/
  db.js            sqlite: esquema y todas las consultas
  fetcher.js       descarga con límites (sin IPs privadas, 5 MB, 12 s)
  xml.js           parser XML tolerante, propio
  feed.js          RSS 2.0 / RSS 1.0 (RDF) / Atom → una forma única
  discover.js      encontrar el feed de un sitio a partir de cualquier link
  refresh.js       bajar feeds y guardarlos
  opml.js          importar y exportar suscripciones
public/
  index.html       cáscara: panel, lista, lector, modal
  boot.js          tema y modo sin color antes del primer pintado
  styles.css       única hoja: brutalismo web, serif, claro/oscuro, responsive
  app.js           toda la lógica del cliente
  api.js           el único archivo del cliente que sabe del servidor
Dockerfile · docker-compose.yml
```

El navegador solo habla con este servidor y el servidor es el único que toca la base y el único que sale a internet. No hay servicios externos, ni claves, ni cuentas ni ningún archivo config falopa.
No hay login, no hay usuarios, no hay permisos.

Se guardan carpetas, feeds y una fila por artículo con `guid`, `title`, `link`, `summary`, `published_at`, `read` y el texto completo.
Podes correr`prune` cada tanto para limpiar.

---

## Configuración

Todo por variables de entorno, todo opcional.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `PORT` | `8080` | Puerto. |
| `HOST` | `127.0.0.1` | Dónde escuchar. Fuera de loopback exige contraseña. |
| `UNRSS_DB` | `./unrsschiquito.db` | Ruta del archivo de la base. |
| `UNRSS_PASSWORD` | — | Si está, pide contraseña (HTTP Basic; el usuario da igual). |
| `UNRSS_NO_AUTH` | — | `=1` para escuchar fuera de loopback **sin** contraseña. |
| `UNRSS_ALLOWED_HOSTS` | — | Hosts extra aceptados en el header `Host`, separados por coma. |
| `ALLOW_PRIVATE_HOSTS` | — | `=1` para poder suscribirte a feeds de tu propia red. |

### Leerlo desde el celular

Poné una contraseña y publicá el puerto en la red. En `docker-compose.yml`:

```yaml
ports:
  - "8080:8080"
environment:
  UNRSS_PASSWORD: tuclave
```

Sin contraseña, el servidor se niega a arrancar fuera de loopback. Es a propósito por seguridad.

---

## Mantenimiento

```sh
node server.js prune 90            # borra artículos leídos de más de 90 días
node server.js import feeds.opml   # importa suscripciones de otro lector
node server.js export > feeds.opml # exporta las tuyas
```

En Docker, adelante va `docker compose exec unrsschiquito`. Desde la interfaz,
el menú "Más" en el pie del panel hace lo mismo: "Exportar OPML" baja el archivo
e "Importar OPML" te deja elegir uno del disco.

Backup: unrsschiquito.db

---

## Seguridad

Corriendo en tu casa el modelo de amenaza es corto pero no vacío:

- Escucha solo en 127.0.0.1 salvo que lo cambies, y fuera de loopback exige contraseña o un UNRSS_NO_AUTH=1 explícito.
- Header Host validado. Sin contraseña, solo atiende pedidos que vengan por localhost. Es la defensa contra DNS rebinding: una web cualquiera que resuelve su dominio a 127.0.0.1 para hablarle a tu servidor.
- Origin` validado en toda escritura: otra pestaña no puede borrarte feeds.
- Sin SSRF. El fetcher rechaza lo que resuelva a una IP privada o de loopback, valida cada salto de redirección por separado, y corta a los 5 MB o 12 segundos. `ALLOW_PRIVATE_HOSTS=1` lo abre solo si vos lo pedís.
- HTML de terceros pasa por un sanitizador con lista blanca de etiquetas y atributos antes de renderizarse.
- CSP `'self'` puro: la página no carga ni un byte de otro dominio (salvo las imágenes de los artículos).

---

## Atajos

En la lista:

| Tecla | Qué hace |
|---|---|
| `j` / `k` | siguiente / anterior |
| `Enter` o espacio | abrir el artículo |
| `o` | abrir el original en otra pestaña |
| `m` | marcar leído / no leído |
| `r` | actualizar la vista actual |

Leyendo una noticia:

| Tecla | Qué hace |
|---|---|
| `j` / `k` | saltar al siguiente / anterior sin volver |
| `o` | abrir el original |
| `r` | volver a bajar el feed de esa nota y repintarla |
| `m` | marcar leído / no leído |
| `Esc` | volver a la lista |

---

## Créditos

El sistema de íconos son de [Basicons](https://www.basicons.com/)

El favicon es el emoji 📰 (U+1F4F0) de [OpenMoji](https://openmoji.org), usado bajo licencia CC BY-SA 4.0 — esa licencia aplica al ícono, no al resto del proyecto. Los íconos de la interfaz son de [Basicons](https://basicons.com) (MIT).

El código es MIT. Ver [LICENSE](LICENSE).
