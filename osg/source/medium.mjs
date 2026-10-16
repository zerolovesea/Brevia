import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const input = new URL('../project.json', import.meta.url);
const project = JSON.parse(readFileSync(input, 'utf8'));
assert.equal(project.projectData.length, 10);
for (const board of project.projectData) {
  assert.deepEqual(board.size, { width: 1320, height: 2868 });
  const ratio = 1206 / 1320;
  const offset = (2622 - 2868 * ratio) / 2;
  board.size = { width: 1206, height: 2622 };
  for (const element of board.elements) {
    element.position.x *= ratio;
    element.position.y = element.position.y * ratio + offset;
    element.size.width *= ratio;
    element.size.height *= ratio;
    if (element.fontSize !== undefined) element.fontSize *= ratio;
    if (element.borderRadius !== undefined) element.borderRadius *= ratio;
    if (element.shadow) {
      for (const key of ['x', 'y', 'blur']) element.shadow[key] *= ratio;
    }
  }
}
project.id += '-medium';
project.name += ' · 1206×2622';
writeFileSync(new URL('../project-medium.json', import.meta.url), JSON.stringify(project, null, 2));
