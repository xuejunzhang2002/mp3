module.exports = function (router) {

    var homeRoute = router.route('/');

    homeRoute.get(function (req, res) {
        res.json({ message: 'Task management API is running.', data: {} });
    });

    return router;
}
