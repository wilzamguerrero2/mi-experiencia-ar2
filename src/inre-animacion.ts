import * as ecs from '@8thwall/ecs'

/**
 * Reproduce el timeline de INRE: keyframes, curvas, opacidad, visibilidad y los tramos
 * de clip de un modelo o de un video.
 *
 * Lo genera INRE: se reescribe en cada publicacion, asi que editarlo a mano no sirve de
 * nada. La matematica es la misma que la del editor (packages/scene/src/animation.ts).
 *
 * Cada objeto animado lleva su copia con sus pistas. Las pistas hablan del pivote del
 * objeto, no de su centro, y la conversion se hace aqui al final de cada fotograma:
 * posicion guardada = posicion del pivote - R (S p).
 */

const GRADOS = Math.PI / 180

// --- La curva de un tramo, con la forma de cubic-bezier de CSS ---

const acotar = (valor: number): number => Math.min(1, Math.max(0, valor))

const bezier = (a: number, b: number, t: number): number => {
  const inverso = 1 - t
  return 3 * inverso * inverso * t * a + 3 * inverso * t * t * b + t * t * t
}

const pendiente = (a: number, b: number, t: number): number => {
  const inverso = 1 - t
  return 3 * inverso * inverso * a + 6 * inverso * t * (b - a) + 3 * t * t * (1 - b)
}

const suavizado = (fraccion: number, sale: number[], entra: number[]): number => {
  const t = acotar(fraccion)
  if (t === 0 || t === 1) {
    return t
  }

  const x1 = acotar(sale[0])
  const x2 = acotar(entra[0])

  let tanteo = t
  for (let paso = 0; paso < 8; paso += 1) {
    const error = bezier(x1, x2, tanteo) - t
    if (Math.abs(error) < 1e-6) {
      return bezier(sale[1], entra[1], tanteo)
    }
    const m = pendiente(x1, x2, tanteo)
    if (Math.abs(m) < 1e-6) {
      break
    }
    tanteo -= error / m
  }

  // Newton se atasca donde la curva se pone plana: se remata por biseccion.
  let bajo = 0
  let alto = 1
  for (let paso = 0; paso < 24; paso += 1) {
    tanteo = (bajo + alto) / 2
    if (bezier(x1, x2, tanteo) < t) {
      bajo = tanteo
    } else {
      alto = tanteo
    }
  }
  return bezier(sale[1], entra[1], tanteo)
}

const SALE = [0.42, 0]
const ENTRA = [0.58, 1]

/**
 * El valor de una pista en un instante, o null si la pista esta vacia.
 *
 * Fuera de los keyframes el valor se mantiene: antes del primero vale el primero y
 * despues del ultimo vale el ultimo, que es lo que hace After Effects.
 */
const leerPista = (claves: any[], tiempo: number): number | null => {
  if (claves == null || claves.length === 0) {
    return null
  }
  if (claves.length === 1 || tiempo <= claves[0].time) {
    return claves[0].value
  }

  const ultima = claves[claves.length - 1]
  if (tiempo >= ultima.time) {
    return ultima.value
  }

  let indice = 0
  while (indice < claves.length - 1 && claves[indice + 1].time <= tiempo) {
    indice += 1
  }

  const desde = claves[indice]
  const hasta = claves[indice + 1]
  const tramo = hasta.time - desde.time
  if (tramo <= 0) {
    return hasta.value
  }

  const fraccion = (tiempo - desde.time) / tramo
  const curva = desde.ease || 'linear'

  if (curva === 'hold') {
    return desde.value
  }

  const t = curva === 'bezier'
    ? suavizado(fraccion, desde.out || SALE, hasta.in || ENTRA)
    : fraccion

  return desde.value + (hasta.value - desde.value) * t
}

// --- Composicion ---

