const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cwd = path.resolve(__dirname, '..');
const secret = 'private-test-password';

test('missing database configuration fails with an actionable message', () => {
    const result = spawnSync(process.execPath, ['server.js'], {
        cwd, encoding: 'utf8', env: { ...process.env, MONGODB_URI: '' }, timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MONGODB_URI is missing/);
});

test('malformed and placeholder connection strings fail without exposing their values', () => {
    for (const uri of [`MONGODB_URI=mongodb+srv://user:${secret}@example.com/db`,
        `mongodb+srv://user:${secret}@<your-cluster>/db`]) {
        const result = spawnSync(process.execPath, ['server.js'], {
            cwd, encoding: 'utf8', env: { ...process.env, MONGODB_URI: uri }, timeout: 5000
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Configuration failed:/);
        assert.ok(!result.stderr.includes(secret));
        assert.ok(!result.stdout.includes(secret));
    }
});

test('database authentication failures are classified without logging driver secrets', () => {
    const script = `
        const mongoose = require('mongoose');
        mongoose.connect = async () => {
            throw Object.assign(new Error('bad auth: ${secret}'), { code: 8000 });
        };
        require('./server');
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, MONGODB_URI: `mongodb+srv://user:${secret}@example.com/db` }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Database authentication failed/);
    assert.ok(!result.stderr.includes(secret));
    assert.ok(!result.stdout.includes(secret));
});
