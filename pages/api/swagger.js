// pages/api/swagger.js

import swaggerJSON from './swagger.json';

// console.log('swaggerJSON', swaggerJSON);

export default function handler(req, res) {
  res.status(200).json(swaggerJSON);
}