/** Grados de Euler en orden YXZ a cuaternion, como en el editor y como en el motor. */
const aCuaternion = (x: number, y: number, z: number) => {
  const mx = x * GRADOS * 0.5
  const my = y * GRADOS * 0.5
  const mz = z * GRADOS * 0.5

  const cx = Math.cos(mx)
  const sx = Math.sin(mx)
  const cy = Math.cos(my)
  const sy = Math.sin(my)
  const cz = Math.cos(mz)
  const sz = Math.sin(mz)

  return {
    x: cy * sx * cz + sy * cx * sz,
    y: sy * cx * cz - cy * sx * sz,
    z: cy * cx * sz - sy * sx * cz,
    w: cy * cx * cz + sy * sx * sz,
  }
}

/** Cuaternion a grados de Euler YXZ, con el polo bloqueado para no devolver NaN. */
const aEuler = (q: any) => {
  const senoX = 2 * (q.w * q.x - q.y * q.z)
  const acotado = Math.min(1, Math.max(-1, senoX))
  const rx = Math.asin(acotado)

  if (Math.abs(acotado) > 0.9999) {
    return [rx / GRADOS, Math.atan2(q.y, q.w) * 2 / GRADOS, 0]
  }

  const ry = Math.atan2(
    2 * (q.w * q.y + q.x * q.z),
    1 - 2 * (q.x * q.x + q.y * q.y)
  )
  const rz = Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.x * q.x + q.z * q.z)
  )
  return [rx / GRADOS, ry / GRADOS, rz / GRADOS]
}

/** Gira un vector por un cuaternion. */
const girar = (v: number[], q: any): number[] => {
  const ix = q.w * v[0] + q.y * v[2] - q.z * v[1]
  const iy = q.w * v[1] + q.z * v[0] - q.x * v[2]
  const iz = q.w * v[2] + q.x * v[1] - q.y * v[0]
  const iw = -q.x * v[0] - q.y * v[1] - q.z * v[2]

  return [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ]
}

/** El desplazamiento del pivote una vez girado y escalado. */
const desplazamiento = (pivote: number[], q: any, escala: number[]): number[] =>
  girar([pivote[0] * escala[0], pivote[1] * escala[1], pivote[2] * escala[2]], q)

// --- Estado por entidad ---

/**
 * Lo que no cabe en el esquema: las pistas ya parseadas y la transformacion de partida.
 *
 * El esquema del motor solo guarda numeros, textos y booleanos, asi que las pistas
 * llegan como JSON y se parsean una vez. La firma es el propio texto: si INRE republica
 * con otras pistas, cambia y se vuelve a parsear.
 *
 * El identificador de entidad es ecs.Eid, que es un bigint. Anotarlo como number
 * compila en INRE —el mundo y el esquema van sin tipos— y rompe el build de este
 * proyecto, donde ecs.Position.get y compania piden el tipo de verdad.
 */
const estados = new Map<ecs.Eid, any>()

const estadoDe = (world: any, eid: ecs.Eid, esquema: any) => {
  const previo = estados.get(eid)
  const firma = esquema.pistas + '|' + esquema.tramos

  if (previo != null && previo.firma === firma) {
    return previo
  }

  let pistas: any[] = []
  let tramos: any[] = []
  try {
    pistas = JSON.parse(esquema.pistas || '[]')
    tramos = JSON.parse(esquema.tramos || '[]')
  } catch (error) {
    pistas = []
    tramos = []
  }

  const canales: any = {}
  for (const pista of pistas) {
    if (pista != null && typeof pista.property === 'string') {
      canales[pista.property] = pista.keys || []
    }
  }

  /*
   * La transformacion de partida se lee del mundo, no del esquema: es la que el motor
   * acaba de aplicar desde la escena, y es la que rellena los canales sin animar. Se
   * lee **antes** de escribir nada, y por eso se hace en el primer tick y no se vuelve
   * a hacer: leerla despues devolveria lo que escribio el fotograma anterior.
   */
  const posicion = ecs.Position.get(world, eid)
  const rotacion = ecs.Quaternion.get(world, eid)
  const escala = ecs.Scale.get(world, eid)

  const base = {
    posicion: [posicion.x, posicion.y, posicion.z],
    rotacion: {x: rotacion.x, y: rotacion.y, z: rotacion.z, w: rotacion.w},
    escala: [escala.x, escala.y, escala.z],
  }

  const estado = {
    firma,
    canales,
    tramos,
    base,
    euler: aEuler(base.rotacion),
    // Ultimo tramo de medio aplicado, para no reescribirlo cada fotograma.
    clip: null as string | null,
    inicio: world.time.elapsed,
  }
  estados.set(eid, estado)
  return estado
}

