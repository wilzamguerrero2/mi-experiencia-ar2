import * as ecs from '@8thwall/ecs'

// Gira sobre su eje el objeto al que se le adjunte este componente.
ecs.registerComponent({
  name: 'mi-componente',
  schema: {
    velocidad: ecs.f32,
  },
  schemaDefaults: {
    velocidad: 1,
  },
  tick: (world, component) => {
    const angulo = world.time.elapsed / 1000 * component.schema.velocidad
    // Cuaternión de un giro sobre Y: (0, sin(θ/2), 0, cos(θ/2)).
    ecs.Quaternion.set(world, component.eid, {
      x: 0,
      y: Math.sin(angulo / 2),
      z: 0,
      w: Math.cos(angulo / 2),
    })
  },
})
