const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/user');
const Task = require('../models/task');

let database;
let server;
let base;
const deadline = '2026-11-03T23:59:00.000Z';
const missingId = 'aaaaaaaaaaaaaaaaaaaaaaaa';

before(async () => {
    // A real isolated replica set exercises transaction commits and rollbacks.
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri(), { dbName: 'mp3_test' });
    await Promise.all([User.init(), Task.init()]);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (database) await database.stop();
});

beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Task.deleteMany({})]);
});

async function request(method, path, body, expected = 200) {
    const response = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    assert.deepEqual(Object.keys(result).sort(), ['data', 'message']);
    assert.equal(typeof result.message, 'string');
    return result.data;
}

const createUser = (name = 'Alice', extra = {}) => request('POST', '/users', {
    name, email: `${name.toLowerCase()}@example.com`, ...extra
}, 201);
const createTask = (extra = {}) => request('POST', '/tasks', { name: 'Task', deadline, ...extra }, 201);
const getUser = id => request('GET', `/users/${id}`);
const getTask = id => request('GET', `/tasks/${id}`);
const query = (path, fields) => path + '?' + new URLSearchParams(
    Object.entries(fields).map(([key, value]) => [key, JSON.stringify(value)])
);

async function snapshot() {
    return JSON.stringify(await Promise.all([
        User.find().sort({ _id: 1 }).lean(), Task.find().sort({ _id: 1 }).lean()
    ]));
}

async function assertConsistent() {
    const users = await User.find().lean();
    const tasks = await Task.find().lean();
    for (const user of users) {
        const expected = tasks.filter(task => task.assignedUser === String(user._id) && !task.completed)
            .map(task => String(task._id)).sort();
        assert.deepEqual([...user.pendingTasks].sort(), expected);
    }
    for (const task of tasks) {
        const owner = users.find(user => String(user._id) === task.assignedUser);
        if (task.assignedUser) assert.ok(owner, 'Assigned user must exist');
        assert.equal(task.assignedUserName, owner ? owner.name : 'unassigned');
    }
}

test('creation supplies defaults and server-controlled dates', async () => {
    const user = await createUser('Alice', { dateCreated: '2000-01-01', _id: missingId });
    const task = await createTask({ dateCreated: '2000-01-01' });
    assert.deepEqual(user.pendingTasks, []);
    assert.notEqual(user._id, missingId);
    assert.ok(Date.now() - new Date(user.dateCreated).getTime() < 10000);
    assert.equal(task.description, '');
    assert.equal(task.completed, false);
    assert.equal(task.assignedUser, '');
    assert.equal(task.assignedUserName, 'unassigned');
    assert.equal(task.deadline, deadline);
    assert.ok(Date.now() - new Date(task.dateCreated).getTime() < 10000);
});

test('required fields, types, email uniqueness and dates are validated', async () => {
    for (const body of [{}, { name: 'Alice' }, { email: 'a@b.com' },
        { name: 7, email: 'a@b.com' }, { name: ' ', email: 'a@b.com' },
        { name: 'Alice', email: 'invalid' }, { name: 'Alice', email: 'a@b.com', pendingTasks: 'bad' },
        { name: 'Alice', email: 'a@b.com', pendingTasks: [12] }]) {
        await request('POST', '/users', body, 400);
    }
    for (const extra of [{ name: null }, { name: '' }, { deadline: null }, { deadline: 'bad date' },
        { deadline: true }, { completed: 'true' }, { description: 4 }, { assignedUser: 12 },
        { assignedUser: 'invalid' }, { assignedUserName: null }, { assignedUserName: 'Alice' }]) {
        await request('POST', '/tasks', { name: 'Task', deadline, ...extra }, 400);
    }
    await request('POST', '/tasks', { name: 'Task' }, 400);
    await createUser();
    await request('POST', '/users', { name: 'Duplicate', email: 'alice@example.com' }, 400);
    assert.equal(await User.countDocuments(), 1);
    assert.equal(await Task.countDocuments(), 0);
});

test('URL ids take precedence over invalid PUT bodies', async () => {
    for (const collection of ['users', 'tasks']) {
        for (const id of ['bad-id', missingId]) {
            await request('GET', `/${collection}/${id}`, undefined, 404);
            await request('PUT', `/${collection}/${id}`, {}, 404);
            await request('DELETE', `/${collection}/${id}`, undefined, 404);
        }
    }
});

