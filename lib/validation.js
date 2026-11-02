const { ApiError } = require('./errors');

const validId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const bad = message => { throw new ApiError(400, message); };

function bodyObject(req) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        bad('A request body containing fields is required.');
    }
    return body;
}

function stringField(body, key, required = false, fallback = '') {
    const value = body[key] === undefined ? fallback : body[key];
    if (typeof value !== 'string' || (required && !value.trim())) {
        bad(`${key} must be ${required ? 'a non-empty' : 'a'} string.`);
    }
    return required ? value.trim() : value;
}

function userFields(req) {
    const body = bodyObject(req);
    const name = stringField(body, 'name', true);
    const email = stringField(body, 'email', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('email must be a valid email address.');
    let pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (req.is('application/x-www-form-urlencoded') && typeof pendingTasks === 'string') {
        try { pendingTasks = JSON.parse(pendingTasks); } catch { bad('pendingTasks must be a list of task ids.'); }
    }
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(validId)) {
        bad('pendingTasks must be a list of valid task ids.');
    }
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}

function taskFields(req) {
    const body = bodyObject(req);
    const name = stringField(body, 'name', true);
    const description = stringField(body, 'description');
    const rawDeadline = body.deadline;
    if (!['string', 'number'].includes(typeof rawDeadline) || rawDeadline === '') {
        bad('deadline must be a valid date.');
    }
    // Accept ISO dates and epoch milliseconds, including URL-encoded values.
    const deadline = new Date(typeof rawDeadline === 'string' && /^-?\d{5,}$/.test(rawDeadline)
        ? Number(rawDeadline) : rawDeadline);
    if (!Number.isFinite(deadline.getTime())) bad('deadline must be a valid date.');
    let completed = body.completed === undefined ? false : body.completed;
    if (req.is('application/x-www-form-urlencoded') && ['true', 'false'].includes(completed)) {
        completed = completed === 'true';
    }
    if (typeof completed !== 'boolean') bad('completed must be a boolean.');
    const assignedUser = stringField(body, 'assignedUser');
    if (assignedUser !== '' && !validId(assignedUser)) bad('assignedUser must be a valid user id or an empty string.');
    const assignedUserName = body.assignedUserName === undefined
        ? undefined : stringField(body, 'assignedUserName');
    if (!assignedUser && assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        bad('An unassigned task must have assignedUserName "unassigned".');
    }
    return { name, description, deadline, completed, assignedUser: assignedUser.toLowerCase(), assignedUserName };
}

module.exports = { validId, userFields, taskFields };
