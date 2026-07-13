import { expect, test } from '@playwright/test';
test('health endpoint and sealed public setup metadata are available', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();

  const presets = await request.get('/api/game/presets?players=7');
  expect(presets.ok()).toBeTruthy();
  const body = await presets.json();
  expect(body.count).toBe(7);
  expect(body.minPlayers).toBe(5);
  expect(body.maxPlayers).toBe(12);
  expect(body.roles).toBeUndefined();
  expect(body.roleDefinitions).toBeUndefined();
});
