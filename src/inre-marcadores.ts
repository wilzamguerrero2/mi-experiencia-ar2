import marcador0 from '../image-targets/image_1786926390310.json'

/**
 * Carga los marcadores de imagen en el motor.
 *
 * Lo genera INRE: se reescribe en cada publicación a partir de los marcadores del
 * proyecto, así que editarlo a mano no sirve de nada.
 *
 * El `imagePath` de cada JSON es una ruta relativa, y el motor la usa tal cual como
 * `src` de una `<img>`. De ahí que funcione igual en la raíz de un dominio y en un
 * subdirectorio, y de ahí que `image-targets/` tenga que acabar dentro de `dist/`
 * —lo copia `CopyWebpackPlugin`, ver `config/webpack.config.js`—.
 */

/**
 * Lo único que se usa del motor, que `index.html` carga desde el CDN.
 *
 * `XrController` nace `null` y lo instala el fragmento `slam` del motor. Que aquí
 * ya esté puesto no es casualidad: `index.html` lo precarga con
 * `data-preload-chunks`, y el motor espera a tener listos los fragmentos
 * precargados antes de definir `XR8` y lanzar `xrloaded`.
 */
interface XrEngine {
  XrController: {
    configure: (options: {imageTargetData: unknown[]}) => void,
  } | null
}

const engine = (): XrEngine | undefined => (window as unknown as {XR8?: XrEngine}).XR8

const cargarMarcadores = () => {
  const xr = engine()

  // Solo salta si la escena pasa a una cámara que no carga `slam` —seguimiento
  // facial, por ejemplo—, y entonces los marcadores no pueden funcionar. Avisar es
  // mejor que reventar con un `null`, y mucho mejor que el silencio.
  if (xr === undefined || xr.XrController === null) {
    console.warn(
      '[INRE] Los marcadores de imagen necesitan una cámara de tipo World Effects. '
      + 'Con la cámara actual no se van a reconocer.'
    )
    return
  }

  xr.XrController.configure({
    imageTargetData: [marcador0],
  })
}

// `xrloaded` es el evento con el que el motor avisa de que `XR8` ya existe. Se
// comprueba antes por si se cargó primero: ese evento no se vuelve a lanzar, así que
// quedarse esperándolo dejaría los marcadores sin cargar para siempre.
if (engine() !== undefined) {
  cargarMarcadores()
} else {
  window.addEventListener('xrloaded', cargarMarcadores)
}
