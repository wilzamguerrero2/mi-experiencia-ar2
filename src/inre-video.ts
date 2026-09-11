import * as ecs from '@8thwall/ecs'

/**
 * Le devuelve al material de vídeo lo que el componente del motor no sabe decir:
 * transparencia real, cara visible, profundidad y modo de mezcla.
 *
 * Lo genera INRE: se reescribe en cada publicación, así que editarlo a mano no sirve de
 * nada.
 *
 * El sistema de vídeo del motor decide la transparencia con «transparent = opacity < 1»,
 * y eso deja los WebM con canal alfa dentro de un rectángulo negro. Aquí se corrige
 * escribiendo sobre el material que ese mismo sistema construye.
 */

/*
 * Las constantes de three, por número.
 *
 * El componente no puede importar three: en el proyecto publicado three vive dentro del
 * paquete del motor y no se expone. Estos son los valores de sus enums, que no han
 * cambiado en toda la vida de la librería; escribirlos aquí es lo que permite tocar el
 * material sin tener el módulo delante.
 */
const LADOS: any = {front: 0, back: 1, double: 2}
const MEZCLAS: any = {no: 0, normal: 1, additive: 2, subtractive: 3, multiply: 4}

/**
 * Solo se escribe sobre el material que construyó el sistema de vídeo del motor.
 *
 * Lo marca con «userData.video», así que un objeto cuyo material todavía no se ha creado
 * —o que dejó de ser de vídeo— se salta en vez de recibir propiedades que no le tocan.
 */
const esDelMotor = (material: any): boolean =>
  material != null && material.userData != null && material.userData.video === true

/*
 * El alfa del vídeo, que la subida directa a la GPU tira por el camino.
 *
 * three sube el <video> con «texImage2D(..., video)», y esa ruta del navegador entrega
 * el fotograma ya compuesto en RGB: el canal alfa se ha usado para mezclar contra negro
 * y se ha perdido. Por eso un WebM recortado sale dentro de un rectángulo negro aunque
 * el material esté en «transparent: true».
 *
 * El lienzo 2D sí lo conserva: «drawImage» sobre un lienzo recién limpiado deja
 * translúcido lo que era translúcido. Así que se cambia la imagen de la textura por un
 * lienzo y se repinta fotograma a fotograma.
 */
const conectarLienzo = (textura: any): void => {
  if (textura == null) {
    return
  }

  const video = textura.image
  if (!(video instanceof HTMLVideoElement)) {
    // O ya se cambió por el lienzo, o la textura todavía no tiene imagen.
    return
  }

  const contexto = document.createElement('canvas').getContext('2d', {alpha: true})
  if (contexto == null) {
    return
  }

  const lienzo = contexto.canvas
  let vivo = true

  const pintar = () => {
    const ancho = video.videoWidth
    const alto = video.videoHeight
    if (ancho === 0 || alto === 0) {
      return
    }

    if (lienzo.width !== ancho || lienzo.height !== alto) {
      lienzo.width = ancho
      lienzo.height = alto
    }

    // Limpiar antes de dibujar: sin esto el fotograma anterior se queda debajo y asoma
    // por las zonas transparentes del nuevo.
    contexto.clearRect(0, 0, ancho, alto)
    contexto.drawImage(video, 0, 0, ancho, alto)
    textura.needsUpdate = true
  }

  const programar = () => {
    if (!vivo) {
      return
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      // Avisa cuando el navegador presenta un fotograma nuevo: ni uno de más ni uno de
      // menos, y también al buscar con el vídeo parado.
      video.requestVideoFrameCallback(() => {
        pintar()
        programar()
      })
      return
    }
    requestAnimationFrame(() => {
      pintar()
      programar()
    })
  }

  /*
   * El motor desmonta el vídeo a través de «texture.image» —«deleteVideoTexture» le pide
   * pause, removeAttribute('src') y load—, y ahí ya no encontraría un <video>. Estos tres
   * métodos son ese trozo de interfaz, reenviado al vídeo de verdad; sin ellos, cerrar
   * una escena con vídeo lanzaría un error y el archivo se quedaría descodificando.
   *
   * Quitar el «src» es además la señal de que esto se acabó: es lo que para el bucle.
   */
  const conMetodos = lienzo as any
  conMetodos.pause = () => video.pause()
  conMetodos.load = () => video.load()
  conMetodos.removeAttribute = (nombre: string) => {
    if (nombre === 'src') {
      vivo = false
    }
    video.removeAttribute(nombre)
  }

  textura.image = lienzo

  // El primer fotograma y cada búsqueda, a mano: un vídeo en pausa no presenta
  // fotogramas, y sin esto el plano se quedaría vacío hasta que alguien lo arrancara.
  video.addEventListener('loadeddata', pintar)
  video.addEventListener('seeked', pintar)
  pintar()
  programar()
}

