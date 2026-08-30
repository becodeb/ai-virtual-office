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
import { perimeterWallCells, type FloorLayout } from '../net/floorLayout.js';

export interface FloorProps {
  layout: FloorLayout;
}

function usePropMesh(name: string): { geometry: Mesh['geometry']; material: MeshStandardMaterial } {
  const gltf = useGLTF(propGlbUrl(name));
  const mesh = useMemo(() => {
    let found: Mesh | null = null;
    gltf.scene.traverse((child) => {
      if (found === null && (child as Mesh).isMesh) found = child as Mesh;
    });
    if (found === null) throw new Error(`Prop "${name}" has no mesh`);
    return found as Mesh;
  }, [gltf, name]);
  return { geometry: mesh.geometry, material: mesh.material as MeshStandardMaterial };
}

export function Floor({ layout }: FloorProps): JSX.Element {
  const floorTile = usePropMesh('floorFull');
  const wallTile = usePropMesh('wall');

  const tileCells = useMemo(() => {
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) cells.push([x, y]);
    }
    return cells;
  }, [layout.width, layout.height]);

  const wallCells = useMemo(() => perimeterWallCells(layout), [layout]);

  return (
    <group>
      <Instances geometry={floorTile.geometry} material={floorTile.material} limit={tileCells.length}>
        {tileCells.map(([x, y]) => (
          <Instance key={`${x},${y}`} position={[x + 0.5, 0, y + 0.5]} />
        ))}
      </Instances>
      <Instances geometry={wallTile.geometry} material={wallTile.material} limit={Math.max(wallCells.length, 1)}>
        {wallCells.map(([x, y]) => {
          // Walls on the top/bottom edges run east-west; walls on the left/right edges are rotated to run north-south.
          const isHorizontalEdge = y === 0 || y === layout.height - 1;
          return (
            // All props sit on minY=0 (world-scale.md) — no vertical offset needed.
            <Instance
              key={`${x},${y}`}
              position={[x + 0.5, 0, y + 0.5]}
              rotation={isHorizontalEdge ? [0, 0, 0] : [0, Math.PI / 2, 0]}
            />
          );
        })}
      </Instances>
    </group>
  );
}