// --- Aplicacion ---

/** Los cuatro tipos de material del formato. El objeto lleva uno, o ninguno. */
const MATERIALES = [ecs.Material, ecs.UnlitMaterial, ecs.VideoMaterial, ecs.ShadowMaterial]

const aplicarOpacidad = (world: any, eid: ecs.Eid, valor: number) => {
  for (const material of MATERIALES) {
    if (material.has(world, eid)) {
      material.mutate(world, eid, (c: any) => {
        c.opacity = valor
        // Sin esto three no dibuja la transparencia: el material se compila opaco.
        if (c.forceTransparent !== undefined) {
          c.forceTransparent = valor < 0.999
        }
      })
      return
    }
  }
}

/**
 * Enciende o apaga el objeto.
 *
 * Un objeto anclado a un marcador **no** se toca: su visibilidad la lleva el sistema de
 * marcadores, que lo esconde mientras la imagen no se reconoce, y pelearse con el
 * dejaria el contenido a la vista sobre nada.
 */
const aplicarVisible = (world: any, eid: ecs.Eid, visible: boolean) => {
  if (ecs.ImageTarget.has(world, eid)) {
    return
  }
  if (visible) {
    if (ecs.Hidden.has(world, eid)) {
      ecs.Hidden.remove(world, eid)
    }
  } else if (!ecs.Hidden.has(world, eid)) {
    ecs.Hidden.set(world, eid)
  }
}

/**
 * Arranca, pausa o cambia el clip de un modelo, o el video del objeto.
 *
 * Se escribe solo en el cambio de tramo. El motor ya lleva la cuenta del tiempo del clip
 * a partir de ahi (gltf-system.ts), y reescribirle el tiempo cada fotograma lo obligaria
 * a rebobinar el mezclador sesenta veces por segundo.
 */
const aplicarTramo = (world: any, eid: ecs.Eid, estado: any, tramo: any) => {
  const clip = tramo == null ? null : tramo.clip
  if (estado.clip === clip) {
    return
  }
  estado.clip = clip

  const esVideo = clip === ''

  if (ecs.GltfModel.has(world, eid) && !esVideo) {
    ecs.GltfModel.mutate(world, eid, (c: any) => {
      if (tramo == null) {
        c.paused = true
        return
      }
      c.animationClip = clip
      c.loop = tramo.loop === true
      c.timeScale = typeof tramo.speed === 'number' && tramo.speed > 0 ? tramo.speed : 1
      c.time = 0
      c.paused = false
    })
  }

  if (ecs.VideoControls.has(world, eid)) {
    ecs.VideoControls.mutate(world, eid, (c: any) => {
      if (tramo == null) {
        c.paused = true
        return
      }
      c.loop = tramo.loop === true
      c.speed = typeof tramo.speed === 'number' && tramo.speed > 0 ? tramo.speed : 1
      c.paused = false
    })
  }
}

const tramoEn = (tramos: any[], tiempo: number) => {
  for (const tramo of tramos) {
    if (tiempo >= tramo.start && tiempo < tramo.start + tramo.duration) {
      return tramo
    }
  }
  return null
}

/** Donde acaba lo ultimo que hay puesto: ningun keyframe queda fuera de alcance. */
const finDelContenido = (estado: any): number => {
  let fin = 0
  for (const property in estado.canales) {
    const claves = estado.canales[property]
    const ultima = claves[claves.length - 1]
    if (ultima != null && ultima.time > fin) {
      fin = ultima.time
    }
  }
  for (const tramo of estado.tramos) {
    fin = Math.max(fin, tramo.start + tramo.duration)
  }
  return fin
}

