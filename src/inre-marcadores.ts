import marcador0 from '../image-targets/6d9f23c2-9bf0-4685-99a0-e58af5fa8f52.json'
import marcador1 from '../image-targets/484476706_17964555110897215_2654202986601727457_n.json'

/**
 * Carga los marcadores de imagen en el motor, y se queda vigilando que sigan puestos.
 *
 * Lo genera INRE: se reescribe en cada publicación a partir de los marcadores del
 * proyecto, así que editarlo a mano no sirve de nada.
 *
 * El `imagePath` de cada JSON es una ruta relativa, y el motor la usa tal cual como
 * `src` de una `<img>`. De ahí que funcione igual en la raíz de un dominio y en un
 * subdirectorio, y de ahí que `image-targets/` tenga que acabar dentro de `dist/`
 * —lo copia `CopyWebpackPlugin`, ver `config/webpack.config.js`—.
 *
 * Configurar una vez al arrancar **no basta**. El motor solo aplica los marcadores
 * configurados en un punto concreto de su ciclo de vida —cuando termina de cargar los
 * recursos de la sesión de cámara— y al reiniciarse esa sesión olvida los que tenía
 * cargados sin volver a pedirlos. Cualquier cosa que reinicie la tubería de cámara
 * deja entonces la escena corriendo, la cámara abierta y el marcador sin reconocer
 * nunca más. Por eso este archivo no se limita a llamar a `configure`: registra un
 * módulo en la tubería que los vuelve a poner en cada arranque de sesión.
 */

/**
 * Lo que se usa del motor, que `index.html` carga desde el CDN.
 *
 * `XrController` nace `null` y lo instala el fragmento `slam` del motor. Que aquí ya
 * esté puesto no es casualidad: `index.html` lo precarga con `data-preload-chunks`, y
 * el motor espera a tener listos los fragmentos precargados antes de definir `XR8` y
 * lanzar `xrloaded`.
 */
interface XrEngine {
  XrController: {
    configure: (options: {imageTargetData: unknown[]}) => void,
  } | null
  /** Vía de escape cuando `slam` no venía precargado. */
  loadChunk?: (name: string) => Promise<void>
  addCameraPipelineModule?: (module: {
    name: string,
    listeners?: {event: string, process: (event: {name: string, detail: unknown}) => void}[],
    onCameraStatusChange?: (event: {status: string, reason?: string}) => void,
    onAppResourcesLoaded?: (event: unknown) => void,
  }) => void
}

const engine = (): XrEngine | undefined => (window as unknown as {XR8?: XrEngine}).XR8

const marcadores: unknown[] = [marcador0, marcador1]

/**
 * Los que el navegador ha conseguido cargar. Es la lista que ve el motor: uno cuya
 * imagen no llega cuelga la carga de todos los demás (ver `soloLosQueCargan`).
 */
let activos: unknown[] = marcadores

const nombres = (detail: unknown): string => {
  const lista = (detail as {imageTargets?: {name?: string}[]}).imageTargets ?? []
  return lista.map(target => target.name ?? '?').join(', ') || 'ninguno'
}

const nombre = (detail: unknown): string => (detail as {name?: string}).name ?? '?'

let vigilando = false

/**
 * Engancha el módulo que mantiene los marcadores puestos, y de paso cuenta en consola
 * en qué punto va el motor.
 *
 * El aviso importante es el de la cámara sin vídeo: el motor solo reconoce imágenes en
 * una sesión que le entregue textura de cámara, y cuando no consigue ninguna se cae a
 * su vista 3D de escritorio sin decir nada. Ahí los marcadores no pueden funcionar, y
 * la escena se ve igual que si todo fuera bien —el contenido de un marcador está
 * oculto hasta que se lo reconoce—, así que sin este aviso no hay forma de notarlo.
 */
