import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { server, signIn, type TestServer } from './helpers.js';

describe('people sign in to the screens: accounts, roles, sessions (SYS9010)', () => {
  let s: TestServer;
  before(async () => { s = await server('gmes'); });
  after(() => s.close());

  test('a new installation asks for its first administrator, once', async () => {
    const st = await s.app.http.inject({ method: 'GET', url: '/api/auth/state' });
    assert.equal(st.json().needsSetup, true);
    assert.equal(st.json().user, null);
    assert.match(st.json().plant.today, /^\d{4}-\d{2}-\d{2}$/);
    const r = await s.app.http.inject({ method: 'POST', url: '/api/setup', payload: { login: 'Admin', name: 'Plant admin', password: 'first-pass-1' } });
    assert.equal(r.statusCode, 200);
    const cookie = String(r.headers['set-cookie']);
    assert.match(cookie, /gmes_sid=[^;]+; HttpOnly; SameSite=Strict/);
    const again = await s.app.http.inject({ method: 'POST', url: '/api/setup', payload: { login: 'intruder', name: 'X', password: 'another-pass' } });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, 'setup.done');
    const me = await s.app.http.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: cookie.split(';')[0]! } });
    assert.equal(me.json().user.login, 'admin');
    assert.equal(me.json().user.role, 'ADMIN');
  });

  test('the session opens what the role allows and nothing more; the server checks, not the screen', async () => {
    const admin = await signIn(s, 'admin', 'first-pass-1');
    assert.equal((await admin('POST', '/api/users', { login: 'op.ahmed', name: 'Ahmed', role: 'OPERATOR', password: 'op-pass-123' })).status, 200);
    const op = await signIn(s, 'op.ahmed', 'op-pass-123');
    assert.equal((await op('GET', '/api/users')).status, 403, 'an operator does not manage accounts');
    assert.equal((await op('GET', '/api/plant')).status, 200);
    assert.equal((await op('POST', '/api/plant', { code: 'P9', type: 'plant', nameEn: 'X' })).status, 403, 'an operator does not change the plant model');
    const st = await s.app.http.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: op.cookie } });
    assert.equal(st.json().user.mustChangePassword, true, 'a password given by an administrator must be changed');
  });

  test('five wrong passwords lock the account, and the count survives the refusal', async () => {
    const admin = await signIn(s, 'admin', 'first-pass-1');
    await admin('POST', '/api/users', { login: 'q.nour', name: 'Nour', role: 'QUALITY', password: 'right-pass-1' });
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await s.app.http.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'q.nour', password: 'wrong-' + i } });
      codes.push(r.json().error.code);
    }
    assert.deepEqual(codes, ['auth.invalid', 'auth.invalid', 'auth.invalid', 'auth.invalid', 'auth.locked']);
    const right = await s.app.http.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'q.nour', password: 'right-pass-1' } });
    assert.equal(right.json().error.code, 'auth.locked', 'even the right password is refused while locked');
    const users = (await admin('GET', '/api/users?status=locked')).body;
    const nour = users.find((u: any) => u.login === 'q.nour');
    assert.ok(nour);
    assert.equal((await admin('PATCH', `/api/users/${nour.id}`, { status: 'active' })).status, 200);
    assert.equal((await s.app.http.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'q.nour', password: 'right-pass-1' } })).statusCode, 200);
  });

  test('locking a person ends their session at once; signing out ends it too', async () => {
    const admin = await signIn(s, 'admin', 'first-pass-1');
    await admin('POST', '/api/users', { login: 'sup.ali', name: 'Ali', role: 'SUPERVISOR', password: 'sup-pass-12' });
    const sup = await signIn(s, 'sup.ali', 'sup-pass-12');
    assert.equal((await sup('GET', '/api/plant')).status, 200);
    const id = (await admin('GET', '/api/users?text=sup.ali')).body[0].id;
    await admin('PATCH', `/api/users/${id}`, { status: 'locked' });
    assert.equal((await sup('GET', '/api/plant')).status, 401);
    const admin2 = await signIn(s, 'admin', 'first-pass-1');
    await admin2('POST', '/api/auth/logout');
    assert.equal((await admin2('GET', '/api/users')).status, 401);
  });

  test('the last administrator cannot be removed, and nobody locks or demotes themself', async () => {
    const admin = await signIn(s, 'admin', 'first-pass-1');
    const me = (await admin('GET', '/api/users?text=admin')).body.find((u: any) => u.login === 'admin');
    const self = await admin('PATCH', `/api/users/${me.id}`, { role: 'VIEWER' });
    assert.equal(self.body.error.code, 'user.self');
    await admin('POST', '/api/users', { login: 'admin2', name: 'Second', role: 'ADMIN', password: 'admin2-pass' });
    const second = await signIn(s, 'admin2', 'admin2-pass');
    assert.equal((await second('PATCH', `/api/users/${me.id}`, { status: 'inactive' })).status, 200, 'another admin remains');
    const id2 = (await second('GET', '/api/users?text=admin2')).body[0].id;
    await second('PATCH', `/api/users/${me.id}`, { status: 'active' });
    const back = await signIn(s, 'admin', 'first-pass-1');
    assert.equal((await back('PATCH', `/api/users/${id2}`, { status: 'inactive' })).status, 200);
    assert.equal((await second('GET', '/api/users')).status, 401, 'the deactivated admin2 is signed out at once');
    // an administration key (not a person) tries to remove the only active administrator left
    const last = await s.call('PATCH', `/api/users/${me.id}`, { status: 'inactive' });
    assert.equal(last.body.error.code, 'user.last_admin');
    assert.equal((await s.call('PATCH', `/api/users/${me.id}`, { role: 'PLANNER' })).body.error.code, 'user.last_admin');
  });

  test('changing one own password needs the current one; every account change is in the audit log', async () => {
    const op = await signIn(s, 'op.ahmed', 'op-pass-123');
    assert.equal((await op('POST', '/api/auth/password', { current: 'nope', next: 'new-pass-99' })).body.error.code, 'auth.wrong_password');
    assert.equal((await op('POST', '/api/auth/password', { current: 'op-pass-123', next: 'new-pass-99' })).status, 200);
    const op2 = await signIn(s, 'op.ahmed', 'new-pass-99');
    const st = await s.app.http.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: op2.cookie } });
    assert.equal(st.json().user.mustChangePassword, false);
    const log = (await s.call('GET', '/api/audit')).body;
    assert.ok(log.some((e: any) => e.action === 'lock' && e.target === 'q.nour' && e.actor === 'system'));
    assert.ok(log.some((e: any) => e.action === 'password' && e.target === 'op.ahmed'));
    assert.ok(!JSON.stringify(log).includes('new-pass-99'), 'no password in the log');
  });

  test('passwords and session tokens are never stored as themselves', async () => {
    const rows = await s.app.ctx.db.all<{ password_hash: string }>('SELECT password_hash FROM sys_user');
    for (const r of rows) assert.match(r.password_hash, /^scrypt\$/);
    const sessions = await s.app.ctx.db.all<{ token_hash: Uint8Array }>('SELECT token_hash FROM sys_session');
    for (const x of sessions) assert.equal(x.token_hash.length, 32);
  });
});
