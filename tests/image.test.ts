import { it, expect } from 'vitest';
import { fitDimensions } from '../web/lib/image';

it('never upscales an image smaller than max', () => {
  expect(fitDimensions(800, 600, 1080)).toEqual({ w: 800, h: 600 });
});

it('scales a landscape image so the long edge is max, keeping aspect', () => {
  expect(fitDimensions(4000, 3000, 1080)).toEqual({ w: 1080, h: 810 });
});

it('scales a portrait image the same way', () => {
  expect(fitDimensions(3000, 4000, 1080)).toEqual({ w: 810, h: 1080 });
});

it('is a no-op exactly at the limit', () => {
  expect(fitDimensions(1080, 500, 1080)).toEqual({ w: 1080, h: 500 });
});
