import { it, expect } from 'vitest';
import { classifyPlatform } from '../web/lib/install';

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';

it('standalone display wins regardless of platform', () => {
  expect(classifyPlatform(IOS_SAFARI, { standalone: true, hasPrompt: false })).toBe('installed');
  expect(classifyPlatform(ANDROID_CHROME, { standalone: true, hasPrompt: true })).toBe('installed');
});

it('a captured beforeinstallprompt means one-tap install', () => {
  expect(classifyPlatform(ANDROID_CHROME, { standalone: false, hasPrompt: true })).toBe('prompt-ready');
  expect(classifyPlatform(DESKTOP_CHROME, { standalone: false, hasPrompt: true })).toBe('prompt-ready');
});

it('iOS Safari without a prompt gets the Share-sheet instructions', () => {
  expect(classifyPlatform(IOS_SAFARI, { standalone: false, hasPrompt: false })).toBe('ios-safari');
});

it('iOS in a non-Safari browser must switch to Safari', () => {
  expect(classifyPlatform(IOS_CHROME, { standalone: false, hasPrompt: false })).toBe('ios-other');
});

it('a Chromium browser with no prompt yet falls back to menu instructions', () => {
  expect(classifyPlatform(ANDROID_CHROME, { standalone: false, hasPrompt: false })).toBe('manual');
  expect(classifyPlatform(DESKTOP_CHROME, { standalone: false, hasPrompt: false })).toBe('manual');
});

it('a browser that cannot install shows nothing', () => {
  expect(classifyPlatform(DESKTOP_FIREFOX, { standalone: false, hasPrompt: false })).toBe('unsupported');
});
