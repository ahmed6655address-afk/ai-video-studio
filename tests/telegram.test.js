import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramInternals } from '../server/telegram.js';

const { parseCommand, safeEqual, splitMessage, readConfig } = telegramInternals;

test('Telegram command parser accepts commands with bot mentions', () => {
  assert.deepEqual(parseCommand('/start'), { name: 'start', argument: '' });
  assert.deepEqual(parseCommand('/status@AIVideoStudio_Manager_bot'), { name: 'status', argument: '' });
  assert.deepEqual(parseCommand('/link one-time-code'), { name: 'link', argument: 'one-time-code' });
});

test('Telegram command parser rejects non-commands and oversized text', () => {
  assert.equal(parseCommand('hello'), null);
  assert.equal(parseCommand('/start' + 'x'.repeat(4096)), null);
  assert.equal(parseCommand(null), null);
});

test('secret comparison is constant-time for equal-length inputs and rejects empty values', () => {
  assert.equal(safeEqual('secret-value', 'secret-value'), true);
  assert.equal(safeEqual('secret-value', 'secret-valuf'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('short', 'longer'), false);
});

test('message splitting preserves all Unicode characters and respects the limit', () => {
  const input = 'مرحبا🌟'.repeat(20);
  const parts = splitMessage(input, 17);
  assert.ok(parts.every((part) => Array.from(part).length <= 17));
  assert.equal(parts.join(''), input);
});

test('Telegram configuration reads secrets only from the supplied environment', () => {
  assert.deepEqual(readConfig({
    TELEGRAM_BOT_TOKEN: '123:token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_OWNER_CHAT_ID: '123456',
    TELEGRAM_PAIRING_SECRET: 'pair-secret',
  }), {
    token: '123:token',
    webhookSecret: 'webhook-secret',
    ownerChatId: '123456',
    pairingSecret: 'pair-secret',
  });
});
