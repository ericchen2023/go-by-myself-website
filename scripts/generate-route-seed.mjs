import { readFile } from 'node:fs/promises';
import { routePairs, routePairSqlTuple } from './route-seed-lib.mjs';

const graph = JSON.parse(await readFile('contracts/route-graph.v4.json', 'utf8'));
process.stdout.write(`-- Generated from contracts/route-graph.v4.json\n-- ${graph.version} ${graph.checksum}\n`);
process.stdout.write(routePairs(graph).map(routePairSqlTuple).join(',\n'));
process.stdout.write('\n');
