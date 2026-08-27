# Mi experiencia AR2

Experiencia de realidad aumentada creada con INRE.

**Modo:** World Effects (anclaje al suelo con SLAM)
**En vivo:** https://wilzamguerrero2.github.io/mi-experiencia-ar2/

---

## Cómo se publica

Cada `push` a `main` dispara `.github/workflows/deploy.yml`, que compila el
proyecto y lo publica en GitHub Pages. No hay que hacer nada más: **editar y guardar
desde INRE crea un commit, y el commit actualiza la experiencia.**

Si es la primera vez, activa Pages en *Settings → Pages → Source: GitHub Actions*.

## Cómo editarlo

**Desde el navegador**, con INRE: abre el editor, conecta tu cuenta de GitHub y elige
este repositorio.

**En tu ordenador**, con el 8th Wall Studio de escritorio: este es el formato oficial
de proyecto, así que se abre sin conversiones.

**A mano**, si prefieres:

```bash
npm install
npm run serve     # servidor de desarrollo
npm run build     # compila en dist/
```

## Publicarlo en otro sitio

`dist/` es un sitio estático corriente. Sirve tal cual en Cloudflare Pages, Vercel,
Netlify o cualquier hosting. Solo dos requisitos:

- **HTTPS**, porque la cámara exige contexto seguro.
- No bloquear `cdn.jsdelivr.net`, de donde se carga el motor.

## Estructura

```
src/.expanse.json     la escena: objetos, materiales, luces, componentes
src/index.html        página de entrada; carga el motor
src/*.ts              componentes propios
src/assets/           modelos, texturas, vídeo, audio
image-targets/        marcadores de imagen
config/               configuración de webpack (MIT, de 8th Wall)
```

## Licencias

El código de este proyecto es tuyo. El motor que usa, no:

- `@8thwall/ecs` 3.2.1 — MIT, © Niantic Spatial, Inc.
- `@8thwall/engine-binary` 1.0.0 — **XR Engine License Agreement**
- `@8thwall/landing-page` 1.0.0 — MIT

La XR Engine License prohíbe cobrar por un producto cuyo valor derive sustancialmente
de la funcionalidad del motor. Ver [NOTICE](./NOTICE).
