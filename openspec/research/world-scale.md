# World Scale — Measured

Every number here is a measured bounding box from the actual `.glb` files, not an assumption.

## The grid is native

`floorFull` measures exactly **1.00 x 1.00**. The Kenney kit is authored on a one-unit tile
grid, so the "1x1m per cell" grid in the brief maps onto the assets with no scaling at all:
**one grid cell = one floor tile = one world unit**.

## The kit is dollhouse scale, not metric

| Prop | W | H | D | Triangles |
|---|---|---|---|---|
| `floorFull` | 1.00 | 0.05 | 1.00 | 12 |
| `wall` | 1.00 | **1.29** | 0.05 | 12 |
| `doorwayOpen` | 0.49 | 1.01 | 0.09 | 28 |
| `desk` | 0.73 | 0.38 | 0.39 | 198 |
| `chairDesk` | 0.33 | **0.61** | 0.31 | 588 |
| `loungeSofa` | 0.98 | 0.46 | 0.41 | 128 |
| `televisionModern` | 0.68 | 0.45 | 0.13 | 72 |
| `computerScreen` | 0.39 | 0.29 | 0.10 | 72 |
| `kitchenCoffeeMachine` | 0.19 | 0.18 | 0.24 | 166 |
| `pottedPlant` | 0.21 | 0.65 | 0.24 | 60 |
| `bear` | 0.39 | 0.45 | 0.25 | 134 |

A wall is 1.29 units tall and a desk chair 0.61. These are not metres — a real wall is ~2.5 m
and a desk chair ~0.9 m. The kit sits at roughly **half metric scale**, deliberately.

## Consequence: characters normalise to ~1.05 units

Scaling a character to 1.75 "metres" would make it **taller than the walls** and it would
clip through the ceiling of its own office. Normalise the exported character so it stands
about **1.05 units**, which reads correctly against a 0.61-unit chair and a 1.29-unit wall.

Derived anchors for the floor layout and seat sockets:

- character standing height: **~1.05**
- chair seat height: **~0.33** (character hip lands here when seated)
- desk surface height: **~0.38**
- eye level: **~0.95**

All props sit on `minY = 0`, so placement is a straight translate to the cell centre with no
vertical offset needed.

## Rendering cost is negligible

The heaviest prop measured is 588 triangles; most are under 200. A fully furnished floor is a
few thousand triangles. The render budget belongs entirely to the characters (8796 vertices
each) and the HTML overlays, not the office.
