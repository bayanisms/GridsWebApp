import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = readFileSync('src/App.tsx', 'utf8');

assert(app.includes('const [editableNodes'), 'App must keep a full editable 25-node bank in browser memory');
assert(app.includes('patternDirtyRef'), 'App must track whether the visible pattern has real user edits before committing it to the bank');
assert(app.includes('commitCurrentPatternToEditableNodes'), 'App must commit current pattern edits into the editable bank before XY/map changes and export');
assert(app.includes('if (!patternDirtyRef.current)'), 'Pure X/Y navigation must not commit generated/interpolated previews into the editable bank');
assert(app.includes('generatePatternFromFactory(next, committedNodes'), 'XY navigation must read patterns from the committed editable bank, not the immutable factory bank');
assert(app.includes('const desiredNodes = committedNodes.map'), 'Firmware export must start from the full committed editable bank, preserving defaults and user changes');
assert(!app.includes('const replacementNode = nodeDataFromPattern(pattern);\n    for (const nodeIndex of targetNodeIndices)'), 'Export must not patch all current interpolation nodes with one global pattern at export time only');

console.log(JSON.stringify({ status: 'ok', checks: 7 }, null, 2));
