'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { encodePng, renderPixels, crc32, SIZE } = require('../tools/make-icon');

/**
 * Ikona jest generowana kodem (tools/make-icon.js), a nie wrzucona jako binarka,
 * wiec da sie ja sensownie testowac i odtworzyc przy kazdym buildzie.
 */

test('crc32 zgadza sie ze znanymi wartosciami', () => {
  assert.equal(crc32(Buffer.from('', 'ascii')), 0);
  assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082);
});

test('encodePng produkuje poprawny naglowek i chunki', () => {
  const png = encodePng(Buffer.alloc(4 * 4 * 4, 0x40), 4);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4, 'szerokosc');
  assert.equal(png.readUInt32BE(20), 4, 'wysokosc');
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'color type RGBA');
  assert.ok(png.includes(Buffer.from('IHDR', 'ascii')));
  assert.ok(png.includes(Buffer.from('IDAT', 'ascii')));
  assert.ok(png.subarray(-8).includes(Buffer.from('IEND', 'ascii')));
});

test('dane IDAT rozpakowuja sie do scanline z filtrem None', () => {
  const size = 2;
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const png = encodePng(pixels, size);
  const start = png.indexOf(Buffer.from('IDAT', 'ascii')) + 4;
  const length = png.readUInt32BE(start - 8);
  const raw = zlib.inflateSync(png.subarray(start, start + length));

  assert.equal(raw.length, (size * 4 + 1) * size);
  assert.equal(raw[0], 0, 'filtr None');
  assert.deepEqual([...raw.subarray(1, 5)], [255, 0, 0, 255]);
  assert.equal(raw[size * 4 + 1], 0, 'filtr None w drugim wierszu');
});

test('wyrenderowana ikona ma tlo, obwodke i zloty element', () => {
  const px = renderPixels();
  assert.equal(px.length, SIZE * SIZE * 4);

  const at = (x, y) => [...px.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];
  // rogi sa przezroczyste (zaokraglony kwadrat)
  assert.equal(at(1, 1)[3], 0);
  assert.equal(at(SIZE - 2, SIZE - 2)[3], 0);
  // srodek jest nieprzezroczysty
  assert.equal(at(128, 128)[3], 255);
  // korpus glosnika jest zloty
  const body = at(78, 128);
  assert.ok(body[0] > 150 && body[1] > 120 && body[2] < 90, `oczekiwano zlota, jest ${body}`);
});

test('build/icon.png istnieje i zgadza sie z generatorem', () => {
  const file = path.join(__dirname, '..', 'build', 'icon.png');
  assert.ok(fs.existsSync(file), 'uruchom `npm run icon`');
  const onDisk = fs.readFileSync(file);
  const fresh = encodePng(renderPixels(), SIZE);
  assert.ok(onDisk.equals(fresh), 'build/icon.png jest nieaktualny wzgledem tools/make-icon.js');
});
