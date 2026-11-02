const { ApiError } = require('./errors');

function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    try {
        if (typeof query[key] !== 'string') throw new Error();
        return JSON.parse(query[key]);
    } catch {
        throw new ApiError(400, `${key} must contain valid JSON.`);
    }
}

function object(value, key) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, `${key} must be a JSON object.`);
    }
    return value;
}

function selectFields(query) {
    const select = object(parse(query, 'select', {}), 'select');
    if (Object.values(select).some(value => value !== 0 && value !== 1)) {
        throw new ApiError(400, 'select values must be 0 or 1.');
    }
    const modes = new Set(Object.entries(select).filter(([key]) => key !== '_id').map(([, value]) => value));
    if (modes.size > 1) throw new ApiError(400, 'select cannot mix included and excluded fields, except for _id.');
    return select;
}

async function list(Model, query, defaultLimit) {
    const where = object(parse(query, 'where', {}), 'where');
    const sort = object(parse(query, 'sort', {}), 'sort');
    if (Object.values(sort).some(value => value !== 1 && value !== -1)) {
        throw new ApiError(400, 'sort values must be 1 or -1.');
    }
    const select = selectFields(query);
    const skip = parse(query, 'skip', 0);
    const limit = parse(query, 'limit', defaultLimit);
    for (const [key, value] of Object.entries({ skip, limit })) {
        if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${key} must be a non-negative integer.`);
    }
    const count = parse(query, 'count', false);
    if (typeof count !== 'boolean') throw new ApiError(400, 'count must be a boolean.');
    try {
        // Count matching documents; pagination and projection only affect lists.
        if (count) return await Model.countDocuments(where);
        return await Model.find(where).sort(sort).select(select).skip(skip).limit(limit).lean();
    } catch (error) {
        if (error.name === 'MongoServerError' && [2, 9, 14, 168, 31253, 31254].includes(error.code)) {
            throw new ApiError(400, 'The query contains an invalid filter or field selection.');
        }
        throw error;
    }
}

module.exports = { selectFields, list };
