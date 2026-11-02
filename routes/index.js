const express = require('express');
const resourceRoutes = require('./resources');
const User = require('../models/user');
const Task = require('../models/task');
const { saveUser, saveTask, deleteUser, deleteTask } = require('../lib/resources');

module.exports = function (app) {
    app.use('/api', require('./home')(express.Router()));
    app.use('/api/users', resourceRoutes(User, saveUser, deleteUser, 0));
    app.use('/api/tasks', resourceRoutes(Task, saveTask, deleteTask, 100));
};
