const userService = require('../services/user.service');

exports.getUser = async (req, res) => {
  const user = await userService.getProfile(Number(req.params.id));
  res.json(user);
};