const vigilarMotor = (xr: XrEngine) => {
  if (vigilando || xr.addCameraPipelineModule === undefined) {
    return
  }
  vigilando = true

  xr.addCameraPipelineModule({
    name: 'inre-marcadores',
    listeners: [
      {
        event: 'reality.imageloading',
        process: ({detail}) => console.log(`[INRE] Procesando marcador(es): ${nombres(detail)}.`),
      },
      {
        event: 'reality.imagescanning',
        process: ({detail}) => console.log(`[INRE] Buscando en la cámara: ${nombres(detail)}.`),
      },
      {
        event: 'reality.imagefound',
        process: ({detail}) => console.log(`[INRE] Marcador reconocido: ${nombre(detail)}.`),
      },
      {
        event: 'reality.imagelost',
        process: ({detail}) => console.log(`[INRE] Marcador perdido: ${nombre(detail)}.`),
      },
    ],

    onCameraStatusChange: ({status, reason}) => {
      if (status === 'failed') {
        console.warn(
          `[INRE] El navegador no dio la cámara (${reason ?? 'motivo desconocido'}). `
          + 'Sin cámara no hay marcador que reconocer.'
        )
        return
      }
      if (status === 'hasDesktop3D') {
        console.warn(
          '[INRE] El motor arrancó sin cámara, en su vista 3D de escritorio. En ella '
          + 'los marcadores de imagen no funcionan: no hay imagen que analizar.'
        )
      }
    },

    /*
     * Aquí es donde el motor aplica los marcadores que tenga configurados, y lo hace
     * una sola vez por sesión de cámara. Volver a configurarlos justo antes deja los
     * datos puestos en el momento exacto en que va a leerlos, en el primer arranque y
     * en todos los siguientes.
     */
    onAppResourcesLoaded: () => {
      const controller = engine()?.XrController
      if (controller === undefined || controller === null) {
        return
      }
      controller.configure({imageTargetData: activos})
    },
  })
}

/**
 * Deja pasar solo los marcadores cuya imagen el navegador consigue cargar.
 *
 * Filtra en lugar de avisar porque el motor no sobrevive a uno roto: su cargador hace
 * `loadRemoteImageUrl(...).then(...)` **sin `catch`**, así que un 404 o un PNG
 * corrupto deja su hueco en la cola para siempre y con él se cuelgan todos los demás
 * marcadores, girando en un `requestAnimationFrame` por fotograma. Un archivo que no
 * llegó al despliegue apagaría el reconocimiento entero sin decir nada.
 *
 * Se carga cada imagen igual que lo hace el motor —misma etiqueta, mismo
 * `crossorigin`—, así que lo que pase aquí es lo que le habría pasado a él.
 */
const soloLosQueCargan = async (lista: unknown[]): Promise<unknown[]> => {
  const cargar = (url: string) => new Promise<void>((resolve, reject) => {
    const img = document.createElement('img')
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(url))
    img.setAttribute('crossorigin', 'anonymous')
    img.setAttribute('src', url)
  })

  const validos: unknown[] = []

  for (const marcador of lista) {
    const {imagePath, name} = marcador as {imagePath?: string, name?: string}

    if (imagePath === undefined) {
      continue
    }

    try {
      await cargar(imagePath)
      validos.push(marcador)
    } catch {
      console.warn(
        `[INRE] El marcador «${name ?? '?'}» no pudo cargar su imagen (${imagePath}), `
        + 'así que se queda fuera. Si se le pasara al motor, este se colgaría cargando '
        + 'marcadores y no reconocería ninguno.'
      )
    }
  }

  return validos
}

const cargarMarcadores = async () => {
  const xr = engine()

  if (xr === undefined) {
    console.warn('[INRE] El motor AR no llegó a cargarse: los marcadores no se van a reconocer.')
    return
  }

  // `XrController` lo instala el fragmento `slam`. Si la cámara de la escena no lo
  // pidió por `data-preload-chunks`, se intenta traer aquí antes de rendirse.
  if (xr.XrController === null && xr.loadChunk !== undefined) {
    try {
      await xr.loadChunk('slam')
    } catch {
      // El motivo da igual: el aviso de abajo lo cuenta de todos modos.
    }
  }

  // Antes de la comprobación: aunque los marcadores no puedan cargarse, el estado de
  // la cámara sigue siendo lo único que explica por qué.
  vigilarMotor(xr)

  if (xr.XrController === null) {
    console.warn(
      '[INRE] Los marcadores de imagen necesitan una cámara de tipo World Effects. '
      + 'Con la cámara actual no se van a reconocer.'
    )
    return
  }

  activos = await soloLosQueCargan(marcadores)

  if (activos.length === 0) {
    console.warn('[INRE] Ningún marcador pudo cargar su imagen: no se va a reconocer ninguno.')
    return
  }

  xr.XrController.configure({imageTargetData: activos})
}

// `xrloaded` es el evento con el que el motor avisa de que `XR8` ya existe. Se
// comprueba antes por si se cargó primero: ese evento no se vuelve a lanzar, así que
// quedarse esperándolo dejaría los marcadores sin cargar para siempre.
if (engine() !== undefined) {
  void cargarMarcadores()
} else {
  window.addEventListener('xrloaded', () => {
    void cargarMarcadores()
  })
}
