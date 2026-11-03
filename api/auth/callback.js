'use strict';
// Función de Vercel para /api/auth/callback (inicio de sesión opcional con Google). La lógica está en api/_lib/auth.js.
const { atenderNode } = require('../_lib/auth.js');

module.exports = (req, res) => atenderNode('callback', req, res);
