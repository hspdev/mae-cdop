/**
 * MAE CAP Server — Custom express setup
 * Mounts REST API alongside CAP OData services
 */

'use strict';

const cds      = require('@sap/cds');
const restApi  = require('./srv/rest-api');

cds.on('bootstrap', (app) => {
  // Mount REST API routes
  app.use('/api', restApi);
  app.get('/health', (req, res) => res.json({ status: 'UP', service: 'mae-cap-backend' }));
});

// Start CAP server
module.exports = cds.server;
