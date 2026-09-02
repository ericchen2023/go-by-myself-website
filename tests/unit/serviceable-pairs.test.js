import { expect, test } from 'vitest';
import { unreachableFrom } from '../../src/domain/presentation.js';

const STOPS = ['LIBRARY', 'HSS2', 'HSS1', 'ADMIN'];
// 車上實際有的八段：環狀 LIBRARY–HSS2–HSS1–ADMIN–LIBRARY。
const TAUGHT = [
  { fromStopCode: 'LIBRARY', toStopCode: 'HSS2' }, { fromStopCode: 'HSS2', toStopCode: 'LIBRARY' },
  { fromStopCode: 'HSS2', toStopCode: 'HSS1' }, { fromStopCode: 'HSS1', toStopCode: 'HSS2' },
  { fromStopCode: 'HSS1', toStopCode: 'ADMIN' }, { fromStopCode: 'ADMIN', toStopCode: 'HSS1' },
  { fromStopCode: 'LIBRARY', toStopCode: 'ADMIN' }, { fromStopCode: 'ADMIN', toStopCode: 'LIBRARY' }
];

test('hides the two pairs nobody ever drove', () => {
  // 圖資中心只教了到人社二館與行政大樓；人社一館沒有那張圖。
  expect(unreachableFrom('LIBRARY', TAUGHT, STOPS)).toEqual(['HSS1']);
  expect(unreachableFrom('HSS2', TAUGHT, STOPS)).toEqual(['ADMIN']);
});

test('never lists the stop the parcel is leaving from', () => {
  for (const stop of STOPS) {
    expect(unreachableFrom(stop, TAUGHT, STOPS)).not.toContain(stop);
  }
});

test('blocks nothing while the list has not arrived', () => {
  // 伺服器的 trigger 才是權威。清單拿不到時不該把整個表單鎖死。
  expect(unreachableFrom('LIBRARY', [], STOPS)).toEqual([]);
  expect(unreachableFrom('LIBRARY', undefined, STOPS)).toEqual([]);
});

test('blocks nothing before a pickup stop is chosen', () => {
  expect(unreachableFrom('', TAUGHT, STOPS)).toEqual([]);
});
