/**
 * Furniture from `floor.json`'s declarative layout (task 4.6): desks with
 * chairs, the lounge, the kitchen coffee machine, the meeting-room
 * delegation screen (`televisionModern` — the kit ships no whiteboard,
 * creative brief), and the teddy bear. `minY=0` placement per `world-scale.md`
 * — no vertical offset needed for any prop.
 *
 * Desks/chairs/kitchen/bear each mix multiple named sub-meshes internally
 * (e.g. `desk` + `drawer`, `kitchenCoffeeMachine` + `mug`), so they render
 * as cloned `<primitive>` scene graphs rather than drei's single-geometry
 * `<Instances>` — correctness over micro-instancing at these low counts
 * (a dozen desks, one coffee machine); `Floor.tsx` already instances the
 * two high-count single-mesh props (floor tiles, walls).
 */
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { propGlbUrl } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';

/** Desk surface height, per `openspec/research/world-scale.md`. */
const DESK_SURFACE_HEIGHT = 0.38;

function PropInstance({ name, position, rotationY = 0 }: { name: string; position: [number, number, number]; rotationY?: number }): JSX.Element {
  const gltf = useGLTF(propGlbUrl(name));
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as Object3D, [gltf.scene]);
  return <primitive object={cloned} position={position} rotation={[0, rotationY, 0]} />;
}

export interface PropsProps {
  layout: FloorLayout;
}

export function Props({ layout }: PropsProps): JSX.Element {
  return (
    <group>
      {layout.desks.map((desk) => (
        <group key={desk.id}>
          <PropInstance name="desk" position={[desk.cell[0] + 0.5, 0, desk.cell[1] + 0.5]} rotationY={desk.seat.facingRad + Math.PI} />
          <PropInstance
            name="chairDesk"
            position={[desk.seat.position.x, 0, desk.seat.position.z]}
            rotationY={desk.seat.facingRad}
          />
          {/* A bare table does not read as somebody's workstation. */}
          <PropInstance
            name="computerScreen"
            position={[desk.cell[0] + 0.5, DESK_SURFACE_HEIGHT, desk.cell[1] + 0.5]}
            rotationY={desk.seat.facingRad + Math.PI}
          />
          <PropInstance
            name="computerKeyboard"
            position={[
              desk.cell[0] + 0.5 + Math.sin(desk.seat.facingRad) * -0.18,
              DESK_SURFACE_HEIGHT,
              desk.cell[1] + 0.5 + Math.cos(desk.seat.facingRad) * -0.18,
            ]}
            rotationY={desk.seat.facingRad + Math.PI}
          />
        </group>
      ))}
      {layout.loungeSeats.map((seat, i) => (
        <PropInstance key={i} name="loungeSofa" position={[seat.position.x, 0, seat.position.z]} rotationY={seat.facingRad} />
      ))}
      <PropInstance
        name="kitchenCoffeeMachine"
        position={[layout.kitchenCoffeeMachineCell[0] + 0.5, 0, layout.kitchenCoffeeMachineCell[1] + 0.5]}
      />
      <PropInstance
        name="televisionModern"
        position={[layout.meetingRoomScreenCell[0] + 0.5, 0, layout.meetingRoomScreenCell[1] + 0.5]}
      />
      <PropInstance name="bear" position={[layout.bearCell[0] + 0.5, 0, layout.bearCell[1] + 0.5]} />
      {(layout.decor ?? []).map((item) => (
        <PropInstance
          key={`${item.prop}-${item.cell[0]}-${item.cell[1]}`}
          name={item.prop}
          position={[item.cell[0] + 0.5, 0, item.cell[1] + 0.5]}
        />
      ))}
    </group>
  );
}