test('invalid references are 400; missing references are 404; failures do not mutate', async () => {
    const user = await createUser();
    const task = await createTask({ assignedUser: user._id });
    const original = await snapshot();
    await request('PUT', `/users/${user._id}`, { name: 'Changed', email: user.email, pendingTasks: ['bad'] }, 400);
    await request('PUT', `/users/${user._id}`, { name: 'Changed', email: user.email, pendingTasks: [missingId] }, 404);
    await request('PUT', `/tasks/${task._id}`, { name: 'Changed', deadline, assignedUser: missingId }, 404);
    await request('PUT', `/tasks/${task._id}`, { name: 'Changed', deadline, assignedUser: user._id, assignedUserName: 'Wrong' }, 400);
    await request('POST', '/users', { name: 'New', email: 'new@example.com', pendingTasks: [task._id, missingId] }, 404);
    await request('POST', '/tasks', { name: 'New', deadline, assignedUser: missingId }, 404);
    assert.equal(await snapshot(), original);
});

test('task reassignment, completion, reopening and unassignment update both users', async () => {
    const alice = await createUser();
    const bob = await createUser('Bob');
    const task = await createTask({ assignedUser: alice._id });
    assert.equal(task.assignedUserName, 'Alice');
    assert.deepEqual((await getUser(alice._id)).pendingTasks, [task._id]);
    for (const extra of [
        { assignedUser: bob._id },
        { assignedUser: bob._id, completed: true },
        { assignedUser: alice._id, completed: true },
        { assignedUser: alice._id, completed: false },
        { assignedUser: '' }
    ]) {
        const updated = await request('PUT', `/tasks/${task._id}`, { name: 'Updated', deadline, ...extra });
        assert.equal(updated.assignedUser, extra.assignedUser);
        assert.equal(updated.dateCreated, task.dateCreated);
        await assertConsistent();
    }
});

test('user POST and PUT move tasks; rename updates completed tasks as well', async () => {
    const alice = await createUser();
    const first = await createTask({ assignedUser: alice._id });
    const second = await createTask();
    const bob = await createUser('Bob', { pendingTasks: [first._id, first._id] });
    assert.deepEqual(bob.pendingTasks, [first._id]);
    const completed = await createTask({ assignedUser: bob._id, completed: true });
    const renamed = await request('PUT', `/users/${bob._id}`, {
        name: 'Robert', email: bob.email, pendingTasks: [second._id], dateCreated: '2000-01-01'
    });
    assert.equal(renamed.dateCreated, bob.dateCreated);
    assert.equal((await getTask(first._id)).assignedUser, '');
    assert.equal((await getTask(second._id)).assignedUserName, 'Robert');
    assert.equal((await getTask(completed._id)).assignedUserName, 'Robert');
    await request('PUT', `/users/${alice._id}`, { name: 'Alice', email: alice.email, pendingTasks: [second._id] });
    await assertConsistent();
});

test('PUT resets omitted optional fields and preserves dateCreated', async () => {
    const user = await createUser();
    const pending = await createTask({ assignedUser: user._id, description: 'old' });
    const completed = await createTask({ assignedUser: user._id, completed: true });
    await request('PUT', `/users/${user._id}`, { name: 'Renamed', email: user.email });
    assert.equal((await getTask(pending._id)).assignedUser, '');
    assert.equal((await getTask(completed._id)).assignedUser, user._id);
    const replaced = await request('PUT', `/tasks/${completed._id}`, { name: 'Reset', deadline, dateCreated: '2000-01-01' });
    assert.equal(replaced.completed, false);
    assert.equal(replaced.assignedUser, '');
    assert.equal(replaced.description, '');
    assert.equal(replaced.dateCreated, completed.dateCreated);
    await assertConsistent();
});

test('completed task and duplicate email rejection leave the whole database unchanged', async () => {
    const alice = await createUser();
    const bob = await createUser('Bob');
    const completed = await createTask({ completed: true, assignedUser: alice._id });
    const original = await snapshot();
    await request('PUT', `/users/${bob._id}`, { name: 'Changed', email: bob.email, pendingTasks: [completed._id] }, 400);
    await request('POST', '/users', { name: 'New', email: 'new@example.com', pendingTasks: [completed._id] }, 400);
    await request('PUT', `/users/${bob._id}`, { name: 'Changed', email: alice.email }, 400);
    assert.equal(await snapshot(), original);
});

test('select works on both detail endpoints and other detail parameters are ignored', async () => {
    const user = await createUser();
    const task = await createTask();
    for (const [collection, resource] of [['users', user], ['tasks', task]]) {
        const selected = await request('GET', query(`/${collection}/${resource._id}`, { select: { name: 1, _id: 0 } }) + '&where=invalid&limit=invalid&count=invalid');
        assert.deepEqual(selected, { name: resource.name });
        const excluded = await request('GET', query(`/${collection}/${resource._id}`, { select: { _id: 0 } }));
        assert.equal(excluded._id, undefined);
        await request('GET', `/${collection}/${resource._id}?select=invalid`, undefined, 400);
    }
});