ecs.registerComponent({
  name: 'inre-video',
  schema: {
    forceTransparent: ecs.boolean,
    side: ecs.string,
    depthTest: ecs.boolean,
    depthWrite: ecs.boolean,
    blending: ecs.string,
    alphaTest: ecs.f32,
  },
  schemaDefaults: {
    forceTransparent: false,
    side: 'front',
    depthTest: true,
    depthWrite: true,
    blending: 'normal',
    alphaTest: 0,
  },

  /*
   * Se comprueba cada fotograma comparando con lo que el material tiene puesto, y no
   * con una firma de la última escritura.
   *
   * Es a propósito: el sistema de vídeo del motor vuelve a configurar el material cada
   * vez que su componente cambia —y ahí reescribe «transparent»—, así que recordar que
   * ya se aplicó dejaría el vídeo opaco a partir del primer cambio. Comparar cuesta
   * cuatro igualdades por fotograma y se paga solo.
   */
  tick: (world, component) => {
    const objeto: any = world.three.entityToObject.get(component.eid)
    if (objeto == null) {
      return
    }

    const material = objeto.material
    if (!esDelMotor(material)) {
      return
    }

    const s = component.schema
    let recompilar = false

    /*
     * La transparencia solo se enciende, nunca se apaga: con opacidad < 1 el motor ya la
     * puso, y apagarla aquí porque nadie marcó la casilla dejaría opaco un vídeo que se
     * está desvaneciendo.
     */
    if (s.forceTransparent && material.transparent !== true) {
      material.transparent = true
      recompilar = true
    }

    /*
     * Poner «transparent» no basta por si solo: la textura que sube el motor no tiene
     * alfa que respetar. El lienzo se lo devuelve.
     *
     * Se hace aqui y no al entrar el componente porque la textura llega mas tarde que el
     * material, y porque el motor la reemplaza entera si cambia el vídeo. La comprobación
     * cuesta una lectura por fotograma y se salta sola en cuanto la imagen ya es lienzo.
     */
    if (s.forceTransparent) {
      conectarLienzo(material.map)
    }

    /*
     * El recorte, que es lo unico que hace que la sombra siga al alfa.
     *
     * El mapa de sombras no se dibuja con este material sino con uno de profundidad, que
     * no mezcla nada: sin recorte, un video transparente proyecta su rectangulo entero
     * por muy transparente que sea. three copia «map» y «alphaTest» a ese material de
     * profundidad —getDepthMaterial, en WebGLShadowMap— y ahi el pixel descartado deja
     * de proyectar sombra.
     *
     * Va escalado por la opacidad porque three compara contra «opacity × alfa del mapa»:
     * con un umbral fijo, un objeto que el timeline esta fundiendo desapareceria de golpe
     * al bajar del umbral. Escalado, el recorte parte el mapa por el mismo sitio a
     * cualquier opacidad.
     *
     * Cambiarlo recompila: cruzar el cero enciende o apaga la define USE_ALPHATEST del
     * sombreador, asi que no basta con escribir el numero.
     */
    const recorte = s.alphaTest * (typeof material.opacity === 'number' ? material.opacity : 1)
    if (material.alphaTest !== recorte) {
      material.alphaTest = recorte
      recompilar = true
    }

    const lado = LADOS[s.side]
    if (lado !== undefined && material.side !== lado) {
      material.side = lado
      recompilar = true
    }

    const mezcla = MEZCLAS[s.blending]
    if (mezcla !== undefined && material.blending !== mezcla) {
      material.blending = mezcla
      recompilar = true
    }

    // Estos dos son estado del renderer, no del programa: cambian sin recompilar.
    if (material.depthTest !== s.depthTest) {
      material.depthTest = s.depthTest
    }
    if (material.depthWrite !== s.depthWrite) {
      material.depthWrite = s.depthWrite
    }

    if (recompilar) {
      material.needsUpdate = true
    }
  },
})