ecs.registerComponent({
  name: 'inre-animacion',
  schema: {
    pistas: ecs.string,
    tramos: ecs.string,
    duracion: ecs.f32,
    bucle: ecs.boolean,
    autoplay: ecs.boolean,
    velocidad: ecs.f32,
    pivoteX: ecs.f32,
    pivoteY: ecs.f32,
    pivoteZ: ecs.f32,
  },
  schemaDefaults: {
    pistas: '[]',
    tramos: '[]',
    duracion: 5,
    bucle: true,
    autoplay: true,
    velocidad: 1,
    pivoteX: 0,
    pivoteY: 0,
    pivoteZ: 0,
  },

  remove: (world, component) => {
    estados.delete(component.eid)
  },

  tick: (world, component) => {
    const esquema: any = component.schema
    const eid = component.eid
    const estado = estadoDe(world, eid, esquema)

    if (!esquema.autoplay) {
      return
    }

    const velocidad = esquema.velocidad > 0 ? esquema.velocidad : 1
    const duracion = Math.max(0.1, esquema.duracion, finDelContenido(estado))
    const corrido = (world.time.elapsed - estado.inicio) / 1000 * velocidad

    const tiempo = esquema.bucle
      ? ((corrido % duracion) + duracion) % duracion
      : Math.min(corrido, duracion)

    const canales = estado.canales
    const base = estado.base

    const pivote = [
      esquema.pivoteX,
      esquema.pivoteY,
      esquema.pivoteZ,
    ]

    // El respaldo de las pistas de posicion es el pivote, no el centro: es de lo que
    // hablan los keyframes. Sin este paso, animar solo una de las tres coordenadas
    // moveria el objeto en las otras dos.
    const centroAlPivote = desplazamiento(pivote, base.rotacion, base.escala)
    const basePivote = [
      base.posicion[0] + centroAlPivote[0],
      base.posicion[1] + centroAlPivote[1],
      base.posicion[2] + centroAlPivote[2],
    ]

    const leer = (property: string, respaldo: number) => {
      const claves = canales[property]
      if (claves === undefined) {
        return {valor: respaldo, hay: false}
      }
      const valor = leerPista(claves, tiempo)
      return valor === null ? {valor: respaldo, hay: false} : {valor, hay: true}
    }

    const px = leer('position.x', basePivote[0])
    const py = leer('position.y', basePivote[1])
    const pz = leer('position.z', basePivote[2])
    const rx = leer('rotation.x', estado.euler[0])
    const ry = leer('rotation.y', estado.euler[1])
    const rz = leer('rotation.z', estado.euler[2])
    const sx = leer('scale.x', base.escala[0])
    const sy = leer('scale.y', base.escala[1])
    const sz = leer('scale.z', base.escala[2])

    const gira = rx.hay || ry.hay || rz.hay
    const escala2 = sx.hay || sy.hay || sz.hay
    const mueve = px.hay || py.hay || pz.hay

    const rotacion = gira ? aCuaternion(rx.valor, ry.valor, rz.valor) : base.rotacion
    const escala = escala2 ? [sx.valor, sy.valor, sz.valor] : base.escala

    if (gira || escala2 || mueve) {
      // Del pivote al centro, que es lo que el motor entiende. El orden importa: hace
      // falta la rotacion y la escala **de este instante**, no las de la escena.
      const vuelta = desplazamiento(pivote, rotacion, escala)
      ecs.Position.set(world, eid, {
        x: px.valor - vuelta[0],
        y: py.valor - vuelta[1],
        z: pz.valor - vuelta[2],
      })
    }

    if (gira) {
      ecs.Quaternion.set(world, eid, rotacion)
    }

    if (escala2) {
      ecs.Scale.set(world, eid, {x: escala[0], y: escala[1], z: escala[2]})
    }

    const opacidad = canales['opacity'] === undefined
      ? null
      : leerPista(canales['opacity'], tiempo)
    if (opacidad !== null) {
      aplicarOpacidad(world, eid, opacidad)
    }

    const visible = canales['visible'] === undefined
      ? null
      : leerPista(canales['visible'], tiempo)
    if (visible !== null) {
      aplicarVisible(world, eid, visible >= 0.5)
    }

    if (estado.tramos.length > 0) {
      aplicarTramo(world, eid, estado, tramoEn(estado.tramos, tiempo))
    }
  },
})
