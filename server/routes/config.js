const express = require('express');
const { isOpenNow } = require('../services/hours.js');

function createConfigRouter(config) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({
      businessName: config.businessName,
      branding: config.branding,
      hours: { display: config.hours ? config.hours.display : null },
      isOpenNow: isOpenNow(config.hours),
      services: config.services,
      serviceArea: config.serviceArea,
      pricing: config.pricing
    });
  });

  return router;
}

module.exports = { createConfigRouter };
