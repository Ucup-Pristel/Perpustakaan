/**
 * ucup-edu-lib :: Auth Middleware
 * Re-export verifyToken dari auth.js dengan nama standar `auth`
 * — satu sumber kebenaran, tidak duplikasi logika
 */
const auth = require('./auth');

module.exports = auth;
