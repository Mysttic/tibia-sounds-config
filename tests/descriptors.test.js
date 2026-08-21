'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  loadEnums, loadSnapshot, extractEnumsFromBuffer, parseFileDescriptor,
} = require('../electron/lib/descriptors');

// --- pomocniki: budowanie sztucznego FileDescriptorProto --------------------

function varint(v) {
  const out = [];
  let n = v;
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}
const len = (field, buf) => Buffer.concat([varint((field << 3) | 2), varint(buf.length), buf]);
const num = (field, v) => Buffer.concat([varint((field << 3) | 0), varint(v)]);
const str = (field, s) => len(field, Buffer.from(s, 'utf8'));

function enumDescriptor(name, values) {
  return Buffer.concat([
    str(1, name),
    ...values.map(([n, v]) => len(2, Buffer.concat([str(1, n), num(2, v)]))),
  ]);
}

function fileDescriptor(name, pkg, enums) {
  return Buffer.concat([
    str(1, name),
    str(2, pkg),
    ...enums.map((e) => len(5, e)),
  ]);
}

const SAMPLE = fileDescriptor('sounds-common.proto', 'tibia.protobuf.sound', [
  enumDescriptor('ENumericSoundType', [
    ['NUMERIC_SOUND_TYPE_UNKNOWN', 0],
    ['NUMERIC_SOUND_TYPE_RAID_ANNOUNCEMENT', 17],
  ]),
  enumDescriptor('ESoundEffectType', [
    ['SOUND_EFFECT_TYPE_Silence', 0],
    ['SOUND_EFFECT_TYPE_SpellHaste', 1006],
    ['SOUND_EFFECT_TYPE_GodspellKillAllMonsters', 10001],
  ]),
]);

// --- testy -----------------------------------------------------------------

test('parseFileDescriptor czyta nazwe, pakiet i enumy', () => {
  const desc = parseFileDescriptor(SAMPLE);
  assert.equal(desc.name, 'sounds-common.proto');
  assert.equal(desc.package, 'tibia.protobuf.sound');
  assert.equal(desc.enums.ESoundEffectType['1006'], 'SOUND_EFFECT_TYPE_SpellHaste');
  assert.equal(desc.enums.ESoundEffectType['10001'], 'SOUND_EFFECT_TYPE_GodspellKillAllMonsters');
  assert.equal(desc.enums.ENumericSoundType['17'], 'NUMERIC_SOUND_TYPE_RAID_ANNOUNCEMENT');
});

test('extractEnumsFromBuffer znajduje blob otoczony smieciami, tak jak w .exe', () => {
  const blob = Buffer.concat([Buffer.from([0x0a, 'sounds-common.proto'.length]), SAMPLE.subarray(2)]);
  const exe = Buffer.concat([
    Buffer.alloc(4096, 0xcc),
    Buffer.from('jakies stringi z .rdata\0', 'ascii'),
    blob,
    Buffer.alloc(2048, 0xff),
  ]);
  const found = extractEnumsFromBuffer(exe);
  assert.ok(found, 'blob powinien zostac znaleziony');
  assert.equal(found.source, 'client.exe');
  assert.equal(found.package, 'tibia.protobuf.sound');
  assert.equal(found.enums.ESoundEffectType['1006'], 'SOUND_EFFECT_TYPE_SpellHaste');
});

test('extractEnumsFromBuffer zwraca null gdy nie ma deskryptora', () => {
  assert.equal(extractEnumsFromBuffer(Buffer.alloc(1024, 0x41)), null);
});

test('extractEnumsFromBuffer pomija falszywy poczatek i szuka dalej', () => {
  // ten sam prefiks, ale zaraz po nim smieci - musi przeskoczyc do prawdziwego blobu
  const fake = Buffer.concat([
    Buffer.from([0x0a, 'sounds-common.proto'.length]),
    Buffer.from('sounds-common.proto', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00]),
  ]);
  const real = Buffer.concat([Buffer.from([0x0a, 'sounds-common.proto'.length]), SAMPLE.subarray(2)]);
  const found = extractEnumsFromBuffer(Buffer.concat([fake, real]));
  assert.ok(found);
  assert.equal(Object.keys(found.enums.ESoundEffectType).length, 3);
});

test('snapshot w repo ma komplet enumow dla klienta 15.32', async () => {
  const snap = await loadSnapshot();
  assert.equal(snap.source, 'snapshot');
  assert.equal(Object.keys(snap.enums.ESoundEffectType).length, 336);
  assert.equal(Object.keys(snap.enums.ENumericSoundType).length, 20);
  assert.equal(Object.keys(snap.enums.EMusicType).length, 4);
  assert.equal(snap.enums.ENumericSoundType['17'], 'NUMERIC_SOUND_TYPE_RAID_ANNOUNCEMENT');
  assert.equal(snap.enums.ESoundEffectType['2508'], 'SOUND_EFFECT_TYPE_DragonBark');
});

test('loadEnums: brak exe -> fallback na snapshot', async () => {
  const res = await loadEnums(path.join(os.tmpdir(), 'nie-ma-takiego-pliku.exe'));
  assert.equal(res.source, 'snapshot');
  assert.ok(res.enums.ESoundEffectType);
});

test('loadEnums: exe bez deskryptora -> fallback na snapshot', async () => {
  const fake = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'exe-')), 'client.exe');
  await fsp.writeFile(fake, Buffer.alloc(8192, 0x90));
  try {
    const res = await loadEnums(fake);
    assert.equal(res.source, 'snapshot');
  } finally {
    await fsp.rm(path.dirname(fake), { recursive: true, force: true });
  }
});

test('loadEnums: exe z deskryptorem wygrywa ze snapshotem', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'exe-'));
  const fake = path.join(dir, 'client.exe');
  const blob = Buffer.concat([Buffer.from([0x0a, 'sounds-common.proto'.length]), SAMPLE.subarray(2)]);
  await fsp.writeFile(fake, Buffer.concat([Buffer.alloc(512, 0), blob, Buffer.alloc(512, 0)]));
  try {
    const res = await loadEnums(fake);
    assert.equal(res.source, 'client.exe');
    assert.equal(Object.keys(res.enums.ESoundEffectType).length, 3);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
