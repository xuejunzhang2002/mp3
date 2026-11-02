require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const User = require('./models/user');
const Task = require('./models/task');
let startupStage = 'Configuration';

function configurationError(code) {
    return Object.assign(new Error('Invalid database configuration'), { code });
}

async function start() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw configurationError('MISSING_DATABASE_URI');
    if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || uri !== uri.trim()) {
        throw configurationError('INVALID_DATABASE_URI');
    }
    if (/<[^>]+>/.test(uri)) throw configurationError('DATABASE_URI_PLACEHOLDER');
    startupStage = 'Database connection';
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    startupStage = 'Database index initialization';
    // Ensure the unique email index exists before accepting requests.
    await Promise.all([User.init(), Task.init()]);
    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => console.log(`Server running on port ${port}`));
    const shutdown = () => server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
    });
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

start().catch(async error => {
    // Only fixed messages are logged: driver errors may contain credentials.
    const configurationMessages = {
        MISSING_DATABASE_URI: 'MONGODB_URI is missing from the service environment.',
        INVALID_DATABASE_URI: 'MONGODB_URI must start with mongodb:// or mongodb+srv:// and contain no surrounding spaces, quotes, or variable name.',
        DATABASE_URI_PLACEHOLDER: 'MONGODB_URI still contains a placeholder such as <db_password>.'
    };
    let reason = configurationMessages[error.code];
    if (!reason && (error.code === 18 || /authentication failed|bad auth/i.test(error.message || ''))) {
        reason = 'Database authentication failed. Check the database username, password, and authSource in MONGODB_URI.';
    } else if (!reason && error.code === 13) {
        reason = 'The database user does not have permission to access the database or create indexes.';
    } else if (!reason && error.code === 11000) {
        reason = 'The unique email index cannot be created because existing users have duplicate emails.';
    } else if (!reason && ['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ECONNREFUSED'].includes(error.code)) {
        reason = 'The database hostname could not be resolved or reached. Check the cluster hostname and network access.';
    } else if (!reason && ['MongooseServerSelectionError', 'MongoServerSelectionError'].includes(error.name)) {
        reason = 'No database server is reachable. Check Atlas IP Access List, cluster availability, and network connectivity.';
    } else if (!reason && error.name === 'MongoParseError') {
        reason = 'MONGODB_URI has an invalid connection string format or unsupported options.';
    }
    console.error(`${startupStage} failed: ${reason || 'Unexpected startup error.'}`);
    await mongoose.disconnect();
    process.exitCode = 1;
});
