import React from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import swaggerJSON from '../../pages/api/swagger.json';

const SwaggerPage = () => {
  const securityDefinitions = {
    BearerAuth: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
    },
  };

  return <SwaggerUI spec={swaggerJSON} securityDefinitions={securityDefinitions} />;
};

export default SwaggerPage;
