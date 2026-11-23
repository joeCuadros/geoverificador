'use strict';
// Función de Vercel para /api/auth/me (inicio de sesión opcional con Google). La lógica está en apps/estatica/api/_lib/auth.js.
const { atenderNode } = require('../_lib/auth.js');

module.exports = (req, res) => atenderNode('me', req, res);