test('collection filtering, sorting, projection, pagination and count compose', async () => {
    for (const name of ['C', 'A', 'B']) await createTask({ name });
    await createTask({ name: 'Completed', completed: true });
    const selected = await request('GET', query('/tasks', {
        where: { completed: false }, sort: { name: 1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1
    }));
    assert.deepEqual(selected, [{ name: 'B' }]);
    assert.equal(await request('GET', query('/tasks', { where: { completed: false }, count: true, skip: 1, limit: 1 })), 3);
    assert.deepEqual(await request('GET', query('/users', { where: { _id: missingId } })), []);
    assert.equal(await request('GET', query('/tasks', { where: { _id: missingId }, count: true })), 0);
    const tasks = await request('GET', '/tasks');
    assert.equal((await request('GET', query('/tasks', { where: { _id: { $in: tasks.slice(0, 2).map(task => task._id) } } }))).length, 2);
    for (const name of ['C', 'A', 'B']) await createUser(name);
    assert.deepEqual(await request('GET', query('/users', { sort: { name: -1 }, skip: 1, limit: 1, select: { _id: 0, name: 1 } })), [{ name: 'B' }]);
});

test('tasks default to 100 results, users are unlimited, limit=0 is unlimited', async () => {
    await Task.insertMany(Array.from({ length: 105 }, (_, index) => ({ name: `Task ${index}`, deadline })));
    await User.insertMany(Array.from({ length: 105 }, (_, index) => ({ name: `User ${index}`, email: `user${index}@example.com` })));
    assert.equal((await request('GET', '/tasks')).length, 100);
    assert.equal((await request('GET', '/users')).length, 105);
    assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
    assert.equal(await request('GET', '/tasks?count=true'), 105);
});

test('malformed JSON and query parameter types get JSON 400 responses', async () => {
    for (const key of ['where', 'sort', 'select', 'skip', 'limit', 'count']) {
        await request('GET', `/tasks?${key}=invalid`, undefined, 400);
    }
    for (const fields of [{ where: [] }, { sort: { name: 2 } }, { select: { name: 1, deadline: 0 } },
        { select: { name: 'yes' } }, { skip: -1 }, { limit: 1.5 }, { count: 1 }, { where: { $invalid: 1 } }]) {
        await request('GET', query('/tasks', fields), undefined, 400);
    }
    const response = await fetch(base + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['data', 'message']);
});

test('deleting tasks and users cleans pending and completed references', async () => {
    const user = await createUser();
    const pending = await createTask({ assignedUser: user._id });
    const completed = await createTask({ assignedUser: user._id, completed: true });
    const removed = await createTask({ assignedUser: user._id });
    await request('DELETE', `/tasks/${removed._id}`);
    await request('GET', `/tasks/${removed._id}`, undefined, 404);
    await assertConsistent();
    await request('DELETE', `/users/${user._id}`);
    await request('GET', `/users/${user._id}`, undefined, 404);
    for (const task of [pending, completed]) {
        const result = await getTask(task._id);
        assert.equal(result.assignedUser, '');
        assert.equal(result.assignedUserName, 'unassigned');
    }
    await assertConsistent();
});

test('unexpected errors roll back earlier writes and return a generic 500', async t => {
    const user = await createUser();
    await createTask({ assignedUser: user._id });
    const original = await snapshot();
    const mock = t.mock.method(Task, 'updateMany', () => { throw new Error('Private MongoDB details'); });
    const response = await fetch(base + `/users/${user._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Changed', email: user.email })
    });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /Private|MongoDB|Mongoose/);
    mock.mock.restore();
    assert.equal(await snapshot(), original);
});

test('concurrent reassignment and duplicate creation preserve consistency', async () => {
    const alice = await createUser();
    const bob = await createUser('Bob');
    const task = await createTask();
    await Promise.all([alice, bob].map(user => request('PUT', `/tasks/${task._id}`, {
        name: 'Concurrent', deadline, assignedUser: user._id
    })));
    await assertConsistent();
    const responses = await Promise.all([1, 2].map(() => fetch(base + '/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate', email: 'duplicate@example.com' })
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
    await Promise.all(responses.map(response => response.text()));
});

test('URL-encoded clients, CORS preflights and unknown routes work', async () => {
    const response = await fetch(base + '/tasks', {
        method: 'POST', body: new URLSearchParams({ name: 'Form task', deadline: String(Date.parse(deadline)), completed: 'false' })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.deadline, deadline);
    const options = await fetch(base + '/tasks', { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), '*');
    await request('GET', '/unknown', undefined, 404);
});
