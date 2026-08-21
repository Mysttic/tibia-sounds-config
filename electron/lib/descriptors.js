'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readFields, scanValidPrefix } = require('./protobuf');

/**
 * Wyciaga nazwy akcji (ESoundEffectType, ENumericSoundType, EMusicType) z client.exe.
 *
 * Klient jest zbudowany z pelnym protobufem, wiec w .rdata siedzi serializowany
 * FileDescriptorProto dla sounds-common.proto. Dzieki temu nazwy sa czytane
 * z *wskazanej* instalacji - nowsze wersje klienta dostaja nowe nazwy automatycznie.
 *
 * Fallback: data/enums.snapshot.json (klient 15.32.df7b29).
 */

const PROTO_NAME = 'sounds-common.proto';

// descriptor.proto, tylko te pola ktore nas interesuja
const FILE_NAME = 1;
const FILE_PACKAGE = 2;
const FILE_ENUM_TYPE = 5;
const ENUM_NAME = 1;
const ENUM_VALUE = 2;
const ENUMVAL_NAME = 1;
const ENUMVAL_NUMBER = 2;

function parseEnumDescriptor(buf) {
  const out = { name: '', values: {} };
  for (const f of readFields(buf)) {
    if (f.field === ENUM_NAME) {
      out.name = f.value.toString('utf8');
    } else if (f.field === ENUM_VALUE) {
      let valName = '';
      let valNumber = 0;
      for (const g of readFields(f.value)) {
        if (g.field === ENUMVAL_NAME) valName = g.value.toString('utf8');
        else if (g.field === ENUMVAL_NUMBER) valNumber = g.value;
      }
      if (valName) out.values[valNumber] = valName;
    }
  }
  return out;
}

function parseFileDescriptor(buf) {
  const out = { name: '', package: '', enums: {} };
  for (const f of readFields(buf)) {
    if (f.field === FILE_NAME) out.name = f.value.toString('utf8');
    else if (f.field === FILE_PACKAGE) out.package = f.value.toString('utf8');
    else if (f.field === FILE_ENUM_TYPE) {
      const e = parseEnumDescriptor(f.value);
      if (e.name) out.enums[e.name] = e.values;
    }
  }
  return out;
}

/**
 * Szuka w buforze blobu FileDescriptorProto dla podanej nazwy .proto.
 * Blob zaczyna sie od: 0x0a <len> "<nazwa>.proto"
 */
function extractEnumsFromBuffer(buf, protoName = PROTO_NAME) {
  const needle = Buffer.concat([
    Buffer.from([0x0a, protoName.length]),
    Buffer.from(protoName, 'ascii'),
  ]);
  let from = 0;
  for (;;) {
    const at = buf.indexOf(needle, from);
    if (at < 0) return null;
    from = at + 1;
    const end = scanValidPrefix(buf, at, Math.min(buf.length, at + 400_000));
    if (!end) continue;
    try {
      const desc = parseFileDescriptor(buf.subarray(at, end));
      if (desc.name === protoName && Object.keys(desc.enums).length > 0) {
        return { source: 'client.exe', offset: at, package: desc.package, enums: desc.enums };
      }
    } catch {
      // trafiony falszywy poczatek, szukamy dalej
    }
  }
}

/** Wczytuje snapshot z repo (data/enums.snapshot.json). */
async function loadSnapshot() {
  const file = path.join(__dirname, '..', '..', 'data', 'enums.snapshot.json');
  const snap = JSON.parse(await fs.readFile(file, 'utf8'));
  return { source: 'snapshot', package: snap.package, enums: snap.enums, note: snap.source };
}

/**
 * Zwraca { source, enums: { ESoundEffectType, ENumericSoundType, EMusicType } }.
 * Najpierw probuje client.exe, przy niepowodzeniu wraca do snapshotu.
 */
async function loadEnums(clientExePath) {
  if (clientExePath) {
    try {
      const buf = await fs.readFile(clientExePath);
      const found = extractEnumsFromBuffer(buf);
      if (found && found.enums.ESoundEffectType && found.enums.ENumericSoundType) return found;
    } catch {
      // brak dostepu do exe albo inny format - lecimy na snapshot
    }
  }
  return loadSnapshot();
}

module.exports = { loadEnums, loadSnapshot, extractEnumsFromBuffer, parseFileDescriptor };
