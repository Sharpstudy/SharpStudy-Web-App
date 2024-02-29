import swaggerJSON from './swagger.json';

export default function handler(req, res) {
  res.status(200).json(swaggerJSON);
}
