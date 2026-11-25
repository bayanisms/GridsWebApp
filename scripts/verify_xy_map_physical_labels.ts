import {
  DRUM_MAP_LAYOUT,
  nodeIndexFromXY,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Map dots use firmware-internal XY; labels must match selection.
const MAP_GRID = [0, 64, 128, 192, 255];
const mapPoints = MAP_GRID.flatMap((gridY, yIndex) =>
  MAP_GRID.map((gridX, xIndex) => ({
    x: gridX,
    y: gridY,
    nodeId: DRUM_MAP_LAYOUT[xIndex][yIndex],
  })),
);

for (const point of mapPoints) {
  const selected = nodeIndexFromXY(point.x, point.y);
  assert(
    selected === point.nodeId,
    `map label mismatch at (${point.x},${point.y}): label node ${point.nodeId}, selection ${selected}`,
  );
}

assert(nodeIndexFromXY(128, 128) === 4, 'center map should select node 4');
assert(nodeIndexFromXY(0, 0) === 10, 'map 0,0 should select node 10');
assert(nodeIndexFromXY(255, 255) === 22, 'map 255,255 should select node 22');

console.log(JSON.stringify({
  status: 'ok',
  pointsChecked: mapPoints.length,
  center: nodeIndexFromXY(128, 128),
  corner00: nodeIndexFromXY(0, 0),
  corner255: nodeIndexFromXY(255, 255),
}, null, 2));
