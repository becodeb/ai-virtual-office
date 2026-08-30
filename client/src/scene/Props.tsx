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
import * as THREE from 'three';
import type { Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { propGlbUrl } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { footprintOffset } from './propCentering.js';

/** Desk surface height, per `openspec/research/world-scale.md`. */
const DESK_SURFACE_HEIGHT = 0.38;

function PropInstance({ name, position, rotationY = 0 }: { name: string; position: [number, number, number]; rotationY?: number }): JSX.Element {
  const gltf = useGLTF(propGlbUrl(name));
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as Object3D, [gltf.scene]);
  // Kenney props are not authored around their origin, so shift the mesh inside
  // the rotated group: that way the correction rotates with the prop instead of
  // sliding it in a fixed world direction.
  const [dx, dz] = useMemo(() => footprintOffset(gltf.scene), [gltf.scene]);
  useMemo(() => {
    cloned.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [cloned]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={cloned} position={[-dx, 0, -dz]} />
    </group>
  );
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
          key={`${item.prop}-${item.cell[0]}-${item.cell[1]}-${item.offset?.[0] ?? 0}-${item.offset?.[1] ?? 0}`}
          name={item.prop}
          position={[
            item.cell[0] + 0.5 + (item.offset?.[0] ?? 0),
            item.y ?? 0,
            item.cell[1] + 0.5 + (item.offset?.[1] ?? 0),
          ]}
          rotationY={item.facingRad ?? 0}
        />
      ))}
    </group>
  );
}
