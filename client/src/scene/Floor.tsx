/**
 * Floor tiles and perimeter walls (task 4.5), instanced with drei's
 * `<Instances>` — one grid cell = one world unit (`openspec/research/world-scale.md`).
 * `floorFull` and `wall` each measure exactly `1.00 x _ x 1.00` at the base,
 * so placement is a straight `cell + 0.5` translate with no scaling.
 */
import { useMemo } from 'react';
import { Instance, Instances } from '@react-three/drei';
import { useGLTF } from '@react-three/drei';
import { Color } from 'three';
import type { Mesh, MeshStandardMaterial } from 'three';
import { propGlbUrl } from '../assets/manifest.js';
import type { Cell, FloorLayout } from '../net/floorLayout.js';
import { footprintOffset, shiftGeometry } from './propCentering.js';

export interface FloorProps {
  layout: FloorLayout;
}

/**
 * Every renderable mesh in a prop GLB, not just the first one.
 *
 * Kenney props are split by material: `wall` is three sub-meshes that together
 * form one wall, and `wallWindow` is five. Taking only the first renders a
 * single-colour sliver of the prop — the walls looked like a thin line drawn
 * along one edge of the floor and nothing else.
 */
function usePropMeshes(name: string): Array<{ geometry: Mesh['geometry']; material: MeshStandardMaterial }> {
  const gltf = useGLTF(propGlbUrl(name));
  return useMemo(() => {
    // One offset for the whole prop — see propCentering.ts.
    const offset = footprintOffset(gltf.scene);
    const found: Array<{ geometry: Mesh['geometry']; material: MeshStandardMaterial }> = [];
    gltf.scene.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) {
        found.push({
          geometry: shiftGeometry(mesh.geometry, offset),
          material: mesh.material as MeshStandardMaterial,
        });
      }
    });
    if (found.length === 0) throw new Error(`Prop "${name}" has no mesh`);
    return found;
  }, [gltf, name]);
}

/** Instances one prop across many cells, one `<Instances>` group per sub-mesh. */
function InstancedProp({
  name,
  cells,
  rotationFor,
  receiveShadow = false,
  tint,
}: {
  name: string;
  cells: readonly Cell[];
  rotationFor?: (cell: Cell) => [number, number, number];
  receiveShadow?: boolean;
  tint?: string;
}): JSX.Element {
  const parts = usePropMeshes(name);
  const materials = useMemo(
    () =>
      parts.map((part) => {
        if (tint === undefined) return part.material;
        const m = part.material.clone();
        m.color = new Color(tint);
        return m;
      }),
    [parts, tint]
  );
  return (
    <group>
      {parts.map((part, partIndex) => (
        <Instances
          key={partIndex}
          geometry={part.geometry}
          material={materials[partIndex] ?? part.material}
          limit={Math.max(cells.length, 1)}
          receiveShadow={receiveShadow}
        >
          {cells.map((cell) => (
            // All props sit on minY=0 (world-scale.md) — no vertical offset needed.
            <Instance
              key={`${cell[0]},${cell[1]}`}
              position={[cell[0] + 0.5, 0, cell[1] + 0.5]}
              rotation={rotationFor?.(cell) ?? [0, 0, 0]}
            />
          ))}
        </Instances>
      ))}
    </group>
  );
}

export function Floor({ layout }: FloorProps): JSX.Element {
  const tileCells = useMemo(() => {
    const cells: Cell[] = [];
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) cells.push([x, y]);
    }
    return cells;
  }, [layout.width, layout.height]);

  const [plankA, plankB] = useMemo(() => {
    const a: Cell[] = [];
    const b: Cell[] = [];
    for (const cell of tileCells) (cell[1] % 2 === 0 ? a : b).push(cell);
    return [a, b] as const;
  }, [tileCells]);

  return (
    <group>
      {/*
        Two tones, alternating by row, so the floor reads as boards rather than
        one flat plane. A single uniform colour is what makes a room look empty
        even when it is furnished: there is nothing for the eye to measure the
        furniture against.
      */}
      <InstancedProp name="floorFull" cells={plankA} receiveShadow tint="#a87f5c" />
      <InstancedProp name="floorFull" cells={plankB} receiveShadow tint="#9c7452" />
    </group>
  );
}
