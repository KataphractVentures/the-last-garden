import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaticServer } from './serve.mjs';

test('production server serves built assets and rejects write/traversal requests', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'last-garden-static-'));
  const build = path.join(temporary, 'dist');
  const privateFiles = path.join(temporary, 'private');
  let server;
  try {
    await mkdir(build); await mkdir(privateFiles);
    await writeFile(path.join(build, 'index.html'), '<!doctype html><title>Garden</title>');
    await writeFile(path.join(build, 'art.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(build, 'music.mp3'), Buffer.from([0xff, 0xfb]));
    await writeFile(path.join(build, '.private'), 'hidden');
    await writeFile(path.join(privateFiles, 'secret.txt'), 'outside');
    await symlink(privateFiles, path.join(build, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    server = await createStaticServer(build);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (requestPath, method = 'GET', host = `127.0.0.1:${port}`) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers: { Host: host } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject); req.end();
    });
    const index = await request('/');
    assert.equal(index.status, 200); assert.match(index.body, /Garden/);
    assert.equal(index.headers['x-content-type-options'], 'nosniff');
    const head = await request('/', 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], index.headers['content-length']);
    assert.equal((await request('/art.svg?version=1')).headers['content-type'], 'image/svg+xml');
    assert.equal((await request('/music.mp3')).headers['content-type'], 'audio/mpeg');
    assert.equal((await request('/missing.js')).status, 404);
    assert.equal((await request('/linked')).status, 403);
    assert.equal((await request('/linked/secret.txt')).status, 403);
    assert.equal((await request('/.private')).status, 403);
    assert.equal((await request('/%2e%2e/private/secret.txt')).status, 403);
    assert.equal((await request('/..%5cprivate%5csecret.txt')).status, 400);
    assert.equal((await request('/index.html:stream')).status, 400);
    assert.equal((await request('/%00')).status, 400);
    assert.equal((await request('/%invalid')).status, 400);
    assert.equal((await request('/', 'POST')).status, 405);
    assert.equal((await request('/', 'DELETE')).status, 405);
    assert.equal((await request('/', 'GET', 'unrelated.example')).status, 403);
  } finally {
    if (server?.listening) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    // Delete only this test's verified, freshly created temporary directory.
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('last-garden-static-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
