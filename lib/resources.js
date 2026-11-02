const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('./errors');
const { validId, userFields, taskFields } = require('./validation');

async function findResource(Model, id, session) {
    if (!validId(id)) throw new ApiError(404, `${Model.modelName} not found.`);
    const document = await Model.findById(id).session(session || null);
    if (!document) throw new ApiError(404, `${Model.modelName} not found.`);
    return document;
}

async function saveUser(req) {
    return mongoose.connection.transaction(async session => {
        const user = req.params.id ? await findResource(User, req.params.id, session) : new User();
        const fields = userFields(req);
        const duplicate = await User.findOne({ email: fields.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) throw new ApiError(400, 'This email is already used by another user.');
        const tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).session(session);
        if (tasks.some(task => task.completed)) {
            throw new ApiError(400, 'pendingTasks cannot contain completed tasks.');
        }
        if (tasks.length !== fields.pendingTasks.length) throw new ApiError(404, 'A task in pendingTasks was not found.');

        const userId = user._id.toString();
        const removed = user.pendingTasks.filter(id => !fields.pendingTasks.includes(id));
        user.set(fields);
        await user.save({ session });
        // Release removed tasks and move requested tasks away from their old owners.
        await Task.updateMany({ _id: { $in: removed }, assignedUser: userId },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
        await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: fields.pendingTasks } },
            { $pull: { pendingTasks: { $in: fields.pendingTasks } } }, { session });
        await Task.updateMany({ _id: { $in: fields.pendingTasks } },
            { $set: { assignedUser: userId, assignedUserName: user.name } }, { session });
        // Renaming a user also updates their completed tasks.
        await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: user.name } }, { session });
        return user.toObject();
    });
}

async function saveTask(req) {
    return mongoose.connection.transaction(async session => {
        const task = req.params.id ? await findResource(Task, req.params.id, session) : new Task();
        const fields = taskFields(req);
        if (fields.assignedUser) {
            const user = await findResource(User, fields.assignedUser, session);
            if (fields.assignedUserName !== undefined && fields.assignedUserName !== user.name) {
                throw new ApiError(400, 'assignedUserName must match the assigned user\'s name.');
            }
            fields.assignedUserName = user.name;
        } else {
            fields.assignedUserName = 'unassigned';
        }
        task.set(fields);
        await task.save({ session });
        const taskId = task._id.toString();
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session });
        if (task.assignedUser) {
            // Touch even completed-task owners so concurrent deletion or renaming
            // causes a transaction retry instead of leaving a stale reference.
            const update = { $inc: { __v: 1 } };
            if (!task.completed) update.$addToSet = { pendingTasks: taskId };
            await User.updateOne({ _id: task.assignedUser }, update, { session });
        }
        return task.toObject();
    });
}

async function deleteUser(id) {
    return mongoose.connection.transaction(async session => {
        const user = await findResource(User, id, session);
        await Task.updateMany({ assignedUser: user._id.toString() },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
        await user.deleteOne({ session });
        return {};
    });
}

async function deleteTask(id) {
    return mongoose.connection.transaction(async session => {
        const task = await findResource(Task, id, session);
        await User.updateMany({ pendingTasks: task._id.toString() },
            { $pull: { pendingTasks: task._id.toString() } }, { session });
        await task.deleteOne({ session });
        return {};
    });
}

module.exports = { findResource, saveUser, saveTask, deleteUser, deleteTask };
