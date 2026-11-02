const express = require('express');
const { errorHandler } = require('./lib/errors');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.set('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('./routes')(app);
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.', data: {} }));
app.use(errorHandler);

module.exports = app;
