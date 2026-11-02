require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const User = require('./models/user');
const Task = require('./models/task');

async function start() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required. Configure it in .env or your hosting environment.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
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

start().catch(async () => {
    console.error('Unable to start the API. Check MONGODB_URI, database access, and the unique email index.');
    await mongoose.disconnect();
    process.exitCode = 1;
});
