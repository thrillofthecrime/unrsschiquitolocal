# un rss chiquito

Un lector RSS chiquito hosteable. No tiene funcionalidades raras, ni nada por el estilo.

No tiene dependencias, ni cuentas, ni servicios externos. Solo un servidor de node y un archivo sqlite.

## ¿Cómo correrlo?

Con Docker (experimental):
Esta opción no está tan testeada. Yo la corro directo con node.

```sh
docker compose up -d
```

Queda en http://localhost:8080 y la base en `./data/unrsschiquito.db`.

Con Node (22.5 o superior):

```sh
npm start
```

## Configuración

Todo va por variables de entorno y es opcional.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `PORT` | `8080` | Puerto (duh) |
| `HOST` | `127.0.0.1` | Dónde escuchar. |
| `UNRSS_DB` | `./unrsschiquito.db` | Ruta de la base. |
| `UNRSS_PASSWORD` | — | Pide contraseña (HTTP Basic, el usuario da igual). |
| `UNRSS_NO_AUTH` | — | `=1` para escuchar fuera de loopback sin contraseña. |
| `UNRSS_ALLOWED_HOSTS` | — | Hosts extra aceptados en el header `Host`, separados por coma. |
| `ALLOW_PRIVATE_HOSTS` | — | `=1` para suscribirte a feeds de tu propia red. |

Fuera de `127.0.0.1` el servidor no arranca si no hay `UNRSS_PASSWORD` o `UNRSS_NO_AUTH=1`. Para leerlo desde el celular, poné contraseña y publicá el puerto en la red.

## Consola

node server.js prune 90            # borra artículos leídos de más de 90 días
node server.js import feeds.opml   # importa suscripciones
node server.js export > feeds.opml # exporta las tuyas

## ¿Cómo está armado?

- `server.js` — HTTP: estáticos, API y comandos de consola.
- `lib/` — sqlite, fetch, parser XML propio, RSS/RDF/Atom, autodescubrimiento de feeds, OPML.
- `public/` — el cliente: un HTML, un CSS, dos JS.

El navegador solo habla con este servidor, el servidor es el único que toca la base y el único que sale a internet.

Sobre seguridad, para el que quiera mirar, escucha en loopback por defecto, valida el header `Host` y el `Origin` de toda escritura, el fetcher rechaza lo que resuelva a IP privada (revisando cada redirección) y corta a los 5 MB o 12s, el HTML de los artículos pasa por un sanitizador con lista blanca, y la CSP es `'self'` salvo imágenes.
No hay login ni usuarios: la contraseña, si la ponés, es una sola para todo.

## Créditos

Los íconos de la interfaz son de [Basicons](https://basicons.com) (MIT).
El favicon es el emoji 📰 de [OpenMoji](https://openmoji.org), CC BY-SA 4.0 — esa licencia aplica al ícono, no al resto.
El código es MIT, ver [LICENSE](LICENSE).

## Disclaimer
Este proyecto fue armado por una sola persona que no es del entorno de desarrollo. Claude hizo el código y un humano lo verificó en cuanto a funcionalidades, y realizó ajustes de interfaz, y algunas de lógica. Cualquier error de interfaz es humano, cualquier error de código no es mío.
