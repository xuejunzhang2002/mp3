const express = require('express');
const { list, selectFields } = require('../lib/query');
const { validId } = require('../lib/validation');
const { ApiError } = require('../lib/errors');

module.exports = function resourceRoutes(Model, save, remove, defaultLimit) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        res.json({ message: 'OK', data: await list(Model, req.query, defaultLimit) });
    });
    router.post('/', async (req, res) => {
        const data = await save(req);
        res.status(201).json({ message: `${Model.modelName} created.`, data });
    });
    router.get('/:id', async (req, res) => {
        if (!validId(req.params.id)) throw new ApiError(404, `${Model.modelName} not found.`);
        const data = await Model.findById(req.params.id).select(selectFields(req.query)).lean();
        if (!data) throw new ApiError(404, `${Model.modelName} not found.`);
        res.json({ message: 'OK', data });
    });
    router.put('/:id', async (req, res) => {
        res.json({ message: `${Model.modelName} updated.`, data: await save(req) });
    });
    router.delete('/:id', async (req, res) => {
        res.json({ message: `${Model.modelName} deleted.`, data: await remove(req.params.id) });
    });
    return router;
};
