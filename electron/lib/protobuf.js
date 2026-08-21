'use strict';

/**
 * Minimalny czytnik protobuf wire format.
 * Wystarcza do `tibia.protobuf.sound.Sounds` i do FileDescriptorProto z client.exe.
 * Schematy: docs/sounds.proto.txt, docs/sounds-common.proto.txt
 */

const WIRE = { VARINT: 0, FIXED64: 1, LEN: 2, SGROUP: 3, EGROUP: 4, FIXED32: 5 };

/** Czyta varint. Zwraca [wartosc, nowyOffset]. Rzuca gdy wyjdzie poza bufor. */
function readVarint(buf, offset) {
  let result = 0;
  let shift = 1;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) throw new RangeError('varint poza buforem');
    const byte = buf[pos++];
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) break;
    shift *= 128;
    if (shift > Number.MAX_SAFE_INTEGER) throw new RangeError('varint za dlugi');
  }
  return [result, pos];
}

/**
 * Iteruje po polach komunikatu.
 * Yielduje { field, wire, value } gdzie value to number (varint) albo Buffer.
 */
function* readFields(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos < end) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 0) throw new Error('numer pola 0');
    switch (wire) {
      case WIRE.VARINT: {
        let value;
        [value, pos] = readVarint(buf, pos);
        yield { field, wire, value };
        break;
      }
      case WIRE.FIXED64:
        if (pos + 8 > end) throw new RangeError('fixed64 poza buforem');
        yield { field, wire, value: buf.subarray(pos, pos + 8) };
        pos += 8;
        break;
      case WIRE.LEN: {
        let len;
        [len, pos] = readVarint(buf, pos);
        if (pos + len > end) throw new RangeError('pole LEN poza buforem');
        yield { field, wire, value: buf.subarray(pos, pos + len) };
        pos += len;
        break;
      }
      case WIRE.FIXED32:
        if (pos + 4 > end) throw new RangeError('fixed32 poza buforem');
        yield { field, wire, value: buf.subarray(pos, pos + 4) };
        pos += 4;
        break;
      default:
        throw new Error(`nieobslugiwany wire type ${wire}`);
    }
  }
}

/** Rozpakowuje `repeated uint32` zapisane jako packed albo pojedyncze varinty. */
function readPackedVarints(entry) {
  if (entry.wire === WIRE.VARINT) return [entry.value];
  const out = [];
  let pos = 0;
  while (pos < entry.value.length) {
    let v;
    [v, pos] = readVarint(entry.value, pos);
    out.push(v);
  }
  return out;
}

/** float z pola FIXED32 (MinMaxFloat.min / .max). */
function readFloat(entry) {
  return entry.value.readFloatLE(0);
}

/**
 * Skanuje bufor w przod od `start`, dopoki kolejne pola parsuja sie poprawnie.
 * Uzywane do wyciagania FileDescriptorProto z .exe, gdzie nie znamy dlugosci blobu.
 * Zwraca offset konca albo null.
 */
function scanValidPrefix(buf, start, limit = buf.length) {
  let pos = start;
  let lastGood = null;
  try {
    while (pos < limit) {
      let key;
      let next;
      [key, next] = readVarint(buf, pos);
      const field = key >>> 3;
      const wire = key & 7;
      if (field === 0 || field > 20 || wire === 3 || wire === 4 || wire > 5) break;
      if (wire === WIRE.VARINT) {
        [, next] = readVarint(buf, next);
      } else if (wire === WIRE.FIXED64) {
        next += 8;
      } else if (wire === WIRE.FIXED32) {
        next += 4;
      } else {
        let len;
        let after;
        [len, after] = readVarint(buf, next);
        if (len > 1_000_000) break;
        next = after + len;
      }
      if (next > limit) break;
      pos = next;
      lastGood = pos;
    }
  } catch {
    // uciety blob - zwracamy to co udalo sie sparsowac
  }
  return lastGood;
}

module.exports = { WIRE, readVarint, readFields, readPackedVarints, readFloat, scanValidPrefix };
