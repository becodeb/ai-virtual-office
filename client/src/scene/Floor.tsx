/**
 * Floor tiles and perimeter walls (task 4.5), instanced with drei's
 * `<Instances>` — one grid cell = one world unit (`openspec/research/world-scale.md`).
 * `floorFull` and `wall` each measure exactly `1.00 x _ x 1.00` at the base,
 * so placement is a straight `cell + 0.5` translate with no scaling.
 */
import { useMemo } from 'react';
import { Instance, Instances } from '@react-three/drei';
import { useGLTF } from '@react-three/drei';
import type { Mesh, MeshStandardMaterial } from 'three';
import { propGlbUrl } from '../assets/manifest.js';
import { perimeterWallCells, type Cell, type FloorLayout } from '../net/floorLayout.js';

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
    const found: Array<{ geometry: Mesh['geometry']; material: MeshStandardMaterial }> = [];
    gltf.scene.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) found.push({ geometry: mesh.geometry, material: mesh.material as MeshStandardMaterial });
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
}: {
  name: string;
  cells: readonly Cell[];
  rotationFor?: (cell: Cell) => [number, number, number];
}): JSX.Element {
  const parts = usePropMeshes(name);
  return (
    <group>
      {parts.map((part, partIndex) => (
        <Instances
          key={partIndex}
          geometry={part.geometry}
          material={part.material}
          limit={Math.max(cells.length, 1)}
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

  const wallCells = useMemo(() => perimeterWallCells(layout), [layout]);

  return (
    <group>
      <InstancedProp name="floorFull" cells={tileCells} />
      <InstancedProp
        name="wall"
        cells={wallCells}
        rotationFor={([, y]) =>
          // Walls on the top/bottom edges run east-west; the side edges rotate to run north-south.
          y === 0 || y === layout.height - 1 ? [0, 0, 0] : [0, Math.PI / 2, 0]
        }
      />
    </group>
  );
}
