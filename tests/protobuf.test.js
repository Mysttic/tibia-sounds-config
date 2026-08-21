'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readVarint, readFields, readPackedVarints, readFloat, scanValidPrefix, WIRE,
} = require('../electron/lib/protobuf');

test('readVarint obsluguje wartosci jedno- i wielobajtowe', () => {
  assert.deepEqual(readVarint(Buffer.from([0x00]), 0), [0, 1]);
  assert.deepEqual(readVarint(Buffer.from([0x7f]), 0), [127, 1]);
  assert.deepEqual(readVarint(Buffer.from([0x80, 0x01]), 0), [128, 2]);
  assert.deepEqual(readVarint(Buffer.from([0xac, 0x02]), 0), [300, 2]);
  // 2923 = najwyzsze id NumericSoundEffect w prawdziwym banku
  assert.deepEqual(readVarint(Buffer.from([0xeb, 0x16]), 0), [2923, 2]);
});

test('readVarint rzuca na uciętym buforze zamiast zwracac smieci', () => {
  assert.throws(() => readVarint(Buffer.from([0x80]), 0), RangeError);
  assert.throws(() => readVarint(Buffer.alloc(0), 0), RangeError);
});

test('readFields czyta wszystkie wire type ktore wystepuja w banku', () => {
  const buf = Buffer.from([
    0x08, 0x2a,                          // pole 1, varint 42
    0x12, 0x03, 0x61, 0x62, 0x63,        // pole 2, LEN "abc"
    0x25, 0x00, 0x00, 0x80, 0x3f,        // pole 4, fixed32 = 1.0f
  ]);
  const out = [...readFields(buf)];
  assert.equal(out.length, 3);
  assert.deepEqual({ field: out[0].field, wire: out[0].wire, value: out[0].value },
    { field: 1, wire: WIRE.VARINT, value: 42 });
  assert.equal(out[1].value.toString('utf8'), 'abc');
  assert.equal(readFloat(out[2]), 1);
});

test('readFields odrzuca numer pola 0 i nieznany wire type', () => {
  assert.throws(() => [...readFields(Buffer.from([0x00, 0x01]))], /pola 0/);
  assert.throws(() => [...readFields(Buffer.from([0x0b]))], /wire type/);
});

test('readFields wykrywa pole LEN wychodzace poza bufor', () => {
  assert.throws(() => [...readFields(Buffer.from([0x12, 0x10, 0x61]))], RangeError);
});

test('readPackedVarints radzi sobie z packed i z pojedynczym varintem', () => {
  // packed: [1, 300, 2923]
  const packed = { wire: WIRE.LEN, value: Buffer.from([0x01, 0xac, 0x02, 0xeb, 0x16]) };
  assert.deepEqual(readPackedVarints(packed), [1, 300, 2923]);

  const single = { wire: WIRE.VARINT, value: 7 };
  assert.deepEqual(readPackedVarints(single), [7]);

  assert.deepEqual(readPackedVarints({ wire: WIRE.LEN, value: Buffer.alloc(0) }), []);
});

test('scanValidPrefix zatrzymuje sie na pierwszym niepoprawnym polu', () => {
  const valid = Buffer.from([0x08, 0x01, 0x10, 0x02]);
  const trailing = Buffer.concat([valid, Buffer.from([0xff, 0xff, 0xff])]);
  assert.equal(scanValidPrefix(valid, 0), valid.length);
  assert.equal(scanValidPrefix(trailing, 0), valid.length);
});

test('scanValidPrefix zwraca null gdy nic sie nie parsuje', () => {
  assert.equal(scanValidPrefix(Buffer.from([0x00]), 0), null);
});

test('scanValidPrefix nie wychodzi poza podany limit', () => {
  // pole LEN deklarujace 100 bajtow, ktorych nie ma
  const buf = Buffer.concat([Buffer.from([0x12, 0x64]), Buffer.alloc(10)]);
  assert.equal(scanValidPrefix(buf, 0, buf.length), null);
});
