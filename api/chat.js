'use strict';
// Función de Vercel para POST /api/chat (y GET para saber si el modelo está configurado). La lógica está en api/_lib/gemini.js.
const { manejarChat } = require('./_lib/gemini.js');

module.exports = async function handler(req, res) {
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = reenviada || (req.socket && req.socket.remoteAddress) || 'desconocida';
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = null; }
  }
  const r = await manejarChat({ metodo: req.method, cuerpo, ip });
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.status).json(r.cuerpo);
};
